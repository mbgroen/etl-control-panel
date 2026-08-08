import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatClock } from '../lib/format';
import type { HistorySample } from '../lib/types';

/**
 * Single-measure time series.
 *
 * Player count and CPU are rendered as two separate charts rather than one with
 * two y-axes: a dual-axis chart lets the author imply a correlation by choosing
 * the scales, and readers cannot tell which line belongs to which axis. One
 * measure, one axis, one hue — and with a single series a legend would only
 * repeat the title, so the title carries the identity instead.
 */

export interface ActivityChartProps {
  samples: HistorySample[];
  metric: 'players' | 'cpuPercent';
  /** CSS custom property supplying the series colour, e.g. 'var(--accent)'. */
  color: string;
  /** Upper bound for the y-axis; the axis stays fixed so height is comparable. */
  domainMax?: number;
  unit?: string;
  height?: number;
}

export function ActivityChart({
  samples,
  metric,
  color,
  domainMax,
  unit = '',
  height = 180,
}: ActivityChartProps) {
  if (samples.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-faint"
        style={{ height }}
      >
        Collecting data — the chart fills in as the control panel polls the server.
      </div>
    );
  }

  const gradientId = `fill-${metric}`;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={samples} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.26} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {/* Horizontal rules only: vertical grid lines add ink without helping
            anyone read a value off a time axis. */}
        <CartesianGrid vertical={false} strokeDasharray="0" />

        <XAxis
          dataKey="t"
          tickFormatter={(value: number) => formatClock(value)}
          axisLine={false}
          tickLine={false}
          minTickGap={48}
        />
        <YAxis
          domain={[0, domainMax ?? 'auto']}
          allowDecimals={false}
          axisLine={false}
          tickLine={false}
          width={44}
        />

        <Tooltip
          cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const sample = payload[0]?.payload as HistorySample | undefined;
            if (!sample) return null;

            return (
              <div className="card px-2.5 py-2 text-xs">
                <p className="tabular font-medium text-body">
                  {metric === 'players'
                    ? `${sample.players} / ${sample.maxPlayers || '—'} players`
                    : `${sample.cpuPercent.toFixed(1)}${unit}`}
                </p>
                <p className="mt-0.5 text-faint">{formatClock(sample.t)}</p>
                {sample.map && metric === 'players' && (
                  <p className="mt-0.5 text-muted">on {sample.map}</p>
                )}
              </div>
            );
          }}
        />

        <Area
          type="monotone"
          dataKey={metric}
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          // Points are dense; drawing a dot per sample would be noise. The
          // hover dot still appears on the active point.
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
