export const INTERVAL_MS = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

const BYBIT_INTERVALS = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
};

const DEFAULT_FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 8_000);
const DEFAULT_PROVIDER_CHAIN = ['bybit', 'binance_vision', 'binance'];
const PROVIDERS = {
  bybit: {
    id: 'bybit',
    label: 'Bybit',
  },
  binance_vision: {
    id: 'binance_vision',
    label: 'Binance Vision',
    baseUrl: 'https://data-api.binance.vision',
  },
  binance: {
    id: 'binance',
    label: 'Binance',
    baseUrl: 'https://api.binance.com',
  },
};

function normalizeProviderId(value) {
  const id = String(value ?? '').trim().toLowerCase();
  if (!id) return null;
  if (['bybit'].includes(id)) return 'bybit';
  if (['binance_vision', 'binance-vision', 'binancevision', 'vision'].includes(id)) return 'binance_vision';
  if (['binance', 'binance-spot', 'binance_spot'].includes(id)) return 'binance';
  return null;
}

function parseProviderChain(rawProviders) {
  const rawItems = Array.isArray(rawProviders)
    ? rawProviders
    : String(rawProviders ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  const deduped = [];
  for (const raw of rawItems) {
    const id = normalizeProviderId(raw);
    if (!id || deduped.includes(id)) continue;
    deduped.push(id);
  }

  const ids = deduped.length ? deduped : DEFAULT_PROVIDER_CHAIN;
  return ids.map((id) => PROVIDERS[id]).filter(Boolean);
}

function sanitizeCandles(candles) {
  const out = [];
  for (const candle of candles) {
    if (!candle) continue;
    const normalized = {
      time: Number(candle.time),
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume),
    };
    if (
      !Number.isFinite(normalized.time)
      || !Number.isFinite(normalized.open)
      || !Number.isFinite(normalized.high)
      || !Number.isFinite(normalized.low)
      || !Number.isFinite(normalized.close)
      || !Number.isFinite(normalized.volume)
    ) {
      continue;
    }
    out.push(normalized);
  }

  out.sort((a, b) => a.time - b.time);

  const deduped = [];
  for (const candle of out) {
    const last = deduped[deduped.length - 1];
    if (last && last.time === candle.time) {
      deduped[deduped.length - 1] = candle;
      continue;
    }
    deduped.push(candle);
  }
  return deduped;
}

async function fetchWithTimeout(url, timeoutMs, timeoutMessage) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function ensureSupportedInterval(interval) {
  if (!INTERVAL_MS[interval]) {
    throw new Error('executionInterval must be one of 1m,5m,15m,1h,4h,1d');
  }
}

function parseBinanceRows(rows) {
  return sanitizeCandles(
    Array.isArray(rows)
      ? rows.map((row) => ({
        time: Number(row?.[0]),
        open: Number(row?.[1]),
        high: Number(row?.[2]),
        low: Number(row?.[3]),
        close: Number(row?.[4]),
        volume: Number(row?.[5]),
      }))
      : [],
  );
}

function parseBybitRows(rows) {
  return sanitizeCandles(
    Array.isArray(rows)
      ? rows.map((row) => ({
        time: Number(row?.[0]),
        open: Number(row?.[1]),
        high: Number(row?.[2]),
        low: Number(row?.[3]),
        close: Number(row?.[4]),
        volume: Number(row?.[5]),
      }))
      : [],
  );
}

async function fetchLatestCandlesBinance({
  provider,
  symbol,
  interval,
  limit,
  timeoutMs,
}) {
  const url = new URL('/api/v3/klines', provider.baseUrl);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('limit', String(limit));

  const response = await fetchWithTimeout(
    url,
    timeoutMs,
    `${symbol} ${provider.label} ${interval} timeout na ${timeoutMs}ms`,
  );

  if (!response.ok) {
    throw new Error(`${symbol} ${provider.label} ${interval} HTTP ${response.status}`);
  }

  return parseBinanceRows(await response.json()).slice(-limit);
}

async function fetchCandlesRangeBinance({
  provider,
  symbol,
  interval,
  startTime,
  endTime,
  timeoutMs,
}) {
  const stepMs = INTERVAL_MS[interval];
  let cursor = startTime;
  const out = [];

  while (cursor < endTime) {
    const url = new URL('/api/v3/klines', provider.baseUrl);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', interval);
    url.searchParams.set('startTime', String(cursor));
    url.searchParams.set('endTime', String(endTime));
    url.searchParams.set('limit', '1000');

    const response = await fetchWithTimeout(
      url,
      timeoutMs,
      `${symbol} ${provider.label} ${interval} timeout na ${timeoutMs}ms`,
    );

    if (!response.ok) {
      throw new Error(`${symbol} ${provider.label} ${interval} HTTP ${response.status}`);
    }

    const candles = parseBinanceRows(await response.json());
    if (!candles.length) break;

    out.push(...candles);

    const lastTime = candles[candles.length - 1].time;
    const nextCursor = lastTime + stepMs;
    if (nextCursor <= cursor) break;
    cursor = nextCursor;

    if (candles.length < 1000) break;
  }

  return sanitizeCandles(out).filter((candle) => candle.time >= startTime && candle.time <= endTime);
}

