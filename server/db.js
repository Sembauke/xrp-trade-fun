import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { defaultPortfolio, defaultStrategyConfig } from './strategy.js';

const DB_PATH = path.resolve(process.cwd(), 'data', 'trading.db');

function ensureDir() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

function ensureColumn(db, table, column, sqlType) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = cols.some((c) => c.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType}`);
  }
}

export function createDb() {
  ensureDir();
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      usd REAL NOT NULL,
      xrp REAL NOT NULL,
      starting_value REAL NOT NULL,
      avg_cost_basis REAL NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bot_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      current_price REAL NOT NULL,
      previous_price REAL NOT NULL,
      is_running INTEGER NOT NULL,
      is_loading INTEGER NOT NULL,
      error TEXT,
      last_update TEXT,
      total_value REAL NOT NULL,
      pnl REAL NOT NULL,
      pnl_pct REAL NOT NULL,
      decision_json TEXT,
      indicators_json TEXT,
      regime TEXT
    );

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      time TEXT NOT NULL,
      action TEXT NOT NULL,
      price REAL NOT NULL,
      amount REAL NOT NULL,
      usd_value REAL NOT NULL,
      reason TEXT NOT NULL,
      total_after REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chart_points (
      time INTEGER PRIMARY KEY,
      price REAL NOT NULL,
      ema20 REAL NOT NULL,
      ema50 REAL NOT NULL,
      ema200 REAL NOT NULL,
      bb_upper REAL NOT NULL,
      bb_middle REAL NOT NULL,
      bb_lower REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS strategy_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      variant TEXT NOT NULL,
      config_json TEXT NOT NULL,
      auto_optimize INTEGER NOT NULL,
      last_optimized TEXT
    );
  `);
  ensureColumn(db, 'trades', 'realized_pnl', 'REAL');

  const nowIso = new Date().toISOString();
  db.prepare(`
    INSERT INTO portfolio (id, usd, xrp, starting_value, avg_cost_basis, updated_at)
    VALUES (1, @usd, @xrp, @starting_value, @avg_cost_basis, @updated_at)
    ON CONFLICT(id) DO NOTHING
  `).run({
    usd: defaultPortfolio.usd,
    xrp: defaultPortfolio.xrp,
    starting_value: defaultPortfolio.startingValue,
    avg_cost_basis: defaultPortfolio.avgCostBasis,
    updated_at: nowIso,
  });

  db.prepare(`
    INSERT INTO bot_state (
      id, current_price, previous_price, is_running, is_loading, error,
      last_update, total_value, pnl, pnl_pct, decision_json, indicators_json, regime
    )
    VALUES (1, 0, 0, 1, 1, NULL, NULL, @starting, 0, 0, NULL, NULL, 'TRANSITION')
    ON CONFLICT(id) DO NOTHING
  `).run({ starting: defaultPortfolio.startingValue });

  db.prepare(`
    INSERT INTO strategy_state (id, variant, config_json, auto_optimize, last_optimized)
    VALUES (1, 'balanced', @config_json, 1, NULL)
    ON CONFLICT(id) DO NOTHING
  `).run({
    config_json: JSON.stringify(defaultStrategyConfig),
  });

  return db;
}

export function loadPortfolio(db) {
  const row = db.prepare('SELECT * FROM portfolio WHERE id = 1').get();
  if (!row) {
    return { ...defaultPortfolio };
  }

  return {
    usd: row.usd,
    xrp: row.xrp,
    startingValue: row.starting_value,
    avgCostBasis: row.avg_cost_basis,
  };
}

