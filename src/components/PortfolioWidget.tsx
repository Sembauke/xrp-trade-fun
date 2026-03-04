import { Wallet, Coins, Landmark } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ActivePosition } from '../types';

interface PortfolioWidgetProps {
  usd: number;
  xrp: number;
  currentPrice: number;
  avgCostBasis: number;
  totalValue: number;
  activePositions: ActivePosition[];
  symbol?: string;
}

export function PortfolioWidget({
  usd,
  xrp,
  currentPrice,
  avgCostBasis,
  totalValue,
  activePositions,
  symbol = 'XRPUSDT',
}: PortfolioWidgetProps) {
  const assetLabel = symbol.replace('USDT', '');
  const assetValue = xrp * currentPrice;
  const usdPct = totalValue > 0 ? (usd / totalValue) * 100 : 0;
  const xrpPct = totalValue > 0 ? (assetValue / totalValue) * 100 : 0;
  const positionPnl = xrp > 0 && avgCostBasis > 0
    ? (currentPrice - avgCostBasis) * xrp
    : 0;
  const positionPnlPct = xrp > 0 && avgCostBasis > 0
    ? ((currentPrice - avgCostBasis) / avgCostBasis) * 100
    : 0;
  const openPositionPnl = activePositions.reduce((sum, position) => sum + position.unrealizedPnl, 0);

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <Wallet size={14} className="text-slate-400" />
        <h2 className="text-slate-400 text-xs font-semibold uppercase tracking-widest">Portefeuille-overzicht</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="bg-surface-700/40 rounded-xl p-3">
          <p className="text-slate-500 text-xs mb-1">Totale waarde</p>
          <p className="text-white font-mono font-semibold text-lg">${totalValue.toFixed(2)}</p>
        </div>
        <div className="bg-surface-700/40 rounded-xl p-3">
          <p className="text-slate-500 text-xs mb-1 inline-flex items-center gap-1.5"><Landmark size={12} /> Cash (USD)</p>
          <p className="text-white font-mono font-semibold">${usd.toFixed(2)}</p>
          <p className="text-slate-500 text-xs">{usdPct.toFixed(1)}%</p>
        </div>
        <div className="bg-surface-700/40 rounded-xl p-3">
          <p className="text-slate-500 text-xs mb-1 inline-flex items-center gap-1.5"><Coins size={12} /> {assetLabel}-positie</p>
          <p className="text-white font-mono font-semibold">${assetValue.toFixed(2)}</p>
          <p className="text-slate-500 text-xs">{xrp.toFixed(2)} {assetLabel} ({xrpPct.toFixed(1)}%)</p>
        </div>
        <div className="bg-surface-700/40 rounded-xl p-3">
          <p className="text-slate-500 text-xs mb-1">Ongerealiseerde W/V</p>
          <p className={`font-mono font-semibold ${positionPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {positionPnl >= 0 ? '+' : ''}{positionPnl.toFixed(2)}
          </p>
          <p className="text-slate-500 text-xs">
            {positionPnl >= 0 ? '+' : ''}{positionPnlPct.toFixed(2)}% · gem. ${avgCostBasis.toFixed(4)}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex justify-between text-xs text-slate-500 mb-1.5">
          <span>Allocatie USD {usdPct.toFixed(1)}%</span>
          <span>Allocatie {assetLabel} {xrpPct.toFixed(1)}%</span>
        </div>
        <div className="h-2 bg-surface-700 rounded-full overflow-hidden flex">
          <div className="h-full bg-sky-500 transition-all duration-700" style={{ width: `${usdPct}%` }} />
          <div className="h-full bg-indigo-400 transition-all duration-700" style={{ width: `${xrpPct}%` }} />
        </div>
      </div>

      <div className="mt-5 border-t border-white/5 pt-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-widest">
            Actieve posities ({activePositions.length})
          </h3>
          <span className={`text-xs font-mono ${openPositionPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            Totaal open {openPositionPnl >= 0 ? '+' : ''}{openPositionPnl.toFixed(2)}
          </span>
        </div>

        {activePositions.length === 0 ? (
          <p className="text-slate-600 text-sm py-2">Geen actieve posities.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-white/5">
                  <th className="text-left pb-2 font-medium">Open sinds</th>
                  <th className="text-right pb-2 font-medium">Hoeveelheid</th>
                  <th className="text-right pb-2 font-medium">Entry</th>
                  <th className="text-right pb-2 font-medium">Waarde</th>
                  <th className="text-right pb-2 font-medium">Open W/V</th>
                </tr>
              </thead>
              <tbody>
                {activePositions.map((position) => {
                  const time = typeof position.time === 'string' ? parseISO(position.time) : position.time;
                  const timeLabel = Number.isFinite(time.getTime()) ? format(time, 'dd-MM HH:mm') : '-';
                  return (
                    <tr key={position.id} className="border-b border-white/5 last:border-b-0">
                      <td className="py-2 text-slate-300">{timeLabel}</td>
                      <td className="py-2 text-right font-mono text-slate-200">
                        {position.amount.toFixed(2)} {symbol.replace('USDT', '')}
                      </td>
                      <td className="py-2 text-right font-mono text-slate-200">${position.entryPrice.toFixed(4)}</td>
                      <td className="py-2 text-right font-mono text-slate-200">${position.marketValue.toFixed(2)}</td>
                      <td className={`py-2 text-right font-mono ${position.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {position.unrealizedPnl >= 0 ? '+' : ''}{position.unrealizedPnl.toFixed(2)}
                        <span className="text-slate-500 ml-1">
                          ({position.unrealizedPnl >= 0 ? '+' : ''}{position.unrealizedPnlPct.toFixed(2)}%)
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