async function fetchLatestCandlesBybit({
  symbol,
  interval,
  limit,
  timeoutMs,
}) {
  const bybitInterval = BYBIT_INTERVALS[interval];
  const url = new URL('https://api.bybit.com/v5/market/kline');
  url.searchParams.set('category', 'spot');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', bybitInterval);
  url.searchParams.set('limit', String(limit));

  const response = await fetchWithTimeout(
    url,
    timeoutMs,
    `${symbol} Bybit ${interval} timeout na ${timeoutMs}ms`,
  );

  if (!response.ok) {
    throw new Error(`${symbol} Bybit ${interval} HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (Number(payload?.retCode) !== 0) {
    throw new Error(`${symbol} Bybit ${interval} ${String(payload?.retMsg ?? `retCode ${payload?.retCode ?? 'unknown'}`)}`);
  }

  return parseBybitRows(payload?.result?.list).slice(-limit);
}

async function fetchCandlesRangeBybit({
  symbol,
  interval,
  startTime,
  endTime,
  timeoutMs,
}) {
  const stepMs = INTERVAL_MS[interval];
  const bybitInterval = BYBIT_INTERVALS[interval];
  const maxRows = 1_000;
  const spanMs = stepMs * (maxRows - 1);
  let cursor = startTime;
  const out = [];

  while (cursor < endTime) {
    const windowEnd = Math.min(endTime, cursor + spanMs);
    const url = new URL('https://api.bybit.com/v5/market/kline');
    url.searchParams.set('category', 'spot');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', bybitInterval);
    url.searchParams.set('start', String(cursor));
    url.searchParams.set('end', String(windowEnd));
    url.searchParams.set('limit', String(maxRows));

    const response = await fetchWithTimeout(
      url,
      timeoutMs,
      `${symbol} Bybit ${interval} timeout na ${timeoutMs}ms`,
    );

    if (!response.ok) {
      throw new Error(`${symbol} Bybit ${interval} HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (Number(payload?.retCode) !== 0) {
      throw new Error(`${symbol} Bybit ${interval} ${String(payload?.retMsg ?? `retCode ${payload?.retCode ?? 'unknown'}`)}`);
    }

    const candles = parseBybitRows(payload?.result?.list);
    if (!candles.length) {
      cursor = windowEnd + stepMs;
      continue;
    }

    out.push(...candles.filter((candle) => candle.time >= cursor && candle.time <= windowEnd));

    const lastTime = candles[candles.length - 1].time;
    const nextCursor = Math.max(cursor + stepMs, lastTime + stepMs);
    if (nextCursor <= cursor) break;
    cursor = nextCursor;
  }

  return sanitizeCandles(out).filter((candle) => candle.time >= startTime && candle.time <= endTime);
}

async function withProviderFallback(providers, operationLabel, runForProvider) {
  const errors = [];
  for (const provider of providers) {
    try {
      const candles = await runForProvider(provider);
      if (!Array.isArray(candles) || candles.length === 0) {
        throw new Error(`${provider.label} returned no candles`);
      }
      return candles;
    } catch (error) {
      errors.push(`${provider.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`${operationLabel} failed (${errors.join(' | ')})`);
}

export function createMarketDataClient({
  symbol,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  providers = process.env.MARKET_DATA_PROVIDERS,
} = {}) {
  if (!symbol) {
    throw new Error('symbol is required for market data client');
  }

  const providerChain = parseProviderChain(providers);
  const normalizedTimeoutMs = Math.max(1_000, Number(timeoutMs) || DEFAULT_FETCH_TIMEOUT_MS);

  return {
    providers: providerChain.map((provider) => provider.id),
    async fetchLatestCandles(interval, limit = 220) {
      ensureSupportedInterval(interval);
      const normalizedLimit = Math.max(1, Math.min(1_000, Number(limit) || 220));
      return withProviderFallback(
        providerChain,
        `${symbol} ${interval} latest candles`,
        async (provider) => {
          if (provider.id === 'bybit') {
            return fetchLatestCandlesBybit({
              symbol,
              interval,
              limit: normalizedLimit,
              timeoutMs: normalizedTimeoutMs,
            });
          }

          return fetchLatestCandlesBinance({
            provider,
            symbol,
            interval,
            limit: normalizedLimit,
            timeoutMs: normalizedTimeoutMs,
          });
        },
      );
    },
    async fetchCandlesRange({ interval, startTime, endTime }) {
      ensureSupportedInterval(interval);
      const fromMs = Number(startTime);
      const toMs = Number(endTime);
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
        throw new Error(`Invalid candle range for ${symbol} ${interval}`);
      }

      return withProviderFallback(
        providerChain,
        `${symbol} ${interval} candle range`,
        async (provider) => {
          if (provider.id === 'bybit') {
            return fetchCandlesRangeBybit({
              symbol,
              interval,
              startTime: fromMs,
              endTime: toMs,
              timeoutMs: normalizedTimeoutMs,
            });
          }

          return fetchCandlesRangeBinance({
            provider,
            symbol,
            interval,
            startTime: fromMs,
            endTime: toMs,
            timeoutMs: normalizedTimeoutMs,
          });
        },
      );
    },
  };
}