export function saveCycle(db, payload) {
  const nowIso = new Date().toISOString();
  const previous = db.prepare('SELECT current_price FROM bot_state WHERE id = 1').get();
  const previousPrice = previous?.current_price ?? 0;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE portfolio
      SET usd = @usd,
          xrp = @xrp,
          starting_value = @starting_value,
          avg_cost_basis = @avg_cost_basis,
          updated_at = @updated_at
      WHERE id = 1
    `).run({
      usd: payload.portfolio.usd,
      xrp: payload.portfolio.xrp,
      starting_value: payload.portfolio.startingValue,
      avg_cost_basis: payload.portfolio.avgCostBasis,
      updated_at: nowIso,
    });

    if (payload.trade) {
      db.prepare(`
        INSERT OR REPLACE INTO trades (
          id, time, action, price, amount, usd_value, reason, total_after, realized_pnl
        )
        VALUES (
          @id, @time, @action, @price, @amount, @usdValue, @reason, @totalAfter, @realizedPnl
        )
      `).run(payload.trade);
    }

    db.prepare('DELETE FROM chart_points').run();
    const insertPoint = db.prepare(`
      INSERT INTO chart_points (time, price, ema20, ema50, ema200, bb_upper, bb_middle, bb_lower)
      VALUES (@time, @price, @ema20, @ema50, @ema200, @bbUpper, @bbMiddle, @bbLower)
    `);
    for (const point of payload.chartData.slice(-220)) {
      insertPoint.run(point);
    }

    db.prepare(`
      UPDATE bot_state
      SET current_price = @current_price,
          previous_price = @previous_price,
          is_loading = 0,
          error = NULL,
          last_update = @last_update,
          total_value = @total_value,
          pnl = @pnl,
          pnl_pct = @pnl_pct,
          decision_json = @decision_json,
          indicators_json = @indicators_json,
          regime = @regime
      WHERE id = 1
    `).run({
      current_price: payload.price,
      previous_price: previousPrice || payload.price,
      last_update: nowIso,
      total_value: payload.totalValue,
      pnl: payload.pnl,
      pnl_pct: payload.pnlPct,
      decision_json: JSON.stringify(payload.decision),
      indicators_json: JSON.stringify(payload.indicators),
      regime: payload.indicators.regime,
    });
  });

  tx();
}

export function loadStrategyState(db) {
  const row = db.prepare('SELECT * FROM strategy_state WHERE id = 1').get();
  if (!row) {
    return {
      variant: 'balanced',
      strategyConfig: defaultStrategyConfig,
      autoOptimize: true,
      lastOptimized: null,
    };
  }

  return {
    variant: row.variant,
    strategyConfig: row.config_json ? JSON.parse(row.config_json) : defaultStrategyConfig,
    autoOptimize: Boolean(row.auto_optimize),
    lastOptimized: row.last_optimized ?? null,
  };
}

export function saveStrategyState(db, { variant, strategyConfig, autoOptimize, lastOptimized }) {
  db.prepare(`
    UPDATE strategy_state
    SET variant = @variant,
        config_json = @config_json,
        auto_optimize = @auto_optimize,
        last_optimized = @last_optimized
    WHERE id = 1
  `).run({
    variant,
    config_json: JSON.stringify(strategyConfig),
    auto_optimize: autoOptimize ? 1 : 0,
    last_optimized: lastOptimized,
  });
}

export function setBotRunning(db, isRunning) {
  db.prepare('UPDATE bot_state SET is_running = @is_running WHERE id = 1').run({
    is_running: isRunning ? 1 : 0,
  });
}

export function setError(db, message) {
  db.prepare('UPDATE bot_state SET is_loading = 0, error = @error WHERE id = 1').run({
    error: message,
  });
}

export function resetAll(db) {
  const nowIso = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM trades').run();
    db.prepare('DELETE FROM chart_points').run();

    db.prepare(`
      UPDATE portfolio
      SET usd = @usd,
          xrp = @xrp,
          starting_value = @starting_value,
          avg_cost_basis = @avg_cost_basis,
          updated_at = @updated_at
      WHERE id = 1
    `).run({
      usd: defaultPortfolio.usd,
      xrp: defaultPortfolio.xrp,
      starting_value: defaultPortfolio.startingValue,
      avg_cost_basis: defaultPortfolio.avgCostBasis,
      updated_at: nowIso,
    });

    db.prepare(`
      UPDATE bot_state
      SET current_price = 0,
          previous_price = 0,
          is_loading = 1,
          error = NULL,
          last_update = NULL,
          total_value = @starting,
          pnl = 0,
          pnl_pct = 0,
          decision_json = NULL,
          indicators_json = NULL,
          regime = 'TRANSITION'
      WHERE id = 1
    `).run({ starting: defaultPortfolio.startingValue });

    db.prepare(`
      UPDATE strategy_state
      SET variant = 'balanced',
          config_json = @config_json,
          auto_optimize = 1,
          last_optimized = NULL
      WHERE id = 1
    `).run({
      config_json: JSON.stringify(defaultStrategyConfig),
    });
  });

  tx();
}

export function getState(db) {
  const portfolio = loadPortfolio(db);
  const bot = db.prepare('SELECT * FROM bot_state WHERE id = 1').get();
  const trades = db
    .prepare('SELECT * FROM trades ORDER BY time DESC LIMIT 100')
    .all()
    .map((row) => ({
      id: row.id,
      time: row.time,
      action: row.action,
      price: row.price,
      amount: row.amount,
      usdValue: row.usd_value,
      reason: row.reason,
      totalAfter: row.total_after,
      realizedPnl: row.realized_pnl,
    }));

  const chartData = db
    .prepare('SELECT * FROM chart_points ORDER BY time ASC')
    .all()
    .map((row) => ({
      time: row.time,
      price: row.price,
      ema20: row.ema20,
      ema50: row.ema50,
      ema200: row.ema200,
      bbUpper: row.bb_upper,
      bbMiddle: row.bb_middle,
      bbLower: row.bb_lower,
    }));
  const strategy = loadStrategyState(db);

  return {
    candles: [],
    currentPrice: bot?.current_price ?? 0,
    previousPrice: bot?.previous_price ?? 0,
    portfolio,
    trades,
    decision: bot?.decision_json ? JSON.parse(bot.decision_json) : null,
    indicators: bot?.indicators_json ? JSON.parse(bot.indicators_json) : null,
    chartData,
    isLoading: Boolean(bot?.is_loading),
    isRunning: Boolean(bot?.is_running),
    error: bot?.error ?? null,
    lastUpdate: bot?.last_update ?? null,
    totalValue: bot?.total_value ?? defaultPortfolio.startingValue,
    pnl: bot?.pnl ?? 0,
    pnlPct: bot?.pnl_pct ?? 0,
    strategy: {
      variant: strategy.variant,
      autoOptimize: strategy.autoOptimize,
      lastOptimized: strategy.lastOptimized,
    },
  };
}
