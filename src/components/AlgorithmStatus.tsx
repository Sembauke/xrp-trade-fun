import { Brain, ArrowUpCircle, ArrowDownCircle, MinusCircle, Zap } from 'lucide-react';
import { Decision } from '../types';
import { WidgetHelp } from './WidgetHelp';

interface AlgorithmStatusProps {
  decision: Decision | null;
}

const actionConfig = {
  BUY:  { icon: ArrowUpCircle,   color: 'emerald', label: 'KOPEN',  bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400' },
  SELL: { icon: ArrowDownCircle, color: 'red',     label: 'VERKOPEN', bg: 'bg-red-500/10',     border: 'border-red-500/20',     text: 'text-red-400'     },
  HOLD: { icon: MinusCircle,     color: 'yellow',  label: 'WACHTEN', bg: 'bg-yellow-500/10',  border: 'border-yellow-500/20',  text: 'text-yellow-400'  },
};

const MAX_SCORE = 10;

function regimeLabel(regime: Decision['regime']) {
  if (regime === 'BULL') return 'Bull';
  if (regime === 'BEAR') return 'Bear';
  return 'Transitie';
}

function translateReason(reason: string) {
  return reason
    .replace('Regime', 'Regime')
    .replace('rebalance toward', 'herbalanceer naar')
    .replace('wait for higher-confidence setup', 'wacht op setup met hogere zekerheid')
    .replace('score', 'score');
}

export function AlgorithmStatus({ decision }: AlgorithmStatusProps) {
  if (!decision) {
    return (
      <div className="card flex items-center justify-center h-full min-h-32">
        <div className="text-slate-600 text-sm">Bezig met berekenen…</div>
      </div>
    );
  }

  const cfg = actionConfig[decision.action];
  const Icon = cfg.icon;
  const scorePct = Math.abs(decision.totalScore) / MAX_SCORE * 100;
  const isPositiveScore = decision.totalScore >= 0;

  const strengthLabel = decision.strength === 'STRONG'
    ? 'STERK'
    : decision.strength === 'WEAK'
      ? 'ZWAK'
      : 'NORMAAL';

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <Brain size={14} className="text-slate-400" />
        <h2 className="text-slate-400 text-xs font-semibold uppercase tracking-widest">Algoritme</h2>
      </div>
      <WidgetHelp title="Algoritme-status">
        Dit blok toont de actuele beslissing van de bot op basis van meerdere tijdframes en indicatoren.
        De scorebalk vat alle signalen samen: hoe hoger positief, hoe sterker richting kopen; hoe lager
        negatief, hoe sterker richting verkopen. De redenregel beschrijft waarom de actie is gekozen.
      </WidgetHelp>

      {/* Decision badge */}
      <div className={`flex items-center gap-3 p-3 rounded-xl mb-4 border ${cfg.bg} ${cfg.border}`}>
        <Icon size={28} className={cfg.text} />
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-xl font-bold ${cfg.text}`}>{cfg.label}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
              {strengthLabel}
            </span>
          </div>
          <p className="text-slate-400 text-xs mt-0.5">{translateReason(decision.reason)}</p>
          <p className="text-slate-500 text-xs mt-0.5">Marktregime: {regimeLabel(decision.regime)}</p>
        </div>
      </div>

      {/* Score bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-slate-500 mb-1.5">
          <span>Signaalscore</span>
          <span className={`font-mono font-semibold ${isPositiveScore ? 'text-emerald-400' : 'text-red-400'}`}>
            {decision.totalScore > 0 ? '+' : ''}{decision.totalScore.toFixed(1)} / {MAX_SCORE}
          </span>
        </div>
        <div className="h-2.5 bg-surface-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${isPositiveScore ? 'bg-emerald-500' : 'bg-red-500'}`}
            style={{ width: `${Math.min(scorePct, 100)}%` }}
          />
        </div>
      </div>

      {/* Trade amount */}
      {decision.action !== 'HOLD' && decision.amount > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Zap size={11} className="text-yellow-400" />
          <span>
            {decision.action === 'BUY'
              ? `Koop ~${decision.amount.toFixed(2)} XRP`
              : `Verkoop ~${decision.amount.toFixed(2)} XRP`}
          </span>
        </div>
      )}
    </div>
  );
}
