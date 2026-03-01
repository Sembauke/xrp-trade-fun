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
const POLL_MS = Number(process.env.POLL_MS || 60_000);
const OPTIMIZE_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

const ASSET_CONFIGS = {
  xrp: {
    id: 'xrp',
    symbol: 'XRPUSDT',
    dbPath: process.env.DB_PATH_XRP || 'data/trading.db',
    startingCapital: Number(process.env.STARTING_CAPITAL_XRP || 10_000),
  },
  btc: {
    id: 'btc',
    symbol: 'BTCUSDT',
    dbPath: process.env.DB_PATH_BTC || 'data/trading-btc.db',
    startingCapital: Number(process.env.STARTING_CAPITAL_BTC || 20_000),
  },
};

function createAssetService(config) {
  const db = createDb({
    dbPath: config.dbPath,
    startingCapital: config.startingCapital,
  });
  const backtestCache = new Map();
  let cycleRunning = false;
  let optimizeRunning = false;

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
    const url = `https://api.binance.com/api/v3/klines?symbol=${config.symbol}&interval=${interval}&limit=${limit}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`${config.symbol} Binance ${interval} timeout na ${FETCH_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`${config.symbol} Binance ${interval} HTTP ${response.status}`);
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
        fetchCandles('1m', 220),
        fetchCandles('4h', 220),
        fetchCandles('1d', 220),
      ]);

      const portfolio = loadPortfolio(db);
      const strategyState = loadStrategyState(db);
      const output = runStrategy({
        candles1m,
        candles4h,
        candles1d,
        portfolio,
        strategyConfig: strategyState.strategyConfig,
        symbol: config.symbol,
        startingCapital: config.startingCapital,
      });
      saveCycle(db, output);
      return output;
    } catch (error) {
      setError(db, error instanceof Error ? error.message : 'Cycle failed');
      throw error;
    }
  }

  async function maybeRunCycle() {
    if (cycleRunning) return;
    cycleRunning = true;
    try {
      const state = getState(db, config.symbol);
      if (!state.isRunning) return;
      await runCycle();
    } finally {
      cycleRunning = false;
    }
  }

  async function maybeOptimize(force = false) {
    if (optimizeRunning) return;
    optimizeRunning = true;
    try {
      const state = getState(db, config.symbol);
      if (!state.isRunning) return;

      const strategyState = loadStrategyState(db);
      if (!strategyState.autoOptimize) return;

      const lastOptimizedMs = strategyState.lastOptimized
        ? new Date(strategyState.lastOptimized).getTime()
        : 0;
      if (!force && Date.now() - lastOptimizedMs < OPTIMIZE_MS) return;

      const sweep = await runBacktestSweep({
        symbol: config.symbol,
        days: 365,
        executionInterval: '1h',
        top: 1,
        startingCapital: config.startingCapital,
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

  return {
    id: config.id,
    symbol: config.symbol,
    db,
    runCycle,
    maybeRunCycle,
    maybeOptimize,
    cacheGet,
    cacheSet,
    getState: () => getState(db, config.symbol),
    setBotRunning: (isRunning) => setBotRunning(db, isRunning),
    resetAll: () => resetAll(db),
    loadStrategyState: () => loadStrategyState(db),
    startingCapital: config.startingCapital,
  };
}

const services = Object.fromEntries(
  Object.entries(ASSET_CONFIGS).map(([id, cfg]) => [id, createAssetService(cfg)]),
);

const app = express();
app.use(cors());
app.use(express.json());

function resolveService(req, res) {
  const service = services[req.params.asset];
  if (!service) {
    res.status(404).json({ error: `Unknown asset '${req.params.asset}'` });
    return null;
  }
  return service;
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    now: new Date().toISOString(),
    assets: Object.values(services).map((service) => ({
      id: service.id,
      symbol: service.symbol,
      running: service.getState().isRunning,
    })),
  });
});

app.get('/api/:asset/state', (req, res) => {
  const service = resolveService(req, res);
  if (!service) return;
  res.json(service.getState());
});

