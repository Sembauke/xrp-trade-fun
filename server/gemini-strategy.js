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

export const DEFAULT_STRATEGY_VARIANT = 'gemini-10m';

const envDecisionIntervalMinutes = Number(process.env.GEMINI_DECISION_INTERVAL_MINUTES ?? process.env.CLAUDE_DECISION_INTERVAL_MINUTES ?? 10);
const envMinOrderUsd = Number(process.env.GEMINI_MIN_ORDER_USD ?? process.env.CLAUDE_MIN_ORDER_USD ?? 15);
const envMaxTradeStepPct = Number(process.env.GEMINI_MAX_TRADE_STEP_PCT ?? process.env.CLAUDE_MAX_TRADE_STEP_PCT ?? 35);
const envMinTargetPct = Number(process.env.GEMINI_MIN_TARGET_PCT ?? process.env.CLAUDE_MIN_TARGET_PCT ?? 0);
const envMaxTargetPct = Number(process.env.GEMINI_MAX_TARGET_PCT ?? process.env.CLAUDE_MAX_TARGET_PCT ?? 95);

export const defaultStrategyConfig = {
  provider: 'gemini',
  decisionIntervalMinutes: Number.isFinite(envDecisionIntervalMinutes) && envDecisionIntervalMinutes > 0
    ? envDecisionIntervalMinutes
    : 10,
  model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  temperature: 0.1,
  maxTokens: 350,
  timeoutMs: 20_000,
  minOrderUsd: Number.isFinite(envMinOrderUsd) && envMinOrderUsd > 0 ? envMinOrderUsd : 15,
  maxTradeAllocationStepPct: Number.isFinite(envMaxTradeStepPct) && envMaxTradeStepPct > 0
    ? envMaxTradeStepPct
    : 35,
  minTargetAllocationPct: Number.isFinite(envMinTargetPct) ? envMinTargetPct : 0,
  maxTargetAllocationPct: Number.isFinite(envMaxTargetPct) ? envMaxTargetPct : 95,
};

