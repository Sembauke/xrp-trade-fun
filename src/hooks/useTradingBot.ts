import { useState, useEffect, useCallback, useRef } from 'react';
import { BacktestResult, BacktestSweepResult, BotState } from '../types';

const POLL_MS = 30_000;
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? `${window.location.origin}/api`;
const REQUEST_TIMEOUT_MS = 5_000;
const STATE_TIMEOUT_MS = 20_000;
const BACKTEST_DISABLED_MESSAGE = 'Backtest is uitgeschakeld: Gemini beslist live op ingestelde interval.';

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
      variant: 'gemini-10m',
      autoOptimize: false,
      lastOptimized: null,
    },
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
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(BACKTEST_DISABLED_MESSAGE);
  const [sweep, setSweep] = useState<BacktestSweepResult | null>(null);
  const [sweepLoading, setSweepLoading] = useState(false);
  const [sweepError, setSweepError] = useState<string | null>(BACKTEST_DISABLED_MESSAGE);
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

  const runSweep = useCallback(() => {
    setBacktest(null);
    setSweep(null);
    setBacktestLoading(false);
    setSweepLoading(false);
    setBacktestError(BACKTEST_DISABLED_MESSAGE);
    setSweepError(BACKTEST_DISABLED_MESSAGE);
  }, []);

  return {
    ...state,
    lastUpdate: state.lastUpdate ? new Date(state.lastUpdate) : null,
    backtest,
    backtestLoading,
    backtestError,
    sweep,
    sweepLoading,
    sweepError,
    toggleRunning,
    runSweep,
  };
}
