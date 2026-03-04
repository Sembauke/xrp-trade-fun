import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import {
  createDb,
  getState,
  loadPortfolio,
  loadLatestTrade,
  loadStrategyState,
  saveCycle,
  setBotRunning,
  setError,
  resetAll,
} from './db.js';
import { runGeminiStrategy } from './gemini-strategy.js';
import { createMarketDataClient } from './market-data.js';

const PORT = Number(process.env.PORT || 8787);
const POLL_MS = Number(process.env.POLL_MS || 10 * 60_000);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 8_000);
const SYMBOL = process.env.SYMBOL || 'XRPUSDT';
const MARKET_DATA_PROVIDERS = process.env.MARKET_DATA_PROVIDERS || 'bybit,binance_vision,binance';
const DB_PATH = process.env.DB_PATH || process.env.DB_PATH_XRP || 'data/trading.db';
const STARTING_CAPITAL = Number(process.env.STARTING_CAPITAL || process.env.STARTING_CAPITAL_XRP || 10_000);

function createService(config) {
  const db = createDb({
    dbPath: config.dbPath,
    startingCapital: config.startingCapital,
  });

  let cycleRunning = false;
  const marketData = createMarketDataClient({
    symbol: config.symbol,
    timeoutMs: FETCH_TIMEOUT_MS,
    providers: MARKET_DATA_PROVIDERS,
  });

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
      const output = await runGeminiStrategy({
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

  return {
    id: config.id,
    symbol: config.symbol,
    runCycle,
    maybeRunCycle,
    getState: () => getState(db, config.symbol),
    setBotRunning: (isRunning) => setBotRunning(db, isRunning),
    resetAll: () => resetAll(db),
    marketDataProviders: marketData.providers,
  };
}

const service = createService({
  symbol: SYMBOL,
  dbPath: DB_PATH,
  startingCapital: STARTING_CAPITAL,
});

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    now: new Date().toISOString(),
    symbol: service.symbol,
    marketDataProviders: service.marketDataProviders,
    running: service.getState().isRunning,
    cadenceMs: POLL_MS,
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

app.get('/api/backtest', (req, res) => {
  res.status(410).json({ error: 'Backtest removed for Gemini-driven trading mode.' });
});

app.get('/api/backtest/sweep', (req, res) => {
  res.status(410).json({ error: 'Sweep removed for Gemini-driven trading mode.' });
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
  console.log(
    `Trading bot API running on http://localhost:${PORT} (${service.symbol}) providers=${service.marketDataProviders.join(',')} cadence=${POLL_MS}ms`,
  );
  try {
    await service.runCycle();
  } catch (error) {
    console.error(`Initial cycle failed for ${service.symbol}:`, error);
  }
});

const cycleTimer = setInterval(() => {
  void service.maybeRunCycle();
}, POLL_MS);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Shutting down (${signal})...`);

  clearInterval(cycleTimer);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
