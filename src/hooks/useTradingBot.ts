import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { BacktestResult, BacktestSweepResult, BotState, BacktestEquityPoint } from '../types';

const POLL_MS = 30_000;
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? `${window.location.origin}/api/xrp`;
const REQUEST_TIMEOUT_MS = 5_000;
const STATE_TIMEOUT_MS = 12_000;

function buildDefaultState(symbol = 'XRPUSDT'): BotState {
  return {
    candles: [],
    currentPrice: 0,
    previousPrice: 0,
    portfolio: {
      usd: 10_000,
      xrp: 0,
      startingValue: 10_000,
      avgCostBasis: 0,
    },
    trades: [],
    decision: null,
    indicators: null,
    chartData: [],
    isLoading: true,
    isRunning: true,
    error: null,
    lastUpdate: null,
    totalValue: 10_000,
    pnl: 0,
    pnlPct: 0,
    symbol,
    strategy: {
      variant: 'balanced',
      autoOptimize: true,
      lastOptimized: null,
    },
  };
}

function computeMaxDrawdownPct(equityCurve: BacktestEquityPoint[]) {
  if (!equityCurve.length) return 0;
  let peak = equityCurve[0].equity;
  let maxDd = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    const dd = peak > 0 ? ((peak - point.equity) / peak) * 100 : 0;
    maxDd = Math.max(maxDd, dd);
  }
  return maxDd;
}

function buildClientBacktest(state: BotState): BacktestResult | null {
  if (!state.chartData.length) return null;

  const startPoint = state.chartData[0];
  const endPoint = state.chartData[state.chartData.length - 1];
  const equityCurveFromTrades = state.trades
    .slice()
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    .map((trade) => ({
      time: new Date(trade.time).getTime(),
      equity: trade.totalAfter,
    }));

  const equityCurve: BacktestEquityPoint[] = equityCurveFromTrades.length > 0
    ? equityCurveFromTrades
    : [{ time: endPoint.time, equity: state.totalValue }];

  const sells = state.trades.filter((trade) => trade.action === 'SELL');
  const wins = sells.filter((trade) => (trade.realizedPnl ?? 0) > 0).length;
  const winRatePct = sells.length > 0 ? (wins / sells.length) * 100 : 0;
  const maxDrawdownPct = computeMaxDrawdownPct(equityCurve);
  const startEquity = state.portfolio.startingValue;
  const endEquity = state.totalValue;
  const returnPct = startEquity > 0 ? ((endEquity - startEquity) / startEquity) * 100 : 0;
  const benchmarkReturnPct = startPoint.price > 0
    ? ((endPoint.price - startPoint.price) / startPoint.price) * 100
    : 0;
  const avgTradeUsd = state.trades.length > 0
    ? state.trades.reduce((sum, trade) => sum + trade.usdValue, 0) / state.trades.length
    : 0;

  return {
    symbol: state.symbol ?? 'XRPUSDT',
    executionInterval: 'live',
    days: 0,
    start: new Date(startPoint.time).toISOString(),
    end: state.lastUpdate ?? new Date(endPoint.time).toISOString(),
    tradeCount: state.trades.length,
    startEquity,
    endEquity,
    returnPct,
    maxDrawdownPct,
    winRatePct,
    avgTradeUsd,
    equityCurve,
    benchmark: {
      startPrice: startPoint.price,
      endPrice: endPoint.price,
      returnPct: benchmarkReturnPct,
    },
    cached: true,
  };
}

function buildClientSweep(state: BotState, backtest: BacktestResult | null): BacktestSweepResult | null {
  if (!backtest) return null;
  const objectiveScore = backtest.returnPct - backtest.maxDrawdownPct * 0.65 + backtest.winRatePct * 0.08;
  const variant = state.strategy?.variant ?? 'live';
  const row = {
    ...backtest,
    variant,
    objectiveScore,
    description: 'Live client-side analyse van huidige trades en equity',
  };

  return {
    symbol: backtest.symbol,
    executionInterval: backtest.executionInterval,
    days: backtest.days,
    start: backtest.start,
    end: backtest.end,
    objective: 'score = returnPct - 0.65*maxDrawdownPct + 0.08*winRatePct',
    variantsTested: 1,
    top: [row],
    all: [row],
    cached: true,
  };
}

async function request<T>(base: string, path: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Timeout na ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.error) {
        message = String(payload.error);
      }
    } catch {
      // no-op
    }
    throw new Error(message);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(`Ongeldige API-respons (${response.status} ${response.statusText}) · verwacht JSON van ${base}${path} maar kreeg: ${text.slice(0, 120)}`);
  }

  return response.json() as Promise<T>;
}

export function useTradingBot(apiBase?: string, expectedSymbol = 'XRPUSDT') {
  const [state, setState] = useState<BotState>(() => buildDefaultState(expectedSymbol));
  const refreshingRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);

  const loadState = useCallback(async () => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    try {
      const next = await request<BotState>(apiBase ?? API_BASE, '/state', undefined, STATE_TIMEOUT_MS);
      setState(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load state';
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: `${message} · controleer of de ${apiBase ?? API_BASE} API draait`,
      }));
      // Faster recovery when API briefly stalls, without waiting full poll interval.
      retryTimerRef.current = window.setTimeout(() => {
        void loadState();
      }, 5_000);
    }
  }, [apiBase]);

  const runAction = useCallback(async (path: string) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const next = await request<BotState>(apiBase ?? API_BASE, path, { method: 'POST' });
      setState(next);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Action failed',
      }));
    } finally {
      refreshingRef.current = false;
    }
  }, [apiBase]);

  useEffect(() => {
    loadState();
    const interval = setInterval(loadState, POLL_MS);
    return () => {
      clearInterval(interval);
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
    };
  }, [loadState]);

  const toggleRunning = useCallback(() => {
    runAction('/actions/toggle');
  }, [runAction]);

  const backtest = useMemo(() => buildClientBacktest(state), [state]);
  const sweep = useMemo(() => buildClientSweep(state, backtest), [state, backtest]);

  return {
    ...state,
    lastUpdate: state.lastUpdate ? new Date(state.lastUpdate) : null,
    backtest,
    backtestLoading: false,
    backtestError: null,
    sweep,
    sweepLoading: false,
    sweepError: null,
    toggleRunning,
  };
}
