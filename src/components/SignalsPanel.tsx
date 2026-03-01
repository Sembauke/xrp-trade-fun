import { Signal } from '../types';

interface SignalsPanelProps {
  signals: Signal[];
}

const signalColors: Record<string, { pos: string; neg: string }> = {
  'Macro Trend (1D)': { pos: 'bg-sky-500', neg: 'bg-orange-500' },
  'Primary Trend (4H)': { pos: 'bg-emerald-500', neg: 'bg-red-500' },
  'Execution Pullback (1M)': { pos: 'bg-violet-500', neg: 'bg-pink-500' },
  'Momentum (4H MACD)': { pos: 'bg-amber-500', neg: 'bg-rose-500' },
  'Risk Regime': { pos: 'bg-teal-500', neg: 'bg-red-700' },
};

function translateSignalName(name: string) {
  if (name.startsWith('Macro Trend')) return name.replace('Macro Trend', 'Macrotrend');
  if (name.startsWith('Primary Trend')) return name.replace('Primary Trend', 'Primaire trend');
  if (name.startsWith('Execution Pullback')) return name.replace('Execution Pullback', 'Instap-pullback');
  if (name.startsWith('Momentum')) return name.replace('Momentum', 'Momentum');
  if (name.startsWith('Risk Regime')) return name.replace('Risk Regime', 'Risicoregime');
  return name;
}

function translateDescription(description: string) {
  return description
    .replace('EMA50 vs EMA200', 'EMA50 t.o.v. EMA200')
    .replace('Histogram', 'Histogram')
    .replace('drawdown', 'drawdown')
    .replace('RSI', 'RSI');
}

function SignalBar({ signal }: { signal: Signal }) {
  const MAX = 2;
  const pct = (Math.abs(signal.value) / MAX) * 100;
  const isPositive = signal.value >= 0;
  const colors = signalColors[signal.name] ?? { pos: 'bg-blue-500', neg: 'bg-red-500' };
  const barColor = isPositive ? colors.pos : colors.neg;

  const sentiment =
    signal.value >= 1.5  ? 'Sterk positief'
    : signal.value >= 0.5  ? 'Licht positief'
    : signal.value <= -1.5 ? 'Sterk negatief'
    : signal.value <= -0.5 ? 'Licht negatief'
    : 'Neutraal';

  const sentimentColor =
    signal.value >  0.4 ? 'text-emerald-400'
    : signal.value < -0.4 ? 'text-red-400'
    : 'text-yellow-400';

  return (
    <div className="bg-surface-700/40 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-white text-sm font-semibold">{translateSignalName(signal.name)}</span>
        <span className={`text-xs font-semibold ${sentimentColor}`}>{sentiment}</span>
      </div>

      {/* Centred bar: negative grows left, positive grows right */}
      <div className="relative h-2 bg-surface-700 rounded-full overflow-hidden mb-2">
        <div className="absolute inset-0 flex">
          {/* Left half (bearish) */}
          <div className="flex-1 flex justify-end">
            {!isPositive && (
              <div
                className={`h-full rounded-l-full ${barColor} transition-all duration-700`}
                style={{ width: `${pct}%` }}
              />
            )}
          </div>
          {/* Centre divider */}
          <div className="w-px bg-surface-600" />
          {/* Right half (bullish) */}
          <div className="flex-1">
            {isPositive && (
              <div
                className={`h-full rounded-r-full ${barColor} transition-all duration-700`}
                style={{ width: `${pct}%` }}
              />
            )}
          </div>
        </div>
      </div>

      <p className="text-slate-500 text-xs leading-tight">{translateDescription(signal.description)}</p>
    </div>
  );
}

export function SignalsPanel({ signals }: SignalsPanelProps) {
  return (
    <div className="card">
      <h2 className="text-slate-400 text-xs font-semibold uppercase tracking-widest mb-4">
        Indicator-signalen
      </h2>
      <div className="grid grid-cols-2 gap-3">
        {signals.map(s => (
          <SignalBar key={s.name} signal={s} />
        ))}
      </div>
    </div>
  );
}
