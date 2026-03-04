import {
  runStrategy,
  createDefaultPortfolio,
  defaultStrategyConfig,
  balancedStrategyConfig,
  activeQualityStrategyConfig,
  TRADE_FEE,
} from './strategy.js';
import { createMarketDataClient, INTERVAL_MS } from './market-data.js';

const DATASET_CACHE_TTL_MS = 10 * 60_000;
const datasetCache = new Map();

const SWEEP_PRESETS = [
  {
    id: 'defensive',
    description: 'Lower allocation, stronger drawdown protection',
    strategyConfig: {
      maxTradeAllocationStep: 0.18,
      targetAllocation: {
        bull: { strong: 0.76, mild: 0.64, base: 0.50, riskOff: 0.30 },
        bear: { strong: 0.22, base: 0.10, riskOff: 0.05 },
        transition: { strong: 0.42, base: 0.28, riskOff: 0.14 },
      },
      drawdownRules: { hardStopPct: 0.35, softStopPct: 0.20, softCapAllocation: 0.12 },
    },
  },
  {
    id: 'balanced',
    description: 'Baseline strategy profile',
    strategyConfig: { ...balancedStrategyConfig },
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
  {
    id: 'active-quality',
    description: 'Active profile with directional score guards',
    strategyConfig: { ...activeQualityStrategyConfig },
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

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(Math.max(variance, 0));
}

function buildRobustnessWindows(days) {
  const base = Math.max(30, Math.min(730, Number(days) || 180));
  const candidates = [
    base,
    Math.round(base * 0.67),
    Math.round(base * 0.45),
  ];

  const out = [];
  for (const candidate of candidates) {
    const bounded = Math.max(30, Math.min(base, candidate));
    if (!out.includes(bounded)) out.push(bounded);
  }
  return out.sort((a, b) => b - a);
}

function createWindowedDataset(dataset, days) {
  const boundedDays = Math.max(30, Math.min(dataset.days, Number(days) || dataset.days));
  if (boundedDays >= dataset.days) return dataset;
  return {
    ...dataset,
    days: boundedDays,
    startTime: dataset.endTime - boundedDays * 86_400_000,
  };
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
  const marketData = createMarketDataClient({ symbol });

  const [execCandles, candles4h, candles1d] = await Promise.all([
    marketData.fetchCandlesRange({ interval: executionInterval, startTime: warmupStart, endTime: now }),
    marketData.fetchCandlesRange({ interval: '4h', startTime: warmupStart, endTime: now }),
    marketData.fetchCandlesRange({ interval: '1d', startTime: warmupStart, endTime: now }),
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

async function fetchDatasetCached({ symbol, days, executionInterval }) {
  const key = `${symbol}:${executionInterval}:${days}`;
  const now = Date.now();
  const cached = datasetCache.get(key);
  if (cached && now - cached.createdAt < DATASET_CACHE_TTL_MS) {
    return cached.payload;
  }

  const payload = await fetchDataset({ symbol, days, executionInterval });
  datasetCache.set(key, { createdAt: now, payload });
  return payload;
}

function simulateBacktest(dataset, {
  strategyConfig = defaultStrategyConfig,
  variant = 'custom',
  startingCapital = 10_000,
} = {}) {
  const { execCandles, candles4h, candles1d, startTime, endTime, symbol, executionInterval, days } = dataset;

  const initialPortfolio = createDefaultPortfolio(startingCapital);
  let portfolio = { ...initialPortfolio };
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

    if (pointTime < startTime) {
      continue;
    }

    const portfolioBefore = { ...portfolio };
    const lastTrade = trades[trades.length - 1] ?? null;
    const result = runStrategy({
      candles1m: execSlice,
      candles4h: h4Slice,
      candles1d: d1Slice,
      portfolio,
      lastTrade,
      executionLabel: intervalToLabel(executionInterval),
      includeChartData: false,
      tradeTimeIso: new Date(pointTime).toISOString(),
      strategyConfig,
      startingCapital,
    });

    portfolio = result.portfolio;
    equityCurve.push({ time: pointTime, equity: result.totalValue });

    if (result.trade) {
      if (result.trade.action === 'SELL') {
        const sellFee = result.trade.usdValue * TRADE_FEE;
        const realizedPnl = result.trade.realizedPnl
          ?? ((result.trade.price - portfolioBefore.avgCostBasis) * result.trade.amount - sellFee);
        trades.push({
          ...result.trade,
          realizedPnl,
        });
      } else {
        trades.push(result.trade);
      }
    }
  }

  const startEquity = initialPortfolio.startingValue;
  const endEquity = equityCurve[equityCurve.length - 1]?.equity ?? startEquity;

  const sells = trades.filter((t) => t.action === 'SELL');
  const winningSells = sells.filter((t) => (t.realizedPnl ?? 0) > 0).length;

  const startPrice = execCandles.find((c) => c.time >= startTime)?.close ?? 0;
  const endPrice = execCandles[execCandles.length - 1]?.close ?? 0;
  const benchmarkReturnPct = startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : 0;

  const returnPct = startEquity > 0 ? ((endEquity - startEquity) / startEquity) * 100 : 0;
  const maxDrawdownPct = computeMaxDrawdownFromEquity(equityCurve) * 100;
  const winRatePct = sells.length > 0 ? (winningSells / sells.length) * 100 : 0;
  const intervalActivityBase = executionInterval === '1m'
    ? 360
    : executionInterval === '5m'
      ? 220
      : executionInterval === '15m'
        ? 140
        : executionInterval === '1h'
          ? 70
          : executionInterval === '4h'
            ? 35
            : 20;
  const targetTrades = Math.max(25, Math.round((days / 180) * intervalActivityBase));
  const activityScore = Math.min(8, (trades.length / Math.max(targetTrades, 1)) * 4);
  const lowWinPenalty = winRatePct < 38 ? (38 - winRatePct) * 0.4 : 0;

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
    equityCurve,
    benchmark: {
      startPrice,
      endPrice,
      returnPct: benchmarkReturnPct,
    },
    objectiveScore: returnPct - maxDrawdownPct * 0.62 + winRatePct * 0.10 + activityScore - lowWinPenalty,
  };
}

export async function runBacktest({
  symbol = 'XRPUSDT',
  days = 180,
  executionInterval = '4h',
  strategyConfig,
  startingCapital = 10_000,
} = {}) {
  const dataset = await fetchDatasetCached({ symbol, days, executionInterval });
  return simulateBacktest(dataset, { strategyConfig, variant: 'single', startingCapital });
}

export async function runBacktestSweep({
  symbol = 'XRPUSDT',
  days = 180,
  executionInterval = '4h',
  top = 5,
  startingCapital = 10_000,
} = {}) {
  const dataset = await fetchDatasetCached({ symbol, days, executionInterval });
  const windows = buildRobustnessWindows(dataset.days);
  const windowDatasets = windows.map((windowDays) => createWindowedDataset(dataset, windowDays));

  const allResults = SWEEP_PRESETS.map((preset) => {
    const windowResults = windowDatasets.map((windowDataset) => (
      simulateBacktest(windowDataset, {
        strategyConfig: preset.strategyConfig,
        variant: preset.id,
        startingCapital,
      })
    ));
    const primary = windowResults[0];
    const windowScores = windowResults.map((row) => row.objectiveScore);
    const windowReturns = windowResults.map((row) => row.returnPct);
    const meanWindowScore = average(windowScores);
    const scoreStdDev = standardDeviation(windowScores);
    const worstWindowReturnPct = Math.min(...windowReturns);

    // Blend point-in-time quality (primary) with consistency across windows.
    const robustnessScore = meanWindowScore - scoreStdDev * 0.7;
    const worstReturnPenalty = Math.max(0, -worstWindowReturnPct) * 0.08;
    const combinedObjective = primary.objectiveScore * 0.65 + robustnessScore * 0.35 - worstReturnPenalty;

    return {
      ...primary,
      objectiveScore: combinedObjective,
      robustness: {
        windows,
        meanWindowScore,
        scoreStdDev,
        worstWindowReturnPct,
        breakdown: windows.map((windowDays, index) => ({
          days: windowDays,
          returnPct: windowResults[index].returnPct,
          maxDrawdownPct: windowResults[index].maxDrawdownPct,
          tradeCount: windowResults[index].tradeCount,
          objectiveScore: windowResults[index].objectiveScore,
        })),
      },
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
    objective: 'score = 0.65*primaryScore + 0.35*(meanWindowScore - 0.7*scoreStdDev) - 0.08*max(0,-worstWindowReturnPct)',
    variantsTested: SWEEP_PRESETS.length,
    robustWindows: windows,
    top: ranked.slice(0, Math.max(1, Math.min(Number(top) || 5, ranked.length))),
    all: ranked,
  };
}
