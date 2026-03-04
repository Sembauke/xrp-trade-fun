import {
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollinger,
  computeMaxDrawdown,
} from './indicators.js';

const envStart = parseFloat(process.env.STARTING_CAPITAL ?? '');
export const STARTING_CAPITAL = Number.isFinite(envStart) && envStart > 0 ? envStart : 10_000;
export const TRADE_FEE = 0.001;

export const DEFAULT_STRATEGY_VARIANT = 'active-quality';

export const balancedStrategyConfig = {
  maxTradeAllocationStep: 0.26,
  minOrderUsd: 15,
  minOrderPct: 0.0025,
  minRebalanceDeltaPct: 0.009,
  flipCooldownMinutes: 8,
  minFlipMovePct: 0.002,
  forceExitScore: -7,
  maxTolerableLossSellPct: 0.0025,
  directionalGuards: {
    buyMinScore: { bull: -1, transition: 0, bear: 1 },
    sellMaxScore: { bull: -1, transition: 0, bear: 2 },
  },
  scoreThresholds: {
    bullStrong: 4,
    bullMild: 2,
    bullRiskOff: -5,
    bearStrong: 3,
    bearRiskOff: -4,
    transitionStrong: 3,
    transitionRiskOff: -4,
  },
  targetAllocation: {
    bull: { strong: 0.88, mild: 0.76, base: 0.62, riskOff: 0.36 },
    bear: { strong: 0.32, base: 0.16, riskOff: 0.08 },
    transition: { strong: 0.56, base: 0.36, riskOff: 0.18 },
  },
  drawdownRules: {
    hardStopPct: 0.40,
    softStopPct: 0.25,
    softCapAllocation: 0.20,
  },
};

export const activeQualityStrategyConfig = {
  maxTradeAllocationStep: 0.30,
  minOrderUsd: 12,
  minOrderPct: 0.0020,
  minRebalanceDeltaPct: 0.006,
  flipCooldownMinutes: 6,
  minFlipMovePct: 0.0015,
  forceExitScore: -7,
  maxTolerableLossSellPct: 0.002,
  directionalGuards: {
    buyMinScore: { bull: -1, transition: 0, bear: 1 },
    sellMaxScore: { bull: -1, transition: 0, bear: 2 },
  },
  scoreThresholds: {
    bullStrong: 4,
    bullMild: 2,
    bullRiskOff: -5,
    bearStrong: 3,
    bearRiskOff: -4,
    transitionStrong: 3,
    transitionRiskOff: -4,
  },
  targetAllocation: {
    bull: { strong: 0.96, mild: 0.84, base: 0.68, riskOff: 0.34 },
    bear: { strong: 0.40, base: 0.18, riskOff: 0.06 },
    transition: { strong: 0.64, base: 0.40, riskOff: 0.16 },
  },
  drawdownRules: {
    hardStopPct: 0.40,
    softStopPct: 0.24,
    softCapAllocation: 0.20,
  },
};

export const defaultStrategyConfig = { ...activeQualityStrategyConfig };

export function createDefaultPortfolio(startingCapital = STARTING_CAPITAL) {
  return {
    usd: startingCapital,
    xrp: 0,
    startingValue: startingCapital,
    avgCostBasis: 0,
  };
}

export const defaultPortfolio = createDefaultPortfolio(STARTING_CAPITAL);

function getRegime(dayEMA50, dayEMA200, h4EMA50, h4EMA200) {
  const macroBull = dayEMA50 > dayEMA200;
  const trendBull = h4EMA50 > h4EMA200;
  const macroBear = dayEMA50 < dayEMA200;
  const trendBear = h4EMA50 < h4EMA200;

  if (macroBull && trendBull) return 'BULL';
  if (macroBear && trendBear) return 'BEAR';
  return 'TRANSITION';
}

