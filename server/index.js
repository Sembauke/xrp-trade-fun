import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import {
  createDb,
  getState,
  loadPortfolio,
  loadStrategyState,
  saveCycle,
  saveStrategyState,
  setBotRunning,
  setError,
  resetAll,
} from './db.js';
import { runStrategy } from './strategy.js';
import { runBacktest, runBacktestSweep } from './backtest.js';

const PORT = Number(process.env.PORT || 8787);
const POLL_MS = 30_000;
const OPTIMIZE_MS = 6 * 60 * 60 * 1000;

const app = express();
app.use(cors());
app.use(express.json());

const db = createDb();
const backtestCache = new Map();

function cacheGet(key, ttlMs = 5 * 60_000) {
  const cached = backtestCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.createdAt >= ttlMs) return null;
  return cached.payload;
}

function cacheSet(key, payload) {
  backtestCache.set(key, { createdAt: Date.now(), payload });
}

async function fetchCandles(interval, limit) {
  const url = `https://api.binance.com/api/v3/klines?symbol=XRPUSDT&interval=${interval}&limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Binance ${interval} HTTP ${response.status}`);
  }

  const rows = await response.json();
  return rows.map((k) => ({
    time: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }));
}

async function runCycle() {
  try {
    const [candles1m, candles4h, candles1d] = await Promise.all([
      fetchCandles('1m', 260),
      fetchCandles('4h', 320),
      fetchCandles('1d', 320),
    ]);

    const portfolio = loadPortfolio(db);
    const strategyState = loadStrategyState(db);
    const output = runStrategy({
      candles1m,
      candles4h,
      candles1d,
      portfolio,
      strategyConfig: strategyState.strategyConfig,
    });
    saveCycle(db, output);
    return output;
  } catch (error) {
    setError(db, error instanceof Error ? error.message : 'Cycle failed');
    throw error;
  }
}

let cycleRunning = false;
async function maybeRunCycle() {
  if (cycleRunning) return;
  cycleRunning = true;
  try {
    const state = getState(db);
    if (!state.isRunning) return;
    await runCycle();
  } finally {
    cycleRunning = false;
  }
}

let optimizeRunning = false;
async function maybeOptimize(force = false) {
  if (optimizeRunning) return;
  optimizeRunning = true;
  try {
    const state = getState(db);
    if (!state.isRunning) return;

    const strategyState = loadStrategyState(db);
    if (!strategyState.autoOptimize) return;

    const lastOptimizedMs = strategyState.lastOptimized
      ? new Date(strategyState.lastOptimized).getTime()
      : 0;
    if (!force && Date.now() - lastOptimizedMs < OPTIMIZE_MS) return;

    const sweep = await runBacktestSweep({
      symbol: 'XRPUSDT',
      days: 365,
      executionInterval: '1h',
      top: 1,
    });

    const best = sweep.top[0];
    if (!best) return;

    saveStrategyState(db, {
      variant: best.variant,
      strategyConfig: best.strategyConfig,
      autoOptimize: true,
      lastOptimized: new Date().toISOString(),
    });
  } catch (error) {
    setError(db, error instanceof Error ? error.message : 'Auto optimization failed');
  } finally {
    optimizeRunning = false;
  }
}

app.get('/api/state', (req, res) => {
  res.json(getState(db));
});

app.post('/api/actions/refresh', async (req, res) => {
  try {
    await runCycle();
    res.json(getState(db));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Refresh failed' });
  }
});

app.post('/api/actions/toggle', (req, res) => {
  const state = getState(db);
  const next = !state.isRunning;
  setBotRunning(db, next);
  if (next) {
    void maybeOptimize(true);
    void maybeRunCycle();
  }
  res.json(getState(db));
});

app.post('/api/actions/restart', async (req, res) => {
  try {
    resetAll(db);
    await runCycle();
    res.json(getState(db));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Restart failed' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get('/api/backtest', async (req, res) => {
  try {
    const days = Number(req.query.days ?? 365);
    const executionInterval = String(req.query.executionInterval ?? '1h');
    const symbol = String(req.query.symbol ?? 'XRPUSDT');
    const strategyState = loadStrategyState(db);
    const cacheKey = `${symbol}:${executionInterval}:${days}:${strategyState.variant}:${strategyState.lastOptimized ?? 'none'}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      res.json({ ...cached, cached: true });
      return;
    }

    const payload = await runBacktest({
      symbol,
      executionInterval,
      days,
      strategyConfig: strategyState.strategyConfig,
    });
    cacheSet(cacheKey, payload);

    res.json({ ...payload, cached: false });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Backtest failed' });
  }
});

app.get('/api/backtest/sweep', async (req, res) => {
  try {
    const days = Number(req.query.days ?? 365);
    const executionInterval = String(req.query.executionInterval ?? '1h');
    const symbol = String(req.query.symbol ?? 'XRPUSDT');
    const top = Number(req.query.top ?? 5);
    const cacheKey = `sweep:${symbol}:${executionInterval}:${days}:${top}`;

    const cached = cacheGet(cacheKey);
    if (cached) {
      res.json({ ...cached, cached: true });
      return;
    }

    const payload = await runBacktestSweep({
      symbol,
      executionInterval,
      days,
      top,
    });
    cacheSet(cacheKey, payload);
    res.json({ ...payload, cached: false });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Sweep failed' });
  }
});

// ─── Serve built frontend (production / Docker) ──────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');

app.use(express.static(DIST));
// SPA fallback — must be last, after all /api/* routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(DIST, 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`XRP bot API running on http://localhost:${PORT}`);
  try {
    await maybeOptimize(true);
    await runCycle();
  } catch (error) {
    console.error('Initial cycle failed:', error);
  }
  setInterval(maybeOptimize, POLL_MS);
  setInterval(maybeRunCycle, POLL_MS);
});
