import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';
import { format } from 'date-fns';
import { ChartPoint } from '../types';
import { WidgetHelp } from './WidgetHelp';

interface PriceChartProps {
  data: ChartPoint[];
  currentPrice: number;
}

const CustomTooltip = ({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: number;
}) => {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="bg-surface-800 border border-white/10 rounded-xl p-3 text-xs shadow-2xl">
      <p className="text-slate-400 mb-2">{format(label, 'HH:mm')}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2 mb-0.5">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-400">{p.name}:</span>
          <span className="text-white font-mono">${p.value?.toFixed(4)}</span>
        </div>
      ))}
    </div>
  );
};

export function PriceChart({ data, currentPrice }: PriceChartProps) {
  if (data.length === 0) {
    return (
      <div className="card flex items-center justify-center h-80">
        <p className="text-slate-600 text-sm animate-pulse">Grafiekdata laden…</p>
      </div>
    );
  }

  const min = Math.min(...data.map(d => d.bbLower)) * 0.9995;
  const max = Math.max(...data.map(d => d.bbUpper)) * 1.0005;

  const isUp = data.length > 1 && data[data.length - 1].price >= data[0].price;
  const priceColor = isUp ? '#10b981' : '#ef4444';
  const gradId = isUp ? 'priceGradUp' : 'priceGradDown';

  // Downsample for performance on smaller screens
  const displayData = data.length > 80 ? data.slice(-80) : data;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-slate-400 text-xs font-semibold uppercase tracking-widest">Prijsgrafiek (1m candles)</h2>
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5"><span className="w-6 h-px bg-sky-400 inline-block" /> EMA20</span>
          <span className="flex items-center gap-1.5"><span className="w-6 h-px bg-violet-400 inline-block" /> EMA50</span>
          <span className="flex items-center gap-1.5"><span className="w-6 h-px bg-fuchsia-400 inline-block" /> EMA200</span>
          <span className="flex items-center gap-1.5"><span className="w-6 h-px border-t border-dashed border-slate-500 inline-block" /> BB</span>
        </div>
      </div>
      <WidgetHelp title="Prijsgrafiek">
        Deze grafiek toont de recente XRP-prijs met EMA20, EMA50 en EMA200 voor trendrichting.
        De Bollinger-banden geven volatiliteit en mogelijke overreacties aan. De gestippelde lijn
        is de huidige prijs, zodat je direct ziet waar de markt nu staat ten opzichte van trends.
      </WidgetHelp>

      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={displayData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={priceColor} stopOpacity={0.3} />
              <stop offset="95%" stopColor={priceColor} stopOpacity={0} />
            </linearGradient>
            {/* BB fill area */}
            <linearGradient id="bbFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.08} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />

          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={v => format(v, 'HH:mm')}
            tick={{ fill: '#475569', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[min, max]}
            tickFormatter={v => `$${v.toFixed(3)}`}
            tick={{ fill: '#475569', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={64}
          />

          <Tooltip content={<CustomTooltip />} />

          {/* Bollinger Band fill */}
          <Area
            type="monotone"
            dataKey="bbUpper"
            name="BB Bovengrens"
            stroke="#6366f140"
            strokeWidth={1}
            strokeDasharray="4 3"
            fill="url(#bbFill)"
            dot={false}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="bbLower"
            name="BB Ondergrens"
            stroke="#6366f140"
            strokeWidth={1}
            strokeDasharray="4 3"
            fill="#0a0e1a"
            dot={false}
            isAnimationActive={false}
          />

          {/* BB Middle */}
          <Line
            type="monotone"
            dataKey="bbMiddle"
            name="BB Midden"
            stroke="#334155"
            strokeWidth={1}
            strokeDasharray="2 4"
            dot={false}
            isAnimationActive={false}
          />

          {/* EMA lines */}
          <Line
            type="monotone"
            dataKey="ema20"
            name="EMA 20"
            stroke="#38bdf8"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="ema50"
            name="EMA 50"
            stroke="#a78bfa"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="ema200"
            name="EMA 200"
            stroke="#e879f9"
            strokeWidth={1.4}
            dot={false}
            isAnimationActive={false}
          />

          {/* Price */}
          <Area
            type="monotone"
            dataKey="price"
            name="Prijs"
            stroke={priceColor}
            strokeWidth={2}
            fill={`url(#${gradId})`}
            dot={false}
            isAnimationActive={false}
          />

          {/* Current price reference line */}
          <ReferenceLine
            y={currentPrice}
            stroke={priceColor}
            strokeDasharray="3 3"
            strokeWidth={1}
            label={{ value: `$${currentPrice.toFixed(4)}`, position: 'right', fill: priceColor, fontSize: 10 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
