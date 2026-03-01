import { BarChart3 } from 'lucide-react';
import { BacktestResult, BacktestSweepResult } from '../types';
import { WidgetHelp } from './WidgetHelp';

interface BacktestPanelProps {
  backtest: BacktestResult | null;
  loading: boolean;
  error: string | null;
  sweep: BacktestSweepResult | null;
  sweepLoading: boolean;
  sweepError: string | null;
  strategyVariant: string;
  lastOptimized: string | null;
}

function variantNaam(variant: string) {
  if (variant === 'defensive') return 'Defensief';
  if (variant === 'balanced') return 'Gebalanceerd';
  if (variant === 'aggressive') return 'Agressief';
  if (variant === 'trend-max') return 'Trend-max';
  return variant;
}

function vertaalOmschrijving(omschrijving: string) {
  return omschrijving
    .replace('Lower allocation, stronger drawdown protection', 'Lagere allocatie, sterkere drawdown-bescherming')
    .replace('Baseline strategy profile', 'Basisprofiel van de strategie')
    .replace('Higher bull allocation and faster rebalancing', 'Hogere bull-allocatie en snellere herbalancering')
    .replace('Stronger trend bias with later risk-off trigger', 'Sterkere trendfocus met latere risk-off trigger');
}

export function BacktestPanel({
  backtest,
  loading,
  error,
  sweep,
  sweepLoading,
  sweepError,
  strategyVariant,
  lastOptimized,
}: BacktestPanelProps) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 size={14} className="text-slate-400" />
          <h2 className="text-slate-400 text-xs font-semibold uppercase tracking-widest">Backtest</h2>
        </div>
        <div className="text-[11px] text-slate-500 text-right">
          <p>Modus: automatische frontend-analyse</p>
          <p>Actief profiel: <span className="text-slate-300 font-semibold">{strategyVariant}</span></p>
          {lastOptimized && <p>Laatst geoptimaliseerd: {new Date(lastOptimized).toLocaleString()}</p>}
        </div>
      </div>
      <WidgetHelp title="Backtest en optimalisatie">
        Deze widget vergelijkt de prestaties van de strategie op historische data. Rendement laat
        groei zien, maximale drawdown laat het grootste tussentijdse verlies zien, en win rate geeft
        het percentage winstgevende afsluitingen. De sweep-ranking test meerdere varianten en sorteert
        die op een samengestelde score voor rendement versus risico.
      </WidgetHelp>

      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      {sweepError && <p className="text-xs text-red-400 mb-2">{sweepError}</p>}
      {(loading || sweepLoading) && <p className="text-xs text-slate-500 mb-2">Analyses worden geladen…</p>}

      {!backtest ? (
        <p className="text-slate-500 text-xs">Analysegegevens worden automatisch uit live data berekend.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          {[
            {
              label: 'Strategie-rendement',
              value: `${backtest.returnPct >= 0 ? '+' : ''}${backtest.returnPct.toFixed(2)}%`,
              color: backtest.returnPct >= 0 ? 'text-emerald-400' : 'text-red-400',
            },
            {
              label: 'Benchmark-rendement',
              value: `${backtest.benchmark.returnPct >= 0 ? '+' : ''}${backtest.benchmark.returnPct.toFixed(2)}%`,
              color: backtest.benchmark.returnPct >= 0 ? 'text-emerald-400' : 'text-red-400',
            },
            {
              label: 'Max. drawdown',
              value: `${backtest.maxDrawdownPct.toFixed(2)}%`,
              color: 'text-yellow-400',
            },
            {
              label: 'Winstpercentage',
              value: `${backtest.winRatePct.toFixed(1)}%`,
              color: 'text-sky-400',
            },
            {
              label: 'Transacties',
              value: String(backtest.tradeCount),
              color: 'text-slate-200',
            },
            {
              label: 'Gem. order',
              value: `$${backtest.avgTradeUsd.toFixed(2)}`,
              color: 'text-slate-200',
            },
            {
              label: 'Startwaarde',
              value: `$${backtest.startEquity.toFixed(2)}`,
              color: 'text-slate-200',
            },
            {
              label: 'Eindwaarde',
              value: `$${backtest.endEquity.toFixed(2)}`,
              color: 'text-slate-200',
            },
          ].map((item) => (
            <div key={item.label} className="bg-surface-700/40 rounded-lg p-2.5">
              <p className="text-slate-500 mb-0.5">{item.label}</p>
              <p className={`font-mono font-semibold ${item.color}`}>{item.value}</p>
            </div>
          ))}
        </div>
      )}

      {sweep && sweep.top.length > 0 && (
        <div className="mt-4 border-t border-white/5 pt-4">
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-widest mb-2">
            Sweep-ranking ({sweep.variantsTested} varianten)
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-white/5">
                  <th className="text-left pb-2">Variant</th>
                  <th className="text-right pb-2">Score</th>
                  <th className="text-right pb-2">Rendement</th>
                  <th className="text-right pb-2">Max DD</th>
                  <th className="text-right pb-2">Winst%</th>
                </tr>
              </thead>
              <tbody>
                {sweep.top.map((row) => (
                  <tr key={row.variant} className="border-b border-white/5 last:border-b-0">
                    <td className="py-2 text-slate-200">
                      <span className="font-semibold">{variantNaam(row.variant)}</span>
                      <span className="text-slate-500 ml-2">{vertaalOmschrijving(row.description)}</span>
                    </td>
                    <td className="py-2 text-right font-mono text-sky-300">{row.objectiveScore.toFixed(2)}</td>
                    <td className={`py-2 text-right font-mono ${row.returnPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {row.returnPct >= 0 ? '+' : ''}{row.returnPct.toFixed(2)}%
                    </td>
                    <td className="py-2 text-right font-mono text-yellow-400">{row.maxDrawdownPct.toFixed(2)}%</td>
                    <td className="py-2 text-right font-mono text-slate-200">{row.winRatePct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-slate-600 text-[11px] mt-2">{sweep.objective}</p>
        </div>
      )}
    </div>
  );
}
