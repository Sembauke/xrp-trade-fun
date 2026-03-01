export function calculateEMA(prices, period) {
  if (!prices.length) return [];
  const k = 2 / (period + 1);
  const ema = [prices[0]];
  for (let i = 1; i < prices.length; i += 1) {
    ema.push(prices[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

export function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  const recent = closes.slice(-(period + 1));
  const changes = recent.slice(1).map((price, idx) => price - recent[idx]);

  let gains = 0;
  let losses = 0;
  for (const change of changes) {
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function calculateMACD(closes, fast = 12, slow = 26, signalPeriod = 9) {
  if (closes.length < slow + signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0 };
  }

  const fastArr = calculateEMA(closes, fast);
  const slowArr = calculateEMA(closes, slow);
  const macdLine = fastArr.map((value, index) => value - slowArr[index]);
  const signalLine = calculateEMA(macdLine, signalPeriod);

  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  return {
    macd,
    signal,
    histogram: macd - signal,
  };
}

export function calculateBollinger(closes, period = 20, stdDev = 2) {
  const last = closes[closes.length - 1] ?? 0;
  if (closes.length < period) {
    return { upper: last * 1.01, middle: last, lower: last * 0.99 };
  }

  const slice = closes.slice(-period);
  const mean = slice.reduce((acc, value) => acc + value, 0) / period;
  const variance = slice.reduce((acc, value) => acc + (value - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);

  return {
    upper: mean + stdDev * std,
    middle: mean,
    lower: mean - stdDev * std,
  };
}

export function computeMaxDrawdown(prices) {
  if (!prices.length) return 0;
  let peak = prices[0];
  let maxDd = 0;
  for (const price of prices) {
    peak = Math.max(peak, price);
    const dd = peak > 0 ? (peak - price) / peak : 0;
    maxDd = Math.max(maxDd, dd);
  }
  return maxDd;
}
