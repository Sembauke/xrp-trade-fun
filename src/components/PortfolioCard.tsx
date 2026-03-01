import { TrendingUp, TrendingDown, DollarSign, Coins } from 'lucide-react';
import { WidgetHelp } from './WidgetHelp';

interface PortfolioCardProps {
  totalValue: number;
  usd: number;
  xrp: number;
  avgCostBasis: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  tradeCount: number;
  symbol?: string;
}

export function PortfolioCard({
  totalValue, usd, xrp, avgCostBasis, currentPrice, pnl, pnlPct, tradeCount, symbol = 'XRPUSDT',
}: PortfolioCardProps) {
  const isPositive = pnl >= 0;
  const assetLabel = symbol.replace('USDT', '');
  const xrpValue = xrp * currentPrice;
  const xrpPct = totalValue > 0 ? (xrpValue / totalValue) * 100 : 0;
  const usdPct = totalValue > 0 ? (usd / totalValue) * 100 : 100;

  // Unrealized P&L on the open asset position
  const unrealizedPnl = xrp > 0 && avgCostBasis > 0
    ? (currentPrice - avgCostBasis) * xrp
    : 0;
  const unrealizedPct = xrp > 0 && avgCostBasis > 0
    ? ((currentPrice - avgCostBasis) / avgCostBasis) * 100
    : 0;
  const posIsUp = unrealizedPnl >= 0;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-slate-400 text-xs font-semibold uppercase tracking-widest">Portfolio</h2>
        <span className="text-slate-500 text-xs">{tradeCount} transacties</span>
      </div>
      <WidgetHelp title="Portfolio">
        {`Deze kaart toont je totale waarde, gerealiseerde en ongerealiseerde winst/verlies, en de verdeling tussen cash (USD) en ${assetLabel}. De allocatiebalk laat zien welk deel van je portefeuille in ${assetLabel} zit versus cash.`}
      </WidgetHelp>

      {/* Total value + overall P&L */}
      <div className="mb-4">
        <p className="text-3xl font-bold text-white font-mono">
          ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <div className={`flex items-center gap-1.5 mt-1 ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
          {isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          <span className="text-sm font-semibold">
            {isPositive ? '+' : ''}{pnl.toFixed(2)} ({isPositive ? '+' : ''}{pnlPct.toFixed(2)}%)
          </span>
          <span className="text-slate-500 text-xs">t.o.v. startkapitaal $10k</span>
        </div>
      </div>

      {/* Allocation bar */}
      <div className="mb-4">
        <div className="flex text-xs text-slate-500 mb-1.5 justify-between">
          <span>USD {usdPct.toFixed(0)}%</span>
          <span>{assetLabel} {xrpPct.toFixed(0)}%</span>
        </div>
        <div className="h-2 bg-surface-700 rounded-full overflow-hidden flex">
          <div
            className="h-full bg-blue-500 transition-all duration-700"
            style={{ width: `${usdPct}%` }}
          />
          <div
            className="h-full bg-indigo-400 transition-all duration-700"
            style={{ width: `${xrpPct}%` }}
          />
        </div>
      </div>

      {/* Position breakdown */}
      <div className="grid grid-cols-2 gap-3">
        {/* Cash */}
        <div className="bg-surface-700/50 rounded-xl p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign size={12} className="text-blue-400" />
            <span className="text-slate-500 text-xs">Cash</span>
          </div>
          <p className="text-white font-mono font-semibold text-sm">
            ${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>

        {/* Asset position with unrealized P&L */}
        <div className={`rounded-xl p-3 transition-colors ${
          xrp > 0
            ? posIsUp ? 'bg-emerald-500/5 border border-emerald-500/10' : 'bg-red-500/5 border border-red-500/10'
            : 'bg-surface-700/50'
        }`}>
          <div className="flex items-center gap-1.5 mb-1">
            <Coins size={12} className="text-indigo-400" />
            <span className="text-slate-500 text-xs">{assetLabel}-positie</span>
          </div>
          <p className="text-white font-mono font-semibold text-sm">
            {xrp.toFixed(2)} <span className="text-slate-500 font-normal text-xs">{assetLabel}</span>
          </p>
          <p className="text-slate-400 font-mono text-xs">
            ${xrpValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>

          {xrp > 0 && avgCostBasis > 0 && (
            <div className="mt-2 pt-2 border-t border-white/5">
              <p className="text-slate-500 text-xs mb-0.5">
                Gem. kostprijs: <span className="text-slate-400 font-mono">${avgCostBasis.toFixed(4)}</span>
              </p>
              <p className={`text-xs font-semibold font-mono ${posIsUp ? 'text-emerald-400' : 'text-red-400'}`}>
                {posIsUp ? '▲' : '▼'} {posIsUp ? '+' : ''}{unrealizedPnl.toFixed(2)}
                {' '}
                <span className="font-normal">({posIsUp ? '+' : ''}{unrealizedPct.toFixed(2)}%)</span>
              </p>
              <p className="text-slate-600 text-xs">ongerealiseerd</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
