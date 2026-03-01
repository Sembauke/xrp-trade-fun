import { runStrategy, defaultPortfolio, defaultStrategyConfig } from './strategy.js';

const INTERVAL_MS = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

const SWEEP_PRESETS = [
  {
    id: 'defensive',
    description: 'Lower allocation, stronger drawdown protection',
    strategyConfig: {
      maxTradeAllocationStep: 0.12,
      targetAllocation: {
        bull: { strong: 0.68, mild: 0.56, base: 0.42, riskOff: 0.22 },
        bear: { strong: 0.16, base: 0.06, riskOff: 0.02 },
        transition: { strong: 0.34, base: 0.22, riskOff: 0.08 },
      },
      drawdownRules: { hardStopPct: 0.35, softStopPct: 0.20, softCapAllocation: 0.12 },
    },
  },
  {
    id: 'balanced',
    description: 'Baseline strategy profile',
    strategyConfig: { ...defaultStrategyConfig },
  },
  {
    id: 'aggressive',
    description: 'Higher bull allocation and faster rebalancing',
    strategyConfig: {
      maxTradeAllocationStep: 0.25,
      targetAllocation: {
        bull: { strong: 0.92, mild: 0.80, base: 0.66, riskOff: 0.38 },
        bear: { strong: 0.34, base: 0.15, riskOff: 0.06 },
        transition: { strong: 0.60, base: 0.36, riskOff: 0.16 },
      },
      drawdownRules: { hardStopPct: 0.45, softStopPct: 0.30, softCapAllocation: 0.24 },
    },
  },
  {
    id: 'trend-max',
    description: 'Stronger trend bias with later risk-off trigger',
    strategyConfig: {
      maxTradeAllocationStep: 0.22,
      scoreThresholds: {
        bullStrong: 4,
        bullMild: 2,
        bullRiskOff: -5,
        bearStrong: 5,
        bearRiskOff: -3,
        transitionStrong: 3,
        transitionRiskOff: -4,
      },
      targetAllocation: {
        bull: { strong: 0.95, mild: 0.82, base: 0.72, riskOff: 0.40 },
        bear: { strong: 0.28, base: 0.12, riskOff: 0.04 },
        transition: { strong: 0.58, base: 0.34, riskOff: 0.14 },
      },
      drawdownRules: { hardStopPct: 0.42, softStopPct: 0.28, softCapAllocation: 0.22 },
    },
  },
];

function intervalToLabel(interval) {
  if (interval === '1m') return '1M';
  if (interval === '5m') return '5M';
  if (interval === '15m') return '15M';
  if (interval === '1h') return '1H';
  if (interval === '4h') return '4H';
  return '1D';
}

