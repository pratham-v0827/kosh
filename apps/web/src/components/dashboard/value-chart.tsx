'use client';

import { type ChartRange, seriesRange } from '@kosh/core';
import { LineChart as LineIcon } from 'lucide-react';
import { useMemo, useSyncExternalStore } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts';
import { Change } from '@/components/num';
import { useFormat } from '@/components/providers/settings-provider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { Loadable, SeriesPointView } from '@/lib/hooks';
import { cn } from '@/lib/utils';

const RANGES: ChartRange[] = ['1W', '1M', '3M', '6M', '1Y', 'ALL'];
const RANGE_LABEL: Record<ChartRange, string> = {
  '1W': '1 week',
  '1M': '1 month',
  '3M': '3 months',
  '6M': '6 months',
  '1Y': '1 year',
  ALL: 'All time',
};

const shortDate = (iso: string, withYear = false) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** True when the user asked for less motion. Animations are off until that is known. */
function useReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const q = window.matchMedia(REDUCED_MOTION);
      q.addEventListener('change', onChange);
      return () => q.removeEventListener('change', onChange);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => true, // server render: no animation
  );
}

/** The period buttons. They sit above the chart card and scope everything in it. */
export function RangePicker({
  value,
  onChange,
}: {
  value: ChartRange;
  onChange: (r: ChartRange) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Period" className="inline-flex rounded-lg border p-0.5">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={value === r}
          aria-label={RANGE_LABEL[r]}
          onClick={() => onChange(r)}
          className={cn(
            'min-h-8 min-w-10 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
            value === r && 'bg-accent text-accent-foreground',
          )}
        >
          {r === 'ALL' ? 'All' : r}
        </button>
      ))}
    </div>
  );
}

export function ValueChart({
  series,
  range,
  asOf,
}: {
  series: Loadable<SeriesPointView[]>;
  range: ChartRange;
  asOf: string;
}) {
  const f = useFormat();
  const reduced = useReducedMotion();
  const view = useMemo(
    () => (series.status === 'ready' ? seriesRange(series.data, range, asOf) : null),
    [series, range, asOf],
  );

  if (series.status === 'loading') return <Skeleton className="h-80" />;
  if (series.status === 'error') {
    return (
      <Card>
        <CardContent className="text-sm text-muted-foreground">
          The value history could not be loaded: {series.error}
        </CardContent>
      </Card>
    );
  }
  const points = view!.points;
  const latest = points.at(-1);
  const spansYears = points.length > 1 && points[0]!.date.slice(0, 4) !== latest!.date.slice(0, 4);

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Value over time</CardTitle>
          <CardDescription>
            One point a day, from your refreshes and the daily snapshot.
          </CardDescription>
        </div>
        {view!.gain !== null && (
          <div className="text-right text-sm">
            <span className="text-muted-foreground">
              Gain over {RANGE_LABEL[range].toLowerCase()}{' '}
            </span>
            <Change value={view!.gain} pct={view!.gainPct} />
            <p className="text-xs text-muted-foreground">
              Money you added or took out is left out.
            </p>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {points.length < 2 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <LineIcon aria-hidden className="size-6" />
            <p>
              {points.length === 0
                ? 'Your history starts with your first refresh.'
                : 'The chart appears once there are two days of history in this period.'}
            </p>
          </div>
        ) : (
          <>
            {/* Legend: also the direct label, with the latest value of each line. */}
            <ul className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm" aria-label="Lines">
              <li className="flex items-center gap-2">
                <span aria-hidden className="h-0.5 w-4 rounded-full bg-chart-1" />
                <span className="text-muted-foreground">Value</span>
                <span className="num font-medium">{f.money(latest!.value, { compact: true })}</span>
              </li>
              <li className="flex items-center gap-2">
                <span aria-hidden className="h-0.5 w-4 rounded-full bg-muted-foreground" />
                <span className="text-muted-foreground">Invested</span>
                <span className="num font-medium">
                  {f.money(latest!.invested, { compact: true })}
                </span>
              </li>
            </ul>
            <div
              className="h-64"
              role="img"
              aria-label={`Line chart of portfolio value and amount invested, ${RANGE_LABEL[range].toLowerCase()}, from ${shortDate(points[0]!.date, true)} to ${shortDate(latest!.date, true)}. The same data is in the table below.`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--color-border)" strokeWidth={1} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: string) => shortDate(d, spansYears)}
                    tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--color-border)' }}
                    minTickGap={32}
                  />
                  <YAxis
                    width={64}
                    tickFormatter={(v: number) => f.money(v, { compact: true })}
                    tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    cursor={{ stroke: 'var(--color-muted-foreground)', strokeWidth: 1 }}
                    content={(p) => <ChartTooltip {...p} />}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="invested"
                    name="Invested"
                    stroke="var(--color-muted-foreground)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-card)' }}
                    isAnimationActive={!reduced}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    name="Value"
                    stroke="var(--color-chart-1)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-card)' }}
                    isAnimationActive={!reduced}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <details className="mt-3 text-sm">
              <summary className="min-h-6 cursor-pointer text-muted-foreground">
                Show as a table
              </summary>
              <div className="mt-2 max-h-64 overflow-y-auto">
                <table className="w-full text-left">
                  <caption className="sr-only">Portfolio value and amount invested by day</caption>
                  <thead className="sticky top-0 bg-card text-muted-foreground">
                    <tr>
                      <th scope="col" className="py-1 font-normal">
                        Date
                      </th>
                      <th scope="col" className="py-1 text-right font-normal">
                        Value
                      </th>
                      <th scope="col" className="py-1 text-right font-normal">
                        Invested
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...points].reverse().map((p) => (
                      <tr key={p.date} className="border-t">
                        <td className="num py-1">{shortDate(p.date, true)}</td>
                        <td className="num py-1 text-right">{f.money(p.value)}</td>
                        <td className="num py-1 text-right">{f.money(p.invested)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ChartTooltip({ active, payload, label }: TooltipContentProps) {
  const f = useFormat();
  if (!active || !payload?.length) return null;
  const byKey = Object.fromEntries(payload.map((p) => [p.dataKey, p.value as number]));
  const rows: { key: string; name: string; color: string }[] = [
    { key: 'value', name: 'Value', color: 'var(--color-chart-1)' },
    { key: 'invested', name: 'Invested', color: 'var(--color-muted-foreground)' },
  ];
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
      <p className="mb-1 text-xs text-muted-foreground">{shortDate(String(label), true)}</p>
      {rows.map((r) =>
        byKey[r.key] === undefined ? null : (
          <p key={r.key} className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: r.color }} />
            <span className="num font-semibold">{f.money(byKey[r.key]!)}</span>
            <span className="text-muted-foreground">{r.name}</span>
          </p>
        ),
      )}
    </div>
  );
}
