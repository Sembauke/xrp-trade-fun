export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Portfolio {
  usd: number;
  xrp: number;
  startingValue: number;
  avgCostBasis: number; // weighted-average price paid per XRP
}

export interface Trade {
  id: string;
  time: string | Date;
  action: 'BUY' | 'SELL';
  price: number;
  amount: number;
  usdValue: number;
  reason: string;
  totalAfter: number;
  realizedPnl?: number | null;
}

export interface Signal {
  name: string;
  value: number;
  description: string;
}

export interface Indicators {
  rsi: number;
  ema20: number;
  ema50: number;
  ema200: number;
  dayRsi: number;
  trend4h: {
    ema50: number;
    ema200: number;
    macdHistogram: number;
  };
  trend1d: {
    ema50: number;
    ema200: number;
    drawdown90dPct: number;
  };
  bollinger: {
    upper: number;
    middle: number;
    lower: number;
  };
  regime: 'BULL' | 'BEAR' | 'TRANSITION';
  targetAllocationPct: number;
  currentAllocationPct: number;
}

export interface Decision {
  action: 'BUY' | 'SELL' | 'HOLD';
  strength: 'STRONG' | 'NORMAL' | 'WEAK';
  amount: number;
  signals: Signal[];
  totalScore: number;
  reason: string;
  regime: 'BULL' | 'BEAR' | 'TRANSITION';
}

export interface ChartPoint {
  time: number;
  price: number;
  ema20: number;
  ema50: number;
  ema200: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
}

export interface BotState {
  candles: Candle[];
  currentPrice: number;
  previousPrice: number;
  portfolio: Portfolio;
  trades: Trade[];
  decision: Decision | null;
  indicators: Indicators | null;
  chartData: ChartPoint[];
  isLoading: boolean;
  isRunning: boolean;
  error: string | null;
  lastUpdate: string | null;
  totalValue: number;
  pnl: number;
  pnlPct: number;
  symbol?: string;
  strategy: {
    variant: string;
    autoOptimize: boolean;
    lastOptimized: string | null;
  };
}

export interface BacktestEquityPoint {
  time: number;
  equity: number;
}

export interface BacktestResult {
  symbol: string;
  executionInterval: string;
  days: number;
  start: string;
  end: string;
  tradeCount: number;
  startEquity: number;
  endEquity: number;
  returnPct: number;
  maxDrawdownPct: number;
  winRatePct: number;
  avgTradeUsd: number;
  equityCurve: BacktestEquityPoint[];
  benchmark: {
    startPrice: number;
    endPrice: number;
    returnPct: number;
  };
  cached: boolean;
}

export interface SweepVariantResult extends Omit<BacktestResult, 'variant'> {
  variant: string;
  objectiveScore: number;
  description: string;
}

export interface BacktestSweepResult {
  symbol: string;
  executionInterval: string;
  days: number;
  start: string;
  end: string;
  objective: string;
  variantsTested: number;
  top: SweepVariantResult[];
  all: SweepVariantResult[];
  cached: boolean;
}
