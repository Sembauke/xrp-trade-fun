import { Activity, Pause, Play } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { nl } from 'date-fns/locale';
import { WidgetHelp } from './WidgetHelp';

interface HeaderProps {
  currentPrice: number;
  previousPrice: number;
  lastUpdate: Date | null;
  isRunning: boolean;
  onToggle: () => void;
}

export function Header({
  currentPrice, previousPrice, lastUpdate, isRunning, onToggle,
}: HeaderProps) {
  const priceUp = currentPrice >= previousPrice;
  const priceDelta = previousPrice > 0
    ? ((currentPrice - previousPrice) / previousPrice) * 100
    : 0;

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-white/5 bg-surface-800/60 backdrop-blur-sm">
      {/* Brand */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Activity size={18} className="text-white" />
          </div>
          {isRunning && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse-dot border-2 border-surface-800" />
          )}
        </div>
        <div>
          <h1 className="text-white font-bold text-lg leading-none tracking-tight">XRP Handelsbot</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {lastUpdate
              ? `Bijgewerkt ${formatDistanceToNow(lastUpdate, { addSuffix: true, locale: nl })}`
              : 'Initialiseren…'}
          </p>
        </div>
        <WidgetHelp title="Kopbalk">
          Hier zie je de live XRP/USDT-koers, de procentuele verandering sinds de vorige update en de
          huidige status van de bot. Met Pauze stopt alle automatische activiteit (traden en optimaliseren).
          Met Hervatten gaat alles weer automatisch verder.
        </WidgetHelp>
      </div>

      {/* Live Price */}
      <div className="flex flex-col items-center">
        <span className="text-slate-400 text-xs mb-0.5 uppercase tracking-widest">XRP / USDT</span>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-white font-mono">
            ${currentPrice.toFixed(4)}
          </span>
          {previousPrice > 0 && (
            <span className={`text-sm font-semibold ${priceUp ? 'text-emerald-400' : 'text-red-400'}`}>
              {priceUp ? '▲' : '▼'} {Math.abs(priceDelta).toFixed(3)}%
            </span>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={onToggle}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-all font-medium
            ${isRunning
              ? 'bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 border border-yellow-500/20'
              : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20'}`}
        >
          {isRunning ? <Pause size={14} /> : <Play size={14} />}
          <span className="hidden sm:inline">{isRunning ? 'Pauze' : 'Hervatten'}</span>
        </button>
      </div>
    </header>
  );
}