export function createDefaultPortfolio(startingCapital = STARTING_CAPITAL) {
  return {
    usd: startingCapital,
    xrp: 0,
    startingValue: startingCapital,
    avgCostBasis: 0,
  };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function getRegime(dayEMA50, dayEMA200, h4EMA50, h4EMA200) {
  const macroBull = dayEMA50 > dayEMA200;
  const trendBull = h4EMA50 > h4EMA200;
  const macroBear = dayEMA50 < dayEMA200;
  const trendBear = h4EMA50 < h4EMA200;

  if (macroBull && trendBull) return 'BULL';
  if (macroBear && trendBear) return 'BEAR';
  return 'TRANSITION';
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

function percentChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonObject(rawText) {
  const text = String(rawText ?? '').trim();
  if (!text) {
    throw new Error('Gemini gaf geen tekst terug');
  }

  const fenced = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;

  const direct = parseJson(candidate);
  if (direct && typeof direct === 'object') return direct;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const sliced = candidate.slice(start, end + 1);
    const parsed = parseJson(sliced);
    if (parsed && typeof parsed === 'object') return parsed;
  }

  throw new Error(`Kon Gemini JSON niet parsen: ${candidate.slice(0, 200)}`);
}

function pullTextFromGeminiResponse(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const first = candidates[0];
  const parts = Array.isArray(first?.content?.parts) ? first.content.parts : [];
  const text = parts
    .map((part) => String(part?.text ?? ''))
    .join('\n')
    .trim();

  if (!text) {
    throw new Error('Gemini response bevat geen tekstcontent');
  }

  return text;
}

function strengthFromConfidence(confidence) {
  if (confidence >= 75) return 'STRONG';
  if (confidence <= 40) return 'WEAK';
  return 'NORMAL';
}

function normalizeModelName(model) {
  return String(model ?? '')
    .trim()
    .replace(/^models\//i, '');
}

function normalizeConfig(overrides = {}) {
  const merged = {
    ...defaultStrategyConfig,
    ...overrides,
  };

  const minTarget = clamp(Number(merged.minTargetAllocationPct), 0, 95);
  const maxTarget = clamp(Number(merged.maxTargetAllocationPct), minTarget, 95);

  return {
    ...merged,
    decisionIntervalMinutes: Math.max(1, Number(merged.decisionIntervalMinutes) || defaultStrategyConfig.decisionIntervalMinutes),
    minOrderUsd: Math.max(1, Number(merged.minOrderUsd) || defaultStrategyConfig.minOrderUsd),
    maxTradeAllocationStepPct: clamp(Number(merged.maxTradeAllocationStepPct), 1, 100),
    minTargetAllocationPct: minTarget,
    maxTargetAllocationPct: maxTarget,
    model: normalizeModelName(merged.model || defaultStrategyConfig.model),
    temperature: clamp(Number(merged.temperature), 0, 1),
    maxTokens: Math.max(64, Number(merged.maxTokens) || defaultStrategyConfig.maxTokens),
    timeoutMs: Math.max(3_000, Number(merged.timeoutMs) || defaultStrategyConfig.timeoutMs),
  };
}

function buildPrompt({
  symbol,
  price,
  regime,
  currentAllocationPct,
  summary,
  lastTrade,
  config,
}) {
  return [
    `You are deciding one spot trade for ${symbol}.`,
    'Return strict JSON only with keys: targetAllocationPct, confidence, reason.',
    `targetAllocationPct must be between ${config.minTargetAllocationPct} and ${config.maxTargetAllocationPct}.`,
    'confidence must be 0-100.',
    'reason must be short plain text (max 180 chars).',
    '',
    `Current price: ${price.toFixed(6)}`,
    `Current regime: ${regime}`,
    `Current XRP allocation: ${currentAllocationPct.toFixed(2)}%`,
    `Last trade: ${lastTrade ? `${lastTrade.action} ${lastTrade.amount.toFixed(2)} @ ${lastTrade.price.toFixed(6)} on ${lastTrade.time}` : 'none'}`,
    '',
    'Market snapshot JSON:',
    JSON.stringify(summary, null, 2),
  ].join('\n');
}

async function requestGeminiDecision({ apiKey, prompt, config }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const baseBody = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
    };

    async function callGemini({ withSystemInstruction, withJsonMode }) {
      const generationConfig = {
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
      };
      if (withJsonMode) {
        generationConfig.responseMimeType = 'application/json';
      }

      const body = {
        ...baseBody,
        generationConfig,
      };
      if (withSystemInstruction) {
        body.systemInstruction = {
          parts: [
            {
              text: 'You are a disciplined spot-trading assistant. Respond with JSON only.',
            },
          ],
        };
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify(body),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errMsg = String(payload?.error?.message || `${response.status} ${response.statusText}`);
        throw new Error(`Gemini API fout: ${errMsg}`);
      }

      return payload;
    }

    const attempts = [
      { withSystemInstruction: true, withJsonMode: true },
      { withSystemInstruction: false, withJsonMode: true },
      { withSystemInstruction: true, withJsonMode: false },
      { withSystemInstruction: false, withJsonMode: false },
    ];

    let payload = null;
    let lastError = null;
    for (const attempt of attempts) {
      try {
        payload = await callGemini(attempt);
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!payload) {
      throw lastError || new Error('Gemini API fout: onbekende fout');
    }

    const text = pullTextFromGeminiResponse(payload);
    return extractJsonObject(text);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Gemini timeout na ${config.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeModelOutput(raw, { config, currentAllocationPct }) {
  const fallbackTarget = clamp(currentAllocationPct, config.minTargetAllocationPct, config.maxTargetAllocationPct);
  const targetAllocationPct = clamp(
    Number(raw?.targetAllocationPct),
    config.minTargetAllocationPct,
    config.maxTargetAllocationPct,
  );
  const confidence = clamp(Number(raw?.confidence), 0, 100);
  const reasonRaw = String(raw?.reason ?? '').trim();

  return {
    targetAllocationPct: Number.isFinite(targetAllocationPct) ? targetAllocationPct : fallbackTarget,
    confidence: Number.isFinite(confidence) ? confidence : 50,
    reason: reasonRaw ? reasonRaw.slice(0, 180) : 'Gemini gaf geen reden mee.',
  };
}

function sanitizeModelError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').trim().slice(0, 160);
}

function buildChartData(candles1m, closes1m, ema20Arr, ema50Arr, ema200Arr) {
  return candles1m.map((candle, index) => {
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
  });
}

export async function runGeminiStrategy({
  candles1m,
  candles4h,
  candles1d,
  portfolio,
  tradeTimeIso,
  lastTrade = null,
  strategyConfig: strategyConfigInput,
  symbol = 'XRPUSDT',
  startingCapital = portfolio?.startingValue ?? STARTING_CAPITAL,
}) {
  const strategyConfig = normalizeConfig(strategyConfigInput);

  const closes1m = candles1m.map((c) => c.close);
  const closes4h = candles4h.map((c) => c.close);
  const closes1d = candles1d.map((c) => c.close);

  if (closes1m.length < 210 || closes4h.length < 210 || closes1d.length < 210) {
    throw new Error('Niet genoeg candles voor Gemini-beslissing');
  }

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
  const atrPct = atr4h && price > 0 ? (atr4h / price) * 100 : 0;

  const regime = getRegime(dayEMA50, dayEMA200, h4EMA50, h4EMA200);

  const totalValueBefore = portfolio.usd + portfolio.xrp * price;
  const currentAllocationPct = totalValueBefore > 0
    ? (portfolio.xrp * price / totalValueBefore) * 100
    : 0;

  const summary = {
    timeframe: {
      decisionIntervalMinutes: strategyConfig.decisionIntervalMinutes,
      symbol,
    },
    price: {
      current: price,
      change10mPct: percentChange(price, closes1m[closes1m.length - 11]),
      change1hPct: percentChange(price, closes1m[closes1m.length - 61]),
      change4hPct: percentChange(price, closes4h[closes4h.length - 2]),
      change24hPct: percentChange(price, closes1d[closes1d.length - 2]),
    },
    indicators: {
      regime,
      rsi1m,
      dayRsi: dayRSI,
      ema1m: {
        ema20: ema20Arr.at(-1) ?? price,
        ema50: ema50Arr.at(-1) ?? price,
        ema200: ema200Arr.at(-1) ?? price,
      },
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
      atr4hPct: atrPct,
    },
    portfolio: {
      usd: portfolio.usd,
      xrp: portfolio.xrp,
      totalValueUsd: totalValueBefore,
      currentAllocationPct,
      avgCostBasis: portfolio.avgCostBasis,
    },
  };

  const prompt = buildPrompt({
    symbol,
    price,
    regime,
    currentAllocationPct,
    summary,
    lastTrade,
    config: strategyConfig,
  });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY ontbreekt');
  }

  let normalized;
  try {
    const rawDecision = await requestGeminiDecision({
      apiKey,
      prompt,
      config: strategyConfig,
    });
    normalized = normalizeModelOutput(rawDecision, {
      config: strategyConfig,
      currentAllocationPct,
    });
  } catch (error) {
    // Keep the bot loop alive when the external LLM is temporarily unavailable.
    normalized = {
      targetAllocationPct: currentAllocationPct,
      confidence: 50,
      reason: `Gemini tijdelijk onbeschikbaar: ${sanitizeModelError(error)}`,
    };
  }

  const maxStepPct = strategyConfig.maxTradeAllocationStepPct;
  const deltaPctRaw = normalized.targetAllocationPct - currentAllocationPct;
  const deltaPctLimited = clamp(deltaPctRaw, -maxStepPct, maxStepPct);
  const effectiveTargetPct = clamp(
    currentAllocationPct + deltaPctLimited,
    strategyConfig.minTargetAllocationPct,
    strategyConfig.maxTargetAllocationPct,
  );

  const desiredUsdShift = (deltaPctLimited / 100) * totalValueBefore;

  const nextPortfolio = { ...portfolio };
  const minOrderUsd = strategyConfig.minOrderUsd;

  let action = 'HOLD';
  let amount = 0;
  let realizedPnl = null;
  let holdReason = '';

  if (desiredUsdShift > minOrderUsd && nextPortfolio.usd > minOrderUsd) {
    const spend = Math.min(desiredUsdShift, nextPortfolio.usd * 0.95);
    const fee = spend * TRADE_FEE;
    const buyValue = spend - fee;
    amount = buyValue / Math.max(price, 1e-9);

    const totalXrpAfter = nextPortfolio.xrp + amount;
    const avgCostBasis =
      totalXrpAfter > 0
        ? (nextPortfolio.xrp * nextPortfolio.avgCostBasis + spend) / totalXrpAfter
        : price;

    nextPortfolio.usd -= spend;
    nextPortfolio.xrp = totalXrpAfter;
    nextPortfolio.avgCostBasis = avgCostBasis;

    action = 'BUY';
  } else if (desiredUsdShift < -minOrderUsd && nextPortfolio.xrp * price > minOrderUsd) {
    const sellValue = Math.min(Math.abs(desiredUsdShift), nextPortfolio.xrp * price);
    amount = sellValue / Math.max(price, 1e-9);
    const fee = sellValue * TRADE_FEE;
    realizedPnl = (price - nextPortfolio.avgCostBasis) * amount - fee;

    const remainingXrp = Math.max(0, nextPortfolio.xrp - amount);
    nextPortfolio.usd += sellValue - fee;
    nextPortfolio.xrp = remainingXrp;
    nextPortfolio.avgCostBasis = remainingXrp === 0 ? 0 : nextPortfolio.avgCostBasis;

    action = 'SELL';
  } else {
    if (Math.abs(deltaPctRaw) < 0.05) {
      holdReason = 'target vrijwel gelijk aan huidige allocatie';
    } else if (Math.abs((deltaPctLimited / 100) * totalValueBefore) < minOrderUsd) {
      holdReason = `order kleiner dan minimum ($${minOrderUsd.toFixed(2)})`;
    } else {
      holdReason = 'onvoldoende balans voor uitvoering';
    }
  }

  const totalValueAfter = nextPortfolio.usd + nextPortfolio.xrp * price;
  const pnl = totalValueAfter - startingCapital;
  const pnlPct = startingCapital > 0 ? (pnl / startingCapital) * 100 : 0;

  const decisionReasonBase = `Gemini: ${normalized.reason} (confidence ${normalized.confidence.toFixed(0)}%, target ${normalized.targetAllocationPct.toFixed(1)}%)`;
  const reason = action === 'HOLD'
    ? `${decisionReasonBase}${holdReason ? ` | hold: ${holdReason}` : ''}`
    : decisionReasonBase;

  let trade = null;
  if (action !== 'HOLD' && amount > 0) {
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

  const momentum1hPct = percentChange(price, closes1m[closes1m.length - 61]);
  const confidenceScore = (normalized.confidence - 50) / 25;

  const signals = [
    {
      name: 'Gemini Confidence',
      value: Number(confidenceScore.toFixed(2)),
      description: `${normalized.confidence.toFixed(0)}%`,
    },
    {
      name: '4H Trend',
      value: h4EMA50 >= h4EMA200 ? 1 : -1,
      description: `EMA50 ${h4EMA50.toFixed(4)} vs EMA200 ${h4EMA200.toFixed(4)}`,
    },
    {
      name: '1D Trend',
      value: dayEMA50 >= dayEMA200 ? 1 : -1,
      description: `EMA50 ${dayEMA50.toFixed(4)} vs EMA200 ${dayEMA200.toFixed(4)}`,
    },
    {
      name: '1H Momentum',
      value: momentum1hPct > 0.25 ? 1 : momentum1hPct < -0.25 ? -1 : 0,
      description: `${momentum1hPct >= 0 ? '+' : ''}${momentum1hPct.toFixed(2)}%`,
    },
  ];

  const actionSign = action === 'BUY' ? 1 : action === 'SELL' ? -1 : 0;
  const totalScore = Number((confidenceScore * 3 * actionSign).toFixed(2));

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
    targetAllocationPct: effectiveTargetPct,
    currentAllocationPct: (nextPortfolio.xrp * price / Math.max(totalValueAfter, 1)) * 100,
  };

  const decision = {
    action,
    strength: strengthFromConfidence(normalized.confidence),
    amount,
    signals,
    totalScore,
    reason,
    regime,
  };

  const chartData = buildChartData(candles1m, closes1m, ema20Arr, ema50Arr, ema200Arr);

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