function buildSignals(ctx) {
  const signals = [];

  const macroDiffPct = ((ctx.dayEMA50 - ctx.dayEMA200) / ctx.dayEMA200) * 100;
  const macroValue = macroDiffPct > 1.5 ? 2 : macroDiffPct > 0 ? 1 : macroDiffPct < -1.5 ? -2 : macroDiffPct < 0 ? -1 : 0;
  signals.push({
    name: 'Macro Trend (1D)',
    value: macroValue,
    description: `EMA50 vs EMA200: ${macroDiffPct >= 0 ? '+' : ''}${macroDiffPct.toFixed(2)}%`,
  });

  const primaryDiffPct = ((ctx.h4EMA50 - ctx.h4EMA200) / ctx.h4EMA200) * 100;
  const primaryValue = primaryDiffPct > 0.8 ? 2 : primaryDiffPct > 0 ? 1 : primaryDiffPct < -0.8 ? -2 : primaryDiffPct < 0 ? -1 : 0;
  signals.push({
    name: 'Primary Trend (4H)',
    value: primaryValue,
    description: `EMA50 vs EMA200: ${primaryDiffPct >= 0 ? '+' : ''}${primaryDiffPct.toFixed(2)}%`,
  });

  const pullbackValue =
    ctx.rsi1m < 34 && ctx.price < ctx.ema20 * 0.995 ? 2
      : ctx.rsi1m < 42 && ctx.price < ctx.ema20 ? 1
        : ctx.rsi1m > 68 && ctx.price > ctx.ema20 * 1.005 ? -2
          : ctx.rsi1m > 60 && ctx.price > ctx.ema20 ? -1
            : 0;
  signals.push({
    name: `Execution Pullback (${ctx.executionLabel})`,
    value: pullbackValue,
    description: `RSI ${ctx.rsi1m.toFixed(1)} at EMA20 ${ctx.ema20.toFixed(4)}`,
  });

  const macdValue =
    ctx.macd4h.histogram > 0.003 ? 2
      : ctx.macd4h.histogram > 0 ? 1
        : ctx.macd4h.histogram < -0.003 ? -2
          : ctx.macd4h.histogram < 0 ? -1
            : 0;
  signals.push({
    name: 'Momentum (4H MACD)',
    value: macdValue,
    description: `Histogram ${ctx.macd4h.histogram >= 0 ? '+' : ''}${ctx.macd4h.histogram.toFixed(5)}`,
  });

  const riskValue = ctx.dayDrawdown > 0.22 ? -2 : ctx.dayDrawdown > 0.12 ? -1 : 1;
  signals.push({
    name: 'Risk Regime',
    value: riskValue,
    description: `90D drawdown ${(ctx.dayDrawdown * 100).toFixed(1)}%`,
  });

  return signals;
}

function mergeStrategyConfig(overrides = {}) {
  return {
    ...defaultStrategyConfig,
    ...overrides,
    scoreThresholds: {
      ...defaultStrategyConfig.scoreThresholds,
      ...(overrides.scoreThresholds ?? {}),
    },
    targetAllocation: {
      bull: {
        ...defaultStrategyConfig.targetAllocation.bull,
        ...(overrides.targetAllocation?.bull ?? {}),
      },
      bear: {
        ...defaultStrategyConfig.targetAllocation.bear,
        ...(overrides.targetAllocation?.bear ?? {}),
      },
      transition: {
        ...defaultStrategyConfig.targetAllocation.transition,
        ...(overrides.targetAllocation?.transition ?? {}),
      },
    },
    drawdownRules: {
      ...defaultStrategyConfig.drawdownRules,
      ...(overrides.drawdownRules ?? {}),
    },
    directionalGuards: {
      buyMinScore: {
        ...defaultStrategyConfig.directionalGuards.buyMinScore,
        ...(overrides.directionalGuards?.buyMinScore ?? {}),
      },
      sellMaxScore: {
        ...defaultStrategyConfig.directionalGuards.sellMaxScore,
        ...(overrides.directionalGuards?.sellMaxScore ?? {}),
      },
    },
  };
}

function targetAllocation(regime, score, strategyConfig) {
  const thresholds = strategyConfig.scoreThresholds;
  const targetCfg = strategyConfig.targetAllocation;

  if (regime === 'BULL') {
    if (score >= thresholds.bullStrong) return targetCfg.bull.strong;
    if (score >= thresholds.bullMild) return targetCfg.bull.mild;
    if (score <= thresholds.bullRiskOff) return targetCfg.bull.riskOff;
    return targetCfg.bull.base;
  }

  if (regime === 'BEAR') {
    if (score >= thresholds.bearStrong) return targetCfg.bear.strong;
    if (score <= thresholds.bearRiskOff) return targetCfg.bear.riskOff;
    return targetCfg.bear.base;
  }

  if (score >= thresholds.transitionStrong) return targetCfg.transition.strong;
  if (score <= thresholds.transitionRiskOff) return targetCfg.transition.riskOff;
  return targetCfg.transition.base;
}

