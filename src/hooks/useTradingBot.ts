import { useState, useEffect, useCallback, useRef } from 'react';
import { BacktestResult, BacktestSweepResult, BotState } from '../types';

const POLL_MS = 30_000;
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? `${window.location.origin}/api/xrp`;
const REQUEST_TIMEOUT_MS = 5_000;

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

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Timeout na ${REQUEST_TIMEOUT_MS}ms`);
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
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [sweep, setSweep] = useState<BacktestSweepResult | null>(null);
  const [sweepLoading, setSweepLoading] = useState(false);
  const [sweepError, setSweepError] = useState<string | null>(null);
  const refreshingRef = useRef(false);

  const loadState = useCallback(async () => {
    try {
      const next = await request<BotState>(apiBase ?? API_BASE, '/state');
      setState(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load state';
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: `${message} · controleer of de ${apiBase ?? API_BASE} API draait`,
      }));
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
    return () => clearInterval(interval);
  }, [loadState]);

  const toggleRunning = useCallback(() => {
    runAction('/actions/toggle');
  }, [runAction]);

  const runBacktest = useCallback(async (days = 365, executionInterval = '1h') => {
    setBacktestLoading(true);
    setBacktestError(null);
    try {
      const params = new URLSearchParams({
        days: String(days),
        executionInterval,
      });
      const result = await request<BacktestResult>(apiBase ?? API_BASE, `/backtest?${params.toString()}`);
      setBacktest(result);
    } catch (error) {
      setBacktestError(error instanceof Error ? error.message : 'Backtest failed');
    } finally {
      setBacktestLoading(false);
    }
  }, [apiBase]);

  const runSweep = useCallback(async (days = 365, executionInterval = '1h', top = 5) => {
    setSweepLoading(true);
    setSweepError(null);
    try {
      const params = new URLSearchParams({
        days: String(days),
        executionInterval,
        top: String(top),
      });
      const result = await request<BacktestSweepResult>(apiBase ?? API_BASE, `/backtest/sweep?${params.toString()}`);
      setSweep(result);
    } catch (error) {
      setSweepError(error instanceof Error ? error.message : 'Sweep failed');
    } finally {
      setSweepLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    if (!state.isRunning) return;
    runBacktest(365, '1h');
    runSweep(365, '1h', 5);
    const interval = setInterval(() => {
      runBacktest(365, '1h');
      runSweep(365, '1h', 5);
    }, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [state.isRunning, runBacktest, runSweep]);

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
    runBacktest,
    runSweep,
  };
}
