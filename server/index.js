import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import {
  createDb,
  getState,
  loadPortfolio,
  loadLatestTrade,
  loadStrategyState,
  saveCycle,
  saveStrategyState,
  setBotRunning,
  setError,
  resetAll,
} from './db.js';
import { runStrategy } from './strategy.js';
import { createMarketDataClient } from './market-data.js';
import { BacktestWorkerClient } from './backtest-worker-client.js';

const PORT = Number(process.env.PORT || 8787);
const POLL_MS = Number(process.env.POLL_MS || 60_000);
const OPTIMIZE_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 8_000);
const SYMBOL = process.env.SYMBOL || 'XRPUSDT';
const MARKET_DATA_PROVIDERS = process.env.MARKET_DATA_PROVIDERS || 'bybit,binance_vision,binance';
const DB_PATH = process.env.DB_PATH || process.env.DB_PATH_XRP || 'data/trading.db';
const STARTING_CAPITAL = Number(process.env.STARTING_CAPITAL || process.env.STARTING_CAPITAL_XRP || 10_000);

function createService(config, deps) {
  const db = createDb({
    dbPath: config.dbPath,
    startingCapital: config.startingCapital,
  });
  const backtestCache = new Map();
  let cycleRunning = false;
  let optimizeRunning = false;
  const marketData = createMarketDataClient({
    symbol: config.symbol,
    timeoutMs: FETCH_TIMEOUT_MS,
    providers: MARKET_DATA_PROVIDERS,
  });

  function cacheGet(key, ttlMs = 5 * 60_000) {
    const cached = backtestCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.createdAt >= ttlMs) return null;
    return cached.payload;
  }

  function cacheSet(key, payload) {
    backtestCache.set(key, { createdAt: Date.now(), payload });
  }

  async function runCycle() {
    try {
      const [candles1m, candles4h, candles1d] = await Promise.all([
        marketData.fetchLatestCandles('1m', 220),
        marketData.fetchLatestCandles('4h', 220),
        marketData.fetchLatestCandles('1d', 220),
      ]);

      const portfolio = loadPortfolio(db);
      const lastTrade = loadLatestTrade(db);
      const strategyState = loadStrategyState(db);
      const output = runStrategy({
        candles1m,
        candles4h,
        candles1d,
        portfolio,
        lastTrade,
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

      const sweep = await deps.runSweep({
        symbol: config.symbol,
        days: 90,
        executionInterval: '4h',
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
    marketDataProviders: marketData.providers,
  };
}

const backtestWorker = new BacktestWorkerClient();
const service = createService({
  symbol: SYMBOL,
  dbPath: DB_PATH,
  startingCapital: STARTING_CAPITAL,
}, {
  runSweep: (params) => backtestWorker.runSweep(params),
});

const app = express();
app.use(cors());
app.use(express.json());

async function runBacktestForService(query = {}) {
  const days = Number(query.days ?? 365);
  const executionInterval = String(query.executionInterval ?? '4h');
  const symbol = String(query.symbol ?? service.symbol);
  const strategyState = service.loadStrategyState();
  const cacheKey = `${symbol}:${executionInterval}:${days}:${strategyState.variant}:${strategyState.lastOptimized ?? 'none'}`;

  const cached = service.cacheGet(cacheKey);
  if (cached) return { ...cached, cached: true };

  const payload = await backtestWorker.runBacktest({
    symbol,
    executionInterval,
    days,
    strategyConfig: strategyState.strategyConfig,
    startingCapital: service.startingCapital,
  });
  service.cacheSet(cacheKey, payload);
  return { ...payload, cached: false };
}

async function runSweepForService(query = {}) {
  const days = Number(query.days ?? 365);
  const executionInterval = String(query.executionInterval ?? '4h');
  const symbol = String(query.symbol ?? service.symbol);
  const top = Number(query.top ?? 5);
  const cacheKey = `sweep:${symbol}:${executionInterval}:${days}:${top}`;

  const cached = service.cacheGet(cacheKey);
  if (cached) return { ...cached, cached: true };

  const payload = await backtestWorker.runSweep({
    symbol,
    executionInterval,
    days,
    top,
    startingCapital: service.startingCapital,
  });
  service.cacheSet(cacheKey, payload);
  return { ...payload, cached: false };
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    now: new Date().toISOString(),
    symbol: service.symbol,
    marketDataProviders: service.marketDataProviders,
    running: service.getState().isRunning,
  });
});

app.get('/api/state', (req, res) => {
  res.json(service.getState());
});

app.post('/api/actions/refresh', async (req, res) => {
  try {
    await service.runCycle();
    res.json(service.getState());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Refresh failed' });
  }
});

app.post('/api/actions/toggle', (req, res) => {
  const state = service.getState();
  const next = !state.isRunning;
  service.setBotRunning(next);
  if (next) {
    void service.maybeOptimize(true);
    void service.maybeRunCycle();
  }
  res.json(service.getState());
});

app.post('/api/actions/restart', async (req, res) => {
  try {
    service.resetAll();
    await service.runCycle();
    res.json(service.getState());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Restart failed' });
  }
});

app.get('/api/backtest', async (req, res) => {
  try {
    res.json(await runBacktestForService(req.query));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Backtest failed' });
  }
});

app.get('/api/backtest/sweep', async (req, res) => {
  try {
    res.json(await runSweepForService(req.query));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Sweep failed' });
  }
});

// Backward-compat aliases.
app.get('/api/xrp/state', (req, res) => res.json(service.getState()));
app.post('/api/xrp/actions/refresh', async (req, res) => {
  try {
    await service.runCycle();
    res.json(service.getState());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Refresh failed' });
  }
});
app.post('/api/xrp/actions/toggle', (req, res) => {
  const state = service.getState();
  const next = !state.isRunning;
  service.setBotRunning(next);
  if (next) {
    void service.maybeOptimize(true);
    void service.maybeRunCycle();
  }
  res.json(service.getState());
});
app.post('/api/xrp/actions/restart', async (req, res) => {
  try {
    service.resetAll();
    await service.runCycle();
    res.json(service.getState());
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

const httpServer = app.listen(PORT, async () => {
  console.log(`Trading bot API running on http://localhost:${PORT} (${service.symbol}) providers=${service.marketDataProviders.join(',')}`);
  try {
    await service.maybeOptimize(true);
    await service.runCycle();
  } catch (error) {
    console.error(`Initial cycle failed for ${service.symbol}:`, error);
  }

  setInterval(() => {
    void service.maybeOptimize();
    void service.maybeRunCycle();
  }, POLL_MS);
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wss.on('connection', (ws) => {
  ws.on('message', async (raw) => {
    try {
      const message = JSON.parse(String(raw));
      if (message.type === 'backtest:run') {
        const payload = await runBacktestForService(message.params ?? {});
        ws.send(JSON.stringify({
          type: 'backtest:result',
          requestId: message.requestId ?? null,
          payload,
        }));
        return;
      }

      if (message.type === 'sweep:run') {
        const payload = await runSweepForService(message.params ?? {});
        ws.send(JSON.stringify({
          type: 'sweep:result',
          requestId: message.requestId ?? null,
          payload,
        }));
      }
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        error: error instanceof Error ? error.message : 'Socket request failed',
      }));
    }
  });
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Shutting down (${signal})...`);

  try {
    await backtestWorker.terminate();
  } catch (error) {
    console.error('Failed to terminate backtest worker:', error);
  }

  wss.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