function strengthFromDelta(delta) {
  const abs = Math.abs(delta);
  if (abs >= 0.12) return 'STRONG';
  if (abs >= 0.06) return 'NORMAL';
  return 'WEAK';
}

function calculateATR(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i += 1) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    trs.push(tr);
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export function runStrategy({
  candles1m,
  candles4h,
  candles1d,
  portfolio,
  executionLabel = '1M',
  includeChartData = true,
  tradeTimeIso,
  lastTrade = null,
  strategyConfig: strategyConfigInput,
  symbol = 'XRPUSDT',
  startingCapital = portfolio?.startingValue ?? STARTING_CAPITAL,
}) {
  const assetLabel = symbol.replace('USDT', '');
  const strategyConfig = mergeStrategyConfig(strategyConfigInput);
  const closes1m = candles1m.map((c) => c.close);
  const closes4h = candles4h.map((c) => c.close);
  const closes1d = candles1d.map((c) => c.close);

  const price = closes1m[closes1m.length - 1] ?? 0;

  const ema20Arr = calculateEMA(closes1m, 20);
  const ema50Arr = calculateEMA(closes1m, 50);
  const ema200Arr = calculateEMA(closes1m, 200);
  const bollinger = calculateBollinger(closes1m, 20, 2);
  const rsi1m = calculateRSI(closes1m, 14);

  const h4EMA50 = calculateEMA(closes4h, 50).at(-1) ?? price;
  const h4EMA200 = calculateEMA(closes4h, 200).at(-1) ?? price;
  const dayEMA50 = calculateEMA(closes1d, 50).at(-1) ?? price;
  const dayEMA200 = calculateEMA(closes1d, 200).at(-1) ?? price;
  const dayRSI = calculateRSI(closes1d, 14);

  const macd4h = calculateMACD(closes4h);
  const dayDrawdown = computeMaxDrawdown(closes1d.slice(-90));
  const atr4h = calculateATR(candles4h, 14);
  const atrPct = atr4h && price > 0 ? atr4h / price : null;

  const regime = getRegime(dayEMA50, dayEMA200, h4EMA50, h4EMA200);

  const signals = buildSignals({
    dayEMA50,
    dayEMA200,
    h4EMA50,
    h4EMA200,
    rsi1m,
    ema20: ema20Arr.at(-1) ?? price,
    macd4h,
    dayDrawdown,
    price,
    executionLabel,
  });

  const totalScore = signals.reduce((acc, signal) => acc + signal.value, 0);

  const totalValueBefore = portfolio.usd + portfolio.xrp * price;
  const currentAllocation = totalValueBefore > 0 ? (portfolio.xrp * price) / totalValueBefore : 0;

  let target = targetAllocation(regime, totalScore, strategyConfig);
  // Volatiliteit-gewogen aanpassing: hogere ATR => lager risico, lage ATR => iets meer risico
  if (atrPct !== null) {
    if (atrPct > 0.06) target *= 0.75;
    else if (atrPct < 0.025) target *= 1.10;
    target = Math.max(0, Math.min(0.95, target));
  }

  const portfolioDrawdown =
    portfolio.startingValue > 0
      ? Math.max(0, (portfolio.startingValue - totalValueBefore) / portfolio.startingValue)
      : 0;
  if (portfolioDrawdown > strategyConfig.drawdownRules.hardStopPct) {
    target = 0;
  } else if (portfolioDrawdown > strategyConfig.drawdownRules.softStopPct) {
    target = Math.min(target, strategyConfig.drawdownRules.softCapAllocation);
  }

  const stepFactor = atrPct !== null
    ? (atrPct > 0.06 ? 0.6 : atrPct < 0.025 ? 1.15 : 1.0)
    : 1.0;
  const maxStep = strategyConfig.maxTradeAllocationStep * stepFactor;

  const rawDelta = target - currentAllocation;
  const deltaPreBand = Math.max(-maxStep, Math.min(maxStep, rawDelta));
  const minRebalanceDeltaPct = Math.max(0, Number(strategyConfig.minRebalanceDeltaPct) || 0);
  const delta = Math.abs(rawDelta) < minRebalanceDeltaPct ? 0 : deltaPreBand;

  const desiredUsdShift = delta * totalValueBefore;
  const minOrderUsd = Math.max(
    Number(strategyConfig.minOrderUsd) || 0,
    totalValueBefore * Math.max(0, Number(strategyConfig.minOrderPct) || 0),
  );

  const basePortfolio = { ...portfolio };
  let nextPortfolio = { ...portfolio };
  let trade = null;
  let action = 'HOLD';
  let amount = 0;
  let realizedPnl = null;
  let guardReason = null;

  const nowMs = tradeTimeIso ? new Date(tradeTimeIso).getTime() : Date.now();
  const lastTradePrice = Number(lastTrade?.price);
  const lastTradeTimeMs = lastTrade?.time ? new Date(lastTrade.time).getTime() : NaN;
  const flipCooldownMs = Math.max(0, Number(strategyConfig.flipCooldownMinutes) || 0) * 60_000;
  const minFlipMovePct = Math.max(0, Number(strategyConfig.minFlipMovePct) || 0);
  const forceExitScore = Number(strategyConfig.forceExitScore);
  const forceExit = Number.isFinite(forceExitScore) ? totalScore <= forceExitScore : false;
  const maxTolerableLossSellPct = Math.max(0, Number(strategyConfig.maxTolerableLossSellPct) || 0);
  const regimeKey = regime.toLowerCase();
  const minBuyScore = Number(strategyConfig.directionalGuards?.buyMinScore?.[regimeKey]);
  const maxSellScore = Number(strategyConfig.directionalGuards?.sellMaxScore?.[regimeKey]);

  function shouldBlockFlip(nextAction) {
    if (!lastTrade || !lastTrade.action || lastTrade.action === nextAction) return null;

    if (Number.isFinite(lastTradeTimeMs) && Number.isFinite(nowMs) && nowMs > lastTradeTimeMs) {
      const elapsedMs = nowMs - lastTradeTimeMs;
      if (elapsedMs < flipCooldownMs) {
        return `cooldown actief (${Math.ceil((flipCooldownMs - elapsedMs) / 60_000)}m resterend)`;
      }
    }

    if (Number.isFinite(lastTradePrice) && lastTradePrice > 0) {
      const movePct = Math.abs(price - lastTradePrice) / lastTradePrice;
      if (movePct < minFlipMovePct) {
        return `prijsbeweging te klein sinds laatste trade (${(movePct * 100).toFixed(2)}%)`;
      }
    }

    return null;
  }

  function shouldBlockByDirectionalScore(nextAction) {
    if (nextAction === 'BUY' && Number.isFinite(minBuyScore) && totalScore < minBuyScore) {
      return `score te laag voor BUY in ${regime} (${totalScore.toFixed(1)} < ${minBuyScore.toFixed(1)})`;
    }
    if (nextAction === 'SELL' && Number.isFinite(maxSellScore) && totalScore > maxSellScore) {
      return `score te hoog voor SELL in ${regime} (${totalScore.toFixed(1)} > ${maxSellScore.toFixed(1)})`;
    }
    return null;
  }

  if (desiredUsdShift > minOrderUsd && nextPortfolio.usd > minOrderUsd) {
    const blocked = shouldBlockByDirectionalScore('BUY') ?? shouldBlockFlip('BUY');
    if (blocked) {
      guardReason = blocked;
    } else {
      const spend = Math.min(desiredUsdShift, nextPortfolio.usd * 0.95);
      const fee = spend * TRADE_FEE;
      const buyValue = spend - fee;
      amount = buyValue / price;

      const totalXrpAfter = nextPortfolio.xrp + amount;
      // Cost basis should include buy fees; "spend" is gross cash outflow.
      const avgCostBasis =
        totalXrpAfter > 0
          ? (nextPortfolio.xrp * nextPortfolio.avgCostBasis + spend) / totalXrpAfter
          : price;

      nextPortfolio = {
        ...nextPortfolio,
        usd: nextPortfolio.usd - spend,
        xrp: totalXrpAfter,
        avgCostBasis,
      };

      action = 'BUY';
    }
  } else if (desiredUsdShift < -minOrderUsd && nextPortfolio.xrp * price > minOrderUsd) {
    const blocked = shouldBlockByDirectionalScore('SELL') ?? shouldBlockFlip('SELL');
    if (blocked) {
      guardReason = blocked;
    } else {
      const sellValue = Math.min(Math.abs(desiredUsdShift), nextPortfolio.xrp * price);
      amount = sellValue / price;
      const fee = sellValue * TRADE_FEE;
      realizedPnl = (price - nextPortfolio.avgCostBasis) * amount - fee;

      const remainingXrp = Math.max(0, nextPortfolio.xrp - amount);
      nextPortfolio = {
        ...nextPortfolio,
        usd: nextPortfolio.usd + sellValue - fee,
        xrp: remainingXrp,
        avgCostBasis: remainingXrp === 0 ? 0 : nextPortfolio.avgCostBasis,
      };

      action = 'SELL';
    }
  }

  if (
    action === 'SELL'
    && !forceExit
    && realizedPnl !== null
    && amount > 0
    && nextPortfolio.xrp > 0
  ) {
    const sellNotional = amount * price;
    const realizedLossPct = sellNotional > 0 ? Math.abs(Math.min(0, realizedPnl)) / sellNotional : 0;
    if (realizedLossPct <= maxTolerableLossSellPct) {
      guardReason = `voorkom micro-verlies verkoop (${(realizedLossPct * 100).toFixed(2)}%)`;
    }
  }

  if (guardReason) {
    nextPortfolio = basePortfolio;
    action = 'HOLD';
    amount = 0;
    realizedPnl = null;
    trade = null;
  }

  const totalValueAfter = nextPortfolio.usd + nextPortfolio.xrp * price;
  const pnl = totalValueAfter - startingCapital;
  const pnlPct = startingCapital > 0 ? (pnl / startingCapital) * 100 : 0;

  const strength = action === 'HOLD' ? 'NORMAL' : strengthFromDelta(delta);
  const reason = action === 'HOLD'
    ? guardReason
      ? `Regime ${regime}: hold (${guardReason}) (score ${totalScore.toFixed(1)})`
      : `Regime ${regime}: wait for higher-confidence setup (score ${totalScore.toFixed(1)})`
    : `Regime ${regime}: rebalance toward ${(target * 100).toFixed(0)}% ${assetLabel} (score ${totalScore.toFixed(1)})`;

  if (action !== 'HOLD') {
    trade = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      time: tradeTimeIso ?? new Date().toISOString(),
      action,
      price,
      amount,
      usdValue: amount * price,
      reason,
      totalAfter: totalValueAfter,
      realizedPnl,
    };
  }

  const indicators = {
    rsi: rsi1m,
    ema20: ema20Arr.at(-1) ?? price,
    ema50: ema50Arr.at(-1) ?? price,
    ema200: ema200Arr.at(-1) ?? price,
    dayRsi: dayRSI,
    trend4h: {
      ema50: h4EMA50,
      ema200: h4EMA200,
      macdHistogram: macd4h.histogram,
    },
    trend1d: {
      ema50: dayEMA50,
      ema200: dayEMA200,
      drawdown90dPct: dayDrawdown * 100,
    },
    bollinger,
    regime,
    targetAllocationPct: target * 100,
    currentAllocationPct: (nextPortfolio.xrp * price / Math.max(totalValueAfter, 1)) * 100,
  };

  const decision = {
    action,
    strength,
    amount,
    signals,
    totalScore,
    reason,
    regime,
  };

  const chartData = includeChartData
    ? candles1m.map((candle, index) => {
      const closesSlice = closes1m.slice(0, index + 1);
      const bb = calculateBollinger(closesSlice, 20, 2);
      return {
        time: candle.time,
        price: candle.close,
        ema20: ema20Arr[index] ?? candle.close,
        ema50: ema50Arr[index] ?? candle.close,
        ema200: ema200Arr[index] ?? candle.close,
        bbUpper: bb.upper,
        bbMiddle: bb.middle,
        bbLower: bb.lower,
      };
    })
    : [];

  return {
    price,
    portfolio: nextPortfolio,
    trade,
    decision,
    indicators,
    chartData,
    totalValue: totalValueAfter,
    pnl,
    pnlPct,
  };
}
