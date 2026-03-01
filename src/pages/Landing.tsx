import { Link } from 'react-router-dom';
import { Wallet, Bitcoin, Waves } from 'lucide-react';

export function Landing() {
  return (
    <div className="min-h-screen bg-surface-950 flex flex-col items-center justify-center p-8 text-white">
      <div className="max-w-3xl w-full space-y-6">
        <div className="text-center space-y-2">
          <p className="text-slate-400 text-xs uppercase tracking-[0.3em]">Multi-asset handelsbot</p>
          <h1 className="text-3xl font-bold">Kies je markt</h1>
          <p className="text-slate-500 text-sm">Start een simulatiepagina voor XRP of BTC met eigen fondsinstellingen.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link to="/xrp" className="card hover:border-emerald-400/40 transition-all group">
            <div className="flex items-center gap-3 mb-2">
              <Waves className="text-emerald-400" size={18} />
              <h2 className="text-lg font-semibold">XRP bot</h2>
            </div>
            <p className="text-slate-400 text-sm">Standaard portefeuille ($10k) en bestaande XRP strategie.</p>
            <p className="text-emerald-400 text-xs mt-2 group-hover:underline">Ga naar XRP</p>
          </Link>

          <Link to="/btc" className="card hover:border-amber-400/40 transition-all group">
            <div className="flex items-center gap-3 mb-2">
              <Bitcoin className="text-amber-400" size={18} />
              <h2 className="text-lg font-semibold">BTC bot</h2>
            </div>
            <p className="text-slate-400 text-sm">Losse BTC-omgeving (server op 8788, fonds $20k standaard).</p>
            <p className="text-amber-400 text-xs mt-2 group-hover:underline">Ga naar BTC</p>
          </Link>
        </div>

        <div className="text-slate-600 text-xs flex items-center gap-2 justify-center">
          <Wallet size={12} />
          <span>Start aparte servers per asset voor gescheiden fondsen en DB's.</span>
        </div>
      </div>
    </div>
  );
}
