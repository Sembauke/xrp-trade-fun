import { useTradingBot } from './hooks/useTradingBot';
import { Header } from './components/Header';
import { PriceChart } from './components/PriceChart';
import { SignalsPanel } from './components/SignalsPanel';
import { AlgorithmStatus } from './components/AlgorithmStatus';
import { TradeHistory } from './components/TradeHistory';
import { BacktestPanel } from './components/BacktestPanel';
import { AlertTriangle } from 'lucide-react';
import { WidgetHelp } from './components/WidgetHelp';
import { PortfolioWidget } from './components/PortfolioWidget';

export default function App() {
  const regimeNederlands = (regime: string) => {
    if (regime === 'BULL') return 'Bull';
    if (regime === 'BEAR') return 'Bear';
    return 'Transitie';
  };

  const {
    currentPrice, previousPrice, portfolio, trades, decision,
    indicators, chartData, isLoading, isRunning, error, lastUpdate,
    totalValue, pnl, pnlPct,
    backtest, backtestLoading, backtestError,
    sweep, sweepLoading, sweepError,
    strategy,
    toggleRunning,
  } = useTradingBot();

  return (
    <div className="min-h-screen bg-surface-950 flex flex-col">
      {/* Header */}
      <Header
        currentPrice={currentPrice}
        previousPrice={previousPrice}
        lastUpdate={lastUpdate}
        isRunning={isRunning}
        onToggle={toggleRunning}
      />

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-3 flex items-center gap-2 px-4 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {/* Loading state */}
      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20 animate-pulse">
            <span className="text-2xl">🪙</span>
          </div>
          <p className="text-slate-400 text-sm animate-pulse">Verbinden met Binance…</p>
        </div>
      ) : (
        <main className="flex-1 p-4 lg:p-6 space-y-4">

          {/* Top row: Algorithm | Marktstatistieken */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AlgorithmStatus decision={decision} />
            <div className="card flex flex-col justify-between gap-3">
              <h2 className="text-slate-400 text-xs font-semibold uppercase tracking-widest">Marktstatistieken</h2>
              <WidgetHelp title="Marktstatistieken">
                Dit overzicht toont kernindicatoren uit meerdere tijdframes: regime, RSI, trend-EMA's en
                momentum. De target XRP en huidige XRP laten zien waar het algoritme de allocatie naartoe
                wil sturen en waar de portefeuille nu daadwerkelijk staat.
              </WidgetHelp>
              {indicators && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { label: 'Regime', value: regimeNederlands(indicators.regime), color: indicators.regime === 'BULL' ? 'text-emerald-400' : indicators.regime === 'BEAR' ? 'text-red-400' : 'text-yellow-400' },
                    { label: '1D RSI', value: indicators.dayRsi.toFixed(1), color: indicators.dayRsi < 40 ? 'text-emerald-400' : indicators.dayRsi > 70 ? 'text-red-400' : 'text-slate-300' },
                    { label: '4H EMA50/200', value: `${indicators.trend4h.ema50.toFixed(4)} / ${indicators.trend4h.ema200.toFixed(4)}`, color: indicators.trend4h.ema50 > indicators.trend4h.ema200 ? 'text-emerald-400' : 'text-red-400' },
                    { label: '4H MACD Hist', value: indicators.trend4h.macdHistogram.toFixed(5), color: indicators.trend4h.macdHistogram >= 0 ? 'text-emerald-400' : 'text-red-400' },
                    { label: 'Doel XRP', value: `${indicators.targetAllocationPct.toFixed(0)}%`, color: 'text-sky-400' },
                    { label: 'Huidig XRP', value: `${indicators.currentAllocationPct.toFixed(0)}%`, color: 'text-violet-400' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-surface-700/40 rounded-lg p-2.5">
                      <p className="text-slate-500 mb-0.5">{label}</p>
                      <p className={`font-mono font-semibold ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <PortfolioWidget
            usd={portfolio.usd}
            xrp={portfolio.xrp}
            currentPrice={currentPrice}
            avgCostBasis={portfolio.avgCostBasis}
            totalValue={totalValue}
          />

          {/* Chart */}
          <PriceChart data={chartData} currentPrice={currentPrice} />

          {/* Signals */}
          {decision && decision.signals.length > 0 && (
            <SignalsPanel signals={decision.signals} />
          )}

          <BacktestPanel
            backtest={backtest}
            loading={backtestLoading}
            error={backtestError}
            sweep={sweep}
            sweepLoading={sweepLoading}
            sweepError={sweepError}
            strategyVariant={strategy.variant}
            lastOptimized={strategy.lastOptimized}
          />
          {/* Trade History */}
          <TradeHistory trades={trades} currentPrice={currentPrice} />

        </main>
      )}

      {/* Footer */}
      <footer className="text-center text-slate-700 text-xs py-3 border-t border-white/5">
        Alleen simulatie · Paper money · Langetermijnstrategie · SQLite-opslag
      </footer>
    </div>
  );
}
