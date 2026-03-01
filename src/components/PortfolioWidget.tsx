import { Wallet, Coins, Landmark } from 'lucide-react';
import { WidgetHelp } from './WidgetHelp';

interface PortfolioWidgetProps {
  usd: number;
  xrp: number;
  currentPrice: number;
  avgCostBasis: number;
  totalValue: number;
}

export function PortfolioWidget({
  usd,
  xrp,
  currentPrice,
  avgCostBasis,
  totalValue,
}: PortfolioWidgetProps) {
  const xrpValue = xrp * currentPrice;
  const usdPct = totalValue > 0 ? (usd / totalValue) * 100 : 0;
  const xrpPct = totalValue > 0 ? (xrpValue / totalValue) * 100 : 0;
  const positionPnl = xrp > 0 && avgCostBasis > 0
    ? (currentPrice - avgCostBasis) * xrp
    : 0;
  const positionPnlPct = xrp > 0 && avgCostBasis > 0
    ? ((currentPrice - avgCostBasis) / avgCostBasis) * 100
    : 0;

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <Wallet size={14} className="text-slate-400" />
        <h2 className="text-slate-400 text-xs font-semibold uppercase tracking-widest">Portefeuille-overzicht</h2>
      </div>
      <WidgetHelp title="Portefeuille-overzicht">
        Deze widget laat in een oogopslag je totale waarde, cash, XRP-positie en allocatie zien.
        Je ziet ook direct de actuele ongerealiseerde winst of het verlies op de XRP-positie
        op basis van de huidige marktprijs.
      </WidgetHelp>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
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
          <p className="text-slate-500 text-xs mb-1 inline-flex items-center gap-1.5"><Coins size={12} /> XRP-positie</p>
          <p className="text-white font-mono font-semibold">${xrpValue.toFixed(2)}</p>
          <p className="text-slate-500 text-xs">{xrp.toFixed(2)} XRP ({xrpPct.toFixed(1)}%)</p>
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
          <span>Allocatie XRP {xrpPct.toFixed(1)}%</span>
        </div>
        <div className="h-2 bg-surface-700 rounded-full overflow-hidden flex">
          <div className="h-full bg-sky-500 transition-all duration-700" style={{ width: `${usdPct}%` }} />
          <div className="h-full bg-indigo-400 transition-all duration-700" style={{ width: `${xrpPct}%` }} />
        </div>
      </div>
    </div>
  );
}
