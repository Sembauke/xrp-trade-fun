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
const envMinConfidenceToTrade = Number(process.env.GEMINI_MIN_CONFIDENCE_TO_TRADE ?? 65);
const envTradeCooldownMinutes = Number(process.env.GEMINI_TRADE_COOLDOWN_MINUTES ?? 20);
const envMinTradeDeltaPct = Number(process.env.GEMINI_MIN_TRADE_DELTA_PCT ?? 2.0);
const envBearMaxAllocationPct = Number(process.env.GEMINI_BEAR_MAX_ALLOCATION_PCT ?? 15);
const envTransitionMaxAllocationPct = Number(process.env.GEMINI_TRANSITION_MAX_ALLOCATION_PCT ?? 45);
const envPortfolioDrawdownGuardPct = Number(process.env.GEMINI_DRAWDOWN_GUARD_PCT ?? 2.5);
const envProfitTakeMinPct = Number(process.env.GEMINI_PROFIT_TAKE_MIN_PCT ?? 0.35);

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
    : 15,
  minTargetAllocationPct: Number.isFinite(envMinTargetPct) ? envMinTargetPct : 0,
  maxTargetAllocationPct: Number.isFinite(envMaxTargetPct) ? envMaxTargetPct : 95,
  minConfidenceToTrade: Number.isFinite(envMinConfidenceToTrade) ? envMinConfidenceToTrade : 65,
  tradeCooldownMinutes: Number.isFinite(envTradeCooldownMinutes) ? envTradeCooldownMinutes : 20,
  minTradeDeltaPct: Number.isFinite(envMinTradeDeltaPct) ? envMinTradeDeltaPct : 2.0,
  bearMaxAllocationPct: Number.isFinite(envBearMaxAllocationPct) ? envBearMaxAllocationPct : 15,
  transitionMaxAllocationPct: Number.isFinite(envTransitionMaxAllocationPct) ? envTransitionMaxAllocationPct : 45,
  portfolioDrawdownGuardPct: Number.isFinite(envPortfolioDrawdownGuardPct) ? envPortfolioDrawdownGuardPct : 2.5,
  profitTakeMinPct: Number.isFinite(envProfitTakeMinPct) ? envProfitTakeMinPct : 0.35,
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
    maxTradeAllocationStepPct: clamp(Number(merged.maxTradeAllocationStepPct), 1, 20),
    minTargetAllocationPct: minTarget,
    maxTargetAllocationPct: maxTarget,
    model: normalizeModelName(merged.model || defaultStrategyConfig.model),
    temperature: clamp(Number(merged.temperature), 0, 1),
    maxTokens: Math.max(64, Number(merged.maxTokens) || defaultStrategyConfig.maxTokens),
    timeoutMs: Math.max(3_000, Number(merged.timeoutMs) || defaultStrategyConfig.timeoutMs),
    minConfidenceToTrade: clamp(Number(merged.minConfidenceToTrade), 0, 100),
    tradeCooldownMinutes: clamp(Number(merged.tradeCooldownMinutes), 0, 240),
    minTradeDeltaPct: clamp(Number(merged.minTradeDeltaPct), 0, 30),
    bearMaxAllocationPct: clamp(Number(merged.bearMaxAllocationPct), minTarget, maxTarget),
    transitionMaxAllocationPct: clamp(Number(merged.transitionMaxAllocationPct), minTarget, maxTarget),
    portfolioDrawdownGuardPct: clamp(Number(merged.portfolioDrawdownGuardPct), 0, 50),
    profitTakeMinPct: clamp(Number(merged.profitTakeMinPct), 0, 10),
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
  const lastTradeSummary = lastTrade
    ? `${lastTrade.action} ${lastTrade.amount.toFixed(2)} @ ${lastTrade.price.toFixed(6)} on ${lastTrade.time}`
    : 'none';

  return [
    `ROLE: You are a disciplined spot portfolio allocator for ${symbol}.`,
    'OBJECTIVE: maximize risk-adjusted return while minimizing unnecessary churn and drawdowns.',
    'HORIZON: make one decision for the next cycle only; do not forecast far future.',
    '',
    'MARKET ASSUMPTIONS:',
    '- Spot only, no leverage, no shorts, no external/news data.',
    '- Use only the provided market snapshot and portfolio state.',
    '',
    'RISK POLICY (highest priority first):',
    '1) Capital preservation first: reduce exposure when trend + momentum + regime are broadly bearish.',
    '2) Avoid overtrading: if edge is weak/unclear, stay near current allocation.',
    '3) Size conviction: large allocation shifts require strong evidence and confidence.',
    '4) In conflicting signals, prefer caution over aggression.',
    '- When in net profit after fees and evidence weakens, prefer partial de-risking to lock gains.',
    '',
    'ALLOCATION DECISION RULES:',
    `- targetAllocationPct must be within [${config.minTargetAllocationPct}, ${config.maxTargetAllocationPct}].`,
    '- If confidence < 55, keep targetAllocationPct close to current allocation.',
    '- If confidence >= 75, a larger shift is allowed but still risk-aware.',
    '- In BEAR regime, require stronger evidence before raising allocation materially.',
    '- In BULL regime, do not blindly max allocation; respect momentum and volatility context.',
    '',
    'CONFIDENCE RUBRIC (0-100):',
    '- 0-40: low edge / conflicting signals',
    '- 41-69: moderate edge',
    '- 70-100: high conviction and coherent signals',
    '',
    'OUTPUT CONTRACT (strict):',
    '- Return exactly one JSON object and nothing else (no markdown, no code fences).',
    '- Keys only: targetAllocationPct, confidence, reason',
    '- reason: short, concrete, max 180 chars',
    '',
    'Output example:',
    '{"targetAllocationPct": 42.5, "confidence": 68, "reason": "4H trend improving, RSI neutral, keep moderate risk while momentum confirms."}',
    '',
    `Current price: ${price.toFixed(6)}`,
    `Current regime: ${regime}`,
    `Current XRP allocation: ${currentAllocationPct.toFixed(2)}%`,
    `Last trade: ${lastTradeSummary}`,
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
              text: 'Return one valid JSON object only. No markdown or extra text.',
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

  const guardNotes = [];
  let guardedTargetPct = normalized.targetAllocationPct;

  if (regime === 'BEAR' && guardedTargetPct > strategyConfig.bearMaxAllocationPct) {
    guardedTargetPct = strategyConfig.bearMaxAllocationPct;
    guardNotes.push(`bear cap ${strategyConfig.bearMaxAllocationPct.toFixed(1)}%`);
  }
  if (regime === 'TRANSITION' && guardedTargetPct > strategyConfig.transitionMaxAllocationPct) {
    guardedTargetPct = strategyConfig.transitionMaxAllocationPct;
    guardNotes.push(`transition cap ${strategyConfig.transitionMaxAllocationPct.toFixed(1)}%`);
  }

  const portfolioPnlPctBefore = startingCapital > 0
    ? ((totalValueBefore - startingCapital) / startingCapital) * 100
    : 0;
  if (
    portfolioPnlPctBefore <= -strategyConfig.portfolioDrawdownGuardPct
    && guardedTargetPct > currentAllocationPct
  ) {
    guardedTargetPct = currentAllocationPct;
    guardNotes.push(`drawdown guard actief (${portfolioPnlPctBefore.toFixed(2)}%)`);
  }

  const confidenceBlocked = normalized.confidence < strategyConfig.minConfidenceToTrade;
  if (confidenceBlocked) {
    guardedTargetPct = currentAllocationPct;
    guardNotes.push(
      `confidence ${normalized.confidence.toFixed(0)}% < min ${strategyConfig.minConfidenceToTrade.toFixed(0)}%`,
    );
  }

  const maxStepPct = strategyConfig.maxTradeAllocationStepPct;
  const deltaPctRaw = guardedTargetPct - currentAllocationPct;
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

  const nowMsCandidate = Date.parse(tradeTimeIso ?? '');
  const nowMs = Number.isFinite(nowMsCandidate) ? nowMsCandidate : Date.now();
  const lastTradeMsCandidate = Date.parse(lastTrade?.time ?? '');
  const lastTradeMs = Number.isFinite(lastTradeMsCandidate) ? lastTradeMsCandidate : null;
  const cooldownMs = strategyConfig.tradeCooldownMinutes * 60 * 1000;
  const cooldownBlocked = (
    cooldownMs > 0
    && Number.isFinite(lastTradeMs)
    && (nowMs - lastTradeMs) >= 0
    && (nowMs - lastTradeMs) < cooldownMs
  );
  const cooldownRemainingMin = cooldownBlocked
    ? Math.ceil((cooldownMs - (nowMs - lastTradeMs)) / 60_000)
    : 0;

  const minDeltaBlocked = Math.abs(deltaPctRaw) < strategyConfig.minTradeDeltaPct;
  const netPositionPnlPct = (
    portfolio.avgCostBasis > 0 && nextPortfolio.xrp > 0
      ? (((price * (1 - TRADE_FEE)) - portfolio.avgCostBasis) / portfolio.avgCostBasis) * 100
      : 0
  );
  const reduceExposureRequested = deltaPctRaw < 0;
  const profitTakeOverride = (
    reduceExposureRequested
    && nextPortfolio.xrp * price > minOrderUsd
    && netPositionPnlPct >= strategyConfig.profitTakeMinPct
  );
  if (profitTakeOverride) {
    guardNotes.push(`profit lock ${netPositionPnlPct.toFixed(2)}%`);
  }

  const confidenceGateBlocked = confidenceBlocked && !profitTakeOverride;
  const cooldownGateBlocked = cooldownBlocked && !profitTakeOverride;
  const minDeltaGateBlocked = minDeltaBlocked && !profitTakeOverride;

  if (confidenceGateBlocked) {
    holdReason = `confidence onder minimum (${normalized.confidence.toFixed(0)}% < ${strategyConfig.minConfidenceToTrade.toFixed(0)}%)`;
  } else if (cooldownGateBlocked) {
    holdReason = `cooldown actief (${cooldownRemainingMin}m resterend)`;
  } else if (minDeltaGateBlocked) {
    holdReason = `allocatieverschil te klein (${Math.abs(deltaPctRaw).toFixed(2)}% < ${strategyConfig.minTradeDeltaPct.toFixed(2)}%)`;
  } else if (desiredUsdShift > minOrderUsd && nextPortfolio.usd > minOrderUsd) {
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
  } else if ((desiredUsdShift < -minOrderUsd || profitTakeOverride) && nextPortfolio.xrp * price > minOrderUsd) {
    const requestedSellValue = Math.abs(desiredUsdShift);
    const minProfitTakeSellValue = profitTakeOverride ? minOrderUsd : 0;
    const sellValue = Math.min(
      Math.max(requestedSellValue, minProfitTakeSellValue),
      nextPortfolio.xrp * price,
    );
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

  const decisionReasonBase = `Gemini: ${normalized.reason} (confidence ${normalized.confidence.toFixed(0)}%, target ${normalized.targetAllocationPct.toFixed(1)}%, effectief ${effectiveTargetPct.toFixed(1)}%)`;
  const guardSummary = guardNotes.length > 0 ? ` | guards: ${guardNotes.join('; ')}` : '';
  const reason = action === 'HOLD'
    ? `${decisionReasonBase}${guardSummary}${holdReason ? ` | hold: ${holdReason}` : ''}`
    : `${decisionReasonBase}${guardSummary}`;

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
