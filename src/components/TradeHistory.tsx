import { ArrowUpCircle, ArrowDownCircle, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Trade } from '../types';
import { WidgetHelp } from './WidgetHelp';

interface TradeHistoryProps {
  trades: Trade[];
  currentPrice: number;
}

function translateReason(reason: string) {
  return reason
    .replace('Regime', 'Regime')
    .replace('rebalance toward', 'herbalanceer naar')
    .replace('wait for higher-confidence setup', 'wacht op setup met hogere zekerheid')
    .replace('score', 'score');
}

export function TradeHistory({ trades, currentPrice }: TradeHistoryProps) {
  if (trades.length === 0) {
    return (
      <div className="card">
        <h2 className="text-slate-400 text-xs font-semibold uppercase tracking-widest mb-4">
          Handelshistorie
        </h2>
        <WidgetHelp title="Handelshistorie">
          Elke regel is een uitgevoerde simulatie-order. Live P&L laat per order zien wat de actuele
          winst of het verlies zou zijn bij de huidige prijs. Dit helpt om snel te zien welke instappen
          goed of slecht uitpakken terwijl de markt beweegt.
        </WidgetHelp>
        <div className="flex items-center justify-center py-12 text-slate-600 text-sm">
          Nog geen transacties - wachten op signalen…
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-slate-400 text-xs font-semibold uppercase tracking-widest">
          Handelshistorie
        </h2>
        <span className="text-slate-500 text-xs">{trades.length} totaal</span>
      </div>
      <WidgetHelp title="Handelshistorie">
        Transacties worden automatisch uitgevoerd door het algoritme. Live P&L per regel wordt continu
        herberekend op basis van de huidige XRP-prijs. Groen is positief, rood is negatief.
      </WidgetHelp>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 text-xs border-b border-white/5">
              <th className="pb-2 text-left font-medium">Type</th>
              <th className="pb-2 text-left font-medium">Tijd</th>
              <th className="pb-2 text-right font-medium">Prijs</th>
              <th className="pb-2 text-right font-medium">Hoeveelheid</th>
              <th className="pb-2 text-right font-medium">Waarde</th>
              <th className="pb-2 text-right font-medium">Portfolio</th>
              <th className="pb-2 text-right font-medium">Live W/V</th>
              <th className="pb-2 text-left font-medium pl-4">Reden</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade, i) => {
              const isBuy = trade.action === 'BUY';
              const livePnl = isBuy
                ? (currentPrice - trade.price) * trade.amount
                : (trade.price - currentPrice) * trade.amount;
              const livePnlPct = trade.usdValue > 0
                ? (livePnl / trade.usdValue) * 100
                : 0;
              return (
                <tr
                  key={trade.id}
                  className={`border-b border-white/5 transition-colors hover:bg-surface-700/30
                    ${i === 0 ? 'animate-fade-in' : ''}`}
                >
                  <td className="py-2.5 pr-3">
                    <div className={`flex items-center gap-1.5 font-semibold
                      ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isBuy
                        ? <ArrowUpCircle size={13} />
                        : <ArrowDownCircle size={13} />}
                      {trade.action === 'BUY' ? 'KOPEN' : 'VERKOPEN'}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-1 text-slate-400 font-mono text-xs">
                      <Clock size={10} />
                      {format(typeof trade.time === 'string' ? parseISO(trade.time) : trade.time, 'HH:mm:ss')}
                    </div>
                  </td>
                  <td className="py-2.5 text-right font-mono text-white text-xs">
                    ${trade.price.toFixed(4)}
                  </td>
                  <td className="py-2.5 text-right font-mono text-white text-xs">
                    {trade.amount.toFixed(2)} <span className="text-slate-500">XRP</span>
                  </td>
                  <td className="py-2.5 text-right font-mono text-slate-300 text-xs">
                    ${trade.usdValue.toFixed(2)}
                  </td>
                  <td className="py-2.5 text-right font-mono text-slate-300 text-xs">
                    ${trade.totalAfter.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </td>
                  <td className={`py-2.5 text-right font-mono text-xs ${
                    livePnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {livePnl >= 0 ? '+' : ''}{livePnl.toFixed(2)}
                    <span className="text-slate-500 ml-1">
                      ({livePnl >= 0 ? '+' : ''}{livePnlPct.toFixed(2)}%)
                    </span>
                  </td>
                  <td className="py-2.5 pl-4 text-slate-500 text-xs max-w-[180px] truncate">
                    {translateReason(trade.reason)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
