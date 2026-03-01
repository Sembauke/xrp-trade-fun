import { useState, useEffect, useCallback, useRef } from 'react';
import { BacktestResult, BacktestSweepResult, BotState } from '../types';

const POLL_MS = 30_000;
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? `${window.location.origin}/api`;
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
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [sweep, setSweep] = useState<BacktestSweepResult | null>(null);
  const [sweepLoading, setSweepLoading] = useState(false);
  const [sweepError, setSweepError] = useState<string | null>(null);
  const refreshingRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsReconnectRef = useRef<number | null>(null);
  const wsConnectedRef = useRef(false);
  const strategyVariantRef = useRef('balanced');

  const wsUrl = (() => {
    const httpUrl = new URL(apiBase ?? API_BASE, window.location.origin);
    const wsProtocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${httpUrl.host}/ws`;
  })();

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

  const runSweep = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setSweepError('Socket niet verbonden');
      return;
    }
    setSweepLoading(true);
    setBacktestLoading(true);
    wsRef.current.send(JSON.stringify({
      type: 'sweep:run',
      requestId: `sw-${Date.now()}`,
      params: { days: 180, executionInterval: '1h', top: 5 },
    }));
  }, []);

  useEffect(() => {
    strategyVariantRef.current = state.strategy.variant;
  }, [state.strategy.variant]);

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        wsConnectedRef.current = true;
        setBacktestError(null);
        setSweepError(null);
        runSweep();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === 'sweep:result') {
            const payload = message.payload as BacktestSweepResult;
            setSweep(payload);
            const selected =
              payload.all.find((row) => row.variant === strategyVariantRef.current)
              ?? payload.top[0]
              ?? null;
            setBacktest(selected as BacktestResult | null);
            setSweepLoading(false);
            setBacktestLoading(false);
            setSweepError(null);
            setBacktestError(null);
            return;
          }
          if (message.type === 'error') {
            setBacktestLoading(false);
            setSweepLoading(false);
            const msg = String(message.error ?? 'Socket error');
            setBacktestError(msg);
            setSweepError(msg);
          }
        } catch {
          // ignore malformed socket messages
        }
      };

      ws.onclose = () => {
        wsConnectedRef.current = false;
        wsRef.current = null;
        if (wsReconnectRef.current !== null) {
          window.clearTimeout(wsReconnectRef.current);
        }
        wsReconnectRef.current = window.setTimeout(connect, 3_000);
      };
    };

    connect();
    return () => {
      if (wsReconnectRef.current !== null) {
        window.clearTimeout(wsReconnectRef.current);
      }
      wsConnectedRef.current = false;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [runSweep, wsUrl]);

  useEffect(() => {
    if (!state.isRunning) return;
    const interval = window.setInterval(() => {
      if (!wsConnectedRef.current) return;
      runSweep();
    }, 30 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [state.isRunning, runSweep]);

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