async function fetchCandlesRange({ symbol, interval, startTime, endTime }) {
  const stepMs = INTERVAL_MS[interval];
  if (!stepMs) throw new Error(`Unsupported interval: ${interval}`);

  let cursor = startTime;
  const out = [];

  while (cursor < endTime) {
    const url = new URL('https://api.binance.com/api/v3/klines');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', interval);
    url.searchParams.set('startTime', String(cursor));
    url.searchParams.set('endTime', String(endTime));
    url.searchParams.set('limit', '1000');

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Binance ${interval} HTTP ${response.status}`);
    }

    const rows = await response.json();
    if (!rows.length) break;

    for (const row of rows) {
      out.push({
        time: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      });
    }

    const lastTime = Number(rows[rows.length - 1][0]);
    const nextCursor = lastTime + stepMs;
    if (nextCursor <= cursor) break;
    cursor = nextCursor;

    if (rows.length < 1000) break;
  }

  return out;
}

function computeMaxDrawdownFromEquity(equityCurve) {
  if (!equityCurve.length) return 0;
  let peak = equityCurve[0].equity;
  let maxDd = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    const dd = peak > 0 ? (peak - point.equity) / peak : 0;
    maxDd = Math.max(maxDd, dd);
  }
  return maxDd;
}

async function fetchDataset({ symbol, days, executionInterval }) {
  if (!INTERVAL_MS[executionInterval]) {
    throw new Error('executionInterval must be one of 1m,5m,15m,1h,4h,1d');
  }

  const boundedDays = Math.max(30, Math.min(730, Number(days) || 365));
  const now = Date.now();
  const dayMs = 86_400_000;
  const startTime = now - boundedDays * dayMs;
  const warmupStart = startTime - 260 * dayMs;

  const [execCandles, candles4h, candles1d] = await Promise.all([
    fetchCandlesRange({ symbol, interval: executionInterval, startTime: warmupStart, endTime: now }),
    fetchCandlesRange({ symbol, interval: '4h', startTime: warmupStart, endTime: now }),
    fetchCandlesRange({ symbol, interval: '1d', startTime: warmupStart, endTime: now }),
  ]);

  if (execCandles.length < 260 || candles4h.length < 220 || candles1d.length < 220) {
    throw new Error('Not enough candles for a reliable backtest window');
  }

  return {
    symbol,
    executionInterval,
    days: boundedDays,
    startTime,
    endTime: now,
    execCandles,
    candles4h,
    candles1d,
  };
}

function simulateBacktest(dataset, { strategyConfig = defaultStrategyConfig, variant = 'custom' } = {}) {
  const { execCandles, candles4h, candles1d, startTime, endTime, symbol, executionInterval, days } = dataset;

  let portfolio = { ...defaultPortfolio };
  const trades = [];
  const equityCurve = [];
  let h4Idx = 0;
  let d1Idx = 0;

  for (let i = 0; i < execCandles.length; i += 1) {
    const candle = execCandles[i];
    const pointTime = candle.time;

    const execSlice = execCandles.slice(0, i + 1);
    if (execSlice.length < 210) continue;

    while (h4Idx + 1 < candles4h.length && candles4h[h4Idx + 1].time <= pointTime) h4Idx += 1;
    while (d1Idx + 1 < candles1d.length && candles1d[d1Idx + 1].time <= pointTime) d1Idx += 1;

    const h4Slice = candles4h.slice(0, h4Idx + 1);
    const d1Slice = candles1d.slice(0, d1Idx + 1);
    if (h4Slice.length < 210 || d1Slice.length < 210) continue;

    const result = runStrategy({
      candles1m: execSlice,
      candles4h: h4Slice,
      candles1d: d1Slice,
      portfolio,
      executionLabel: intervalToLabel(executionInterval),
      includeChartData: false,
      tradeTimeIso: new Date(pointTime).toISOString(),
      strategyConfig,
    });

    portfolio = result.portfolio;
    equityCurve.push({ time: pointTime, equity: result.totalValue });

    if (pointTime >= startTime && result.trade) {
      trades.push(result.trade);
    }
  }

  const filteredEquity = equityCurve.filter((point) => point.time >= startTime);
  const startEquity = filteredEquity[0]?.equity ?? defaultPortfolio.startingValue;
  const endEquity = filteredEquity[filteredEquity.length - 1]?.equity ?? startEquity;

  const sells = trades.filter((t) => t.action === 'SELL');
  const winningSells = sells.filter((t) => t.totalAfter > defaultPortfolio.startingValue).length;

  const startPrice = execCandles.find((c) => c.time >= startTime)?.close ?? 0;
  const endPrice = execCandles[execCandles.length - 1]?.close ?? 0;
  const benchmarkReturnPct = startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : 0;

  const returnPct = startEquity > 0 ? ((endEquity - startEquity) / startEquity) * 100 : 0;
  const maxDrawdownPct = computeMaxDrawdownFromEquity(filteredEquity) * 100;
  const winRatePct = sells.length > 0 ? (winningSells / sells.length) * 100 : 0;

  return {
    symbol,
    executionInterval,
    days,
    start: new Date(startTime).toISOString(),
    end: new Date(endTime).toISOString(),
    variant,
    tradeCount: trades.length,
    trades: trades.slice(-500),
    startEquity,
    endEquity,
    returnPct,
    maxDrawdownPct,
    winRatePct,
    avgTradeUsd: trades.length > 0
      ? trades.reduce((sum, trade) => sum + trade.usdValue, 0) / trades.length
      : 0,
    equityCurve: filteredEquity,
    benchmark: {
      startPrice,
      endPrice,
      returnPct: benchmarkReturnPct,
    },
    objectiveScore: returnPct - maxDrawdownPct * 0.65 + winRatePct * 0.08,
  };
}

export async function runBacktest({ symbol = 'XRPUSDT', days = 365, executionInterval = '1h', strategyConfig } = {}) {
  const dataset = await fetchDataset({ symbol, days, executionInterval });
  return simulateBacktest(dataset, { strategyConfig, variant: 'single' });
}

export async function runBacktestSweep({ symbol = 'XRPUSDT', days = 365, executionInterval = '1h', top = 5 } = {}) {
  const dataset = await fetchDataset({ symbol, days, executionInterval });

  const allResults = SWEEP_PRESETS.map((preset) => {
    const result = simulateBacktest(dataset, {
      strategyConfig: preset.strategyConfig,
      variant: preset.id,
    });

    return {
      ...result,
      description: preset.description,
      strategyConfig: preset.strategyConfig,
    };
  });

  const ranked = allResults
    .slice()
    .sort((a, b) => b.objectiveScore - a.objectiveScore);

  return {
    symbol,
    executionInterval,
    days: dataset.days,
    start: new Date(dataset.startTime).toISOString(),
    end: new Date(dataset.endTime).toISOString(),
    objective: 'score = returnPct - 0.65*maxDrawdownPct + 0.08*winRatePct',
    variantsTested: SWEEP_PRESETS.length,
    top: ranked.slice(0, Math.max(1, Math.min(Number(top) || 5, ranked.length))),
    all: ranked,
  };
}