app.post('/api/:asset/actions/refresh', async (req, res) => {
  const service = resolveService(req, res);
  if (!service) return;
  try {
    await service.runCycle();
    res.json(service.getState());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Refresh failed' });
  }
});

app.post('/api/:asset/actions/toggle', (req, res) => {
  const service = resolveService(req, res);
  if (!service) return;
  const state = service.getState();
  const next = !state.isRunning;
  service.setBotRunning(next);
  if (next) {
    void service.maybeOptimize(true);
    void service.maybeRunCycle();
  }
  res.json(service.getState());
});

app.post('/api/:asset/actions/restart', async (req, res) => {
  const service = resolveService(req, res);
  if (!service) return;
  try {
    service.resetAll();
    await service.runCycle();
    res.json(service.getState());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Restart failed' });
  }
});

app.get('/api/:asset/backtest', async (req, res) => {
  const service = resolveService(req, res);
  if (!service) return;
  try {
    const days = Number(req.query.days ?? 365);
    const executionInterval = String(req.query.executionInterval ?? '1h');
    const symbol = String(req.query.symbol ?? service.symbol);
    const strategyState = service.loadStrategyState();
    const cacheKey = `${symbol}:${executionInterval}:${days}:${strategyState.variant}:${strategyState.lastOptimized ?? 'none'}`;

    const cached = service.cacheGet(cacheKey);
    if (cached) {
      res.json({ ...cached, cached: true });
      return;
    }

    const payload = await runBacktest({
      symbol,
      executionInterval,
      days,
      strategyConfig: strategyState.strategyConfig,
      startingCapital: service.startingCapital,
    });
    service.cacheSet(cacheKey, payload);

    res.json({ ...payload, cached: false });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Backtest failed' });
  }
});

app.get('/api/:asset/backtest/sweep', async (req, res) => {
  const service = resolveService(req, res);
  if (!service) return;
  try {
    const days = Number(req.query.days ?? 365);
    const executionInterval = String(req.query.executionInterval ?? '1h');
    const symbol = String(req.query.symbol ?? service.symbol);
    const top = Number(req.query.top ?? 5);
    const cacheKey = `sweep:${symbol}:${executionInterval}:${days}:${top}`;

    const cached = service.cacheGet(cacheKey);
    if (cached) {
      res.json({ ...cached, cached: true });
      return;
    }

    const payload = await runBacktestSweep({
      symbol,
      executionInterval,
      days,
      top,
      startingCapital: service.startingCapital,
    });
    service.cacheSet(cacheKey, payload);
    res.json({ ...payload, cached: false });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Sweep failed' });
  }
});

// Backward-compat aliases to XRP endpoints.
app.get('/api/state', (req, res) => res.json(services.xrp.getState()));
app.post('/api/actions/refresh', async (req, res) => {
  try {
    await services.xrp.runCycle();
    res.json(services.xrp.getState());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Refresh failed' });
  }
});
app.post('/api/actions/toggle', (req, res) => {
  const state = services.xrp.getState();
  const next = !state.isRunning;
  services.xrp.setBotRunning(next);
  if (next) {
    void services.xrp.maybeOptimize(true);
    void services.xrp.maybeRunCycle();
  }
  res.json(services.xrp.getState());
});
app.post('/api/actions/restart', async (req, res) => {
  try {
    services.xrp.resetAll();
    await services.xrp.runCycle();
    res.json(services.xrp.getState());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Restart failed' });
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');

app.use(express.static(DIST));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    next();
    return;
  }
  res.sendFile(path.join(DIST, 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`Multi-asset bot API running on http://localhost:${PORT}`);
  for (const service of Object.values(services)) {
    try {
      await service.maybeOptimize(true);
      await service.runCycle();
    } catch (error) {
      console.error(`Initial cycle failed for ${service.symbol}:`, error);
    }
  }

  const allServices = Object.values(services);
  allServices.forEach((service, idx) => {
    const offset = idx * 12_000;
    setTimeout(() => {
      void service.maybeOptimize();
      void service.maybeRunCycle();
      setInterval(() => {
        void service.maybeOptimize();
        void service.maybeRunCycle();
      }, POLL_MS);
    }, offset);
  });
});
