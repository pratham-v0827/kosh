'use client';

import { type AssetClass, type ChartRange, seriesRange } from '@kosh/core';
import { LineChart as LineIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts';
import { RangePicker } from '@/components/dashboard/value-chart';
import { useFormat } from '@/components/providers/settings-provider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { usePriceHistory } from '@/lib/hooks';

type Status =
  'checking' | 'fresh' | 'updated' | 'pending' | 'unsupported' | 'unavailable' | 'error';

const day = (iso: string, withYear: boolean) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));

/**
 * Daily closing price (NAV for funds) with the user's average cost as a reference line. History
 * is fetched on the server at most once a day and shared; crypto and unlisted shares have none.
 */
export function PriceChart({
  instrumentId,
  assetClass,
  currency,
  avgCost,
  asOf,
}: {
  instrumentId: string;
  assetClass: AssetClass;
  currency: 'INR' | 'USD';
  avgCost: number | null;
  asOf: string;
}) {
  const f = useFormat();
  const history = usePriceHistory(instrumentId);
  const [range, setRange] = useState<ChartRange>('1Y');
  const [status, setStatus] = useState<{ id: string; s: Status } | null>(null);
  const supported = assetClass !== 'CRYPTO' && assetClass !== 'UNLISTED';

  useEffect(() => {
    if (!supported) return;
    let live = true;
    api<{ status: Status }>(`/api/v1/instruments/${encodeURIComponent(instrumentId)}/history`, {
      method: 'POST',
    })
      .then((r) => live && setStatus({ id: instrumentId, s: r.status }))
      .catch(() => live && setStatus({ id: instrumentId, s: 'error' }));
    return () => {
      live = false;
    };
  }, [instrumentId, supported]);

  const all = useMemo(() => (history.status === 'ready' ? history.data : []), [history]);
  const points = useMemo(
    () =>
      seriesRange(
        all.map((p) => ({ date: p.date, value: p.close, invested: 0 })),
        range,
        asOf,
      ).points.map((p) => ({ date: p.date, close: p.value })),
    [all, range, asOf],
  );
  const s = status?.id === instrumentId ? status.s : 'checking';
  const noun = assetClass === 'MUTUAL_FUND' ? 'NAV' : 'Price';
  const label = assetClass === 'MUTUAL_FUND' ? 'NAV per unit' : 'Closing price';

  let empty: string | null = null;
  if (!supported) {
    empty =
      assetClass === 'CRYPTO'
        ? 'Price history is not available for crypto yet.'
        : 'Unlisted shares have no market price history. Their value uses the price you set.';
  } else if (
    history.status === 'loading' ||
    (all.length === 0 && (s === 'checking' || s === 'pending'))
  ) {
    return <Skeleton className="h-80" />;
  } else if (history.status === 'error') {
    empty = `The price history could not be loaded: ${history.error}`;
  } else if (all.length === 0) {
    empty =
      s === 'unsupported'
        ? 'This holding has no ticker or scheme code, so there is no history to show.'
        : 'The price history could not be fetched right now. It is tried again within an hour.';
  } else if (points.length < 2) {
    empty = 'Not enough history in this period. Choose a longer one.';
  }

  const spansYears =
    points.length > 1 && points[0]!.date.slice(0, 4) !== points.at(-1)!.date.slice(0, 4);
  const money = (v: number) => f.money(v, { currency });

  return (
    <section aria-label={`${noun} history`} className="space-y-3">
      {supported && all.length > 0 && <RangePicker value={range} onChange={setRange} />}
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>{noun} history</CardTitle>
          <CardDescription>
            {label} each day
            {assetClass === 'MUTUAL_FUND'
              ? ', from mfapi.in (a community mirror of AMFI data).'
              : ', from Yahoo Finance (unofficial).'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {empty ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <LineIcon aria-hidden className="size-6" />
              <p>{empty}</p>
            </div>
          ) : (
            <>
              <ul className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm" aria-label="Lines">
                <li className="flex items-center gap-2">
                  <span aria-hidden className="h-0.5 w-4 rounded-full bg-chart-1" />
                  <span className="text-muted-foreground">{noun}</span>
                  <span className="num font-medium">{money(points.at(-1)!.close)}</span>
                </li>
                {avgCost !== null && (
                  <li className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="w-4 border-t-2 border-dashed border-muted-foreground"
                    />
                    <span className="text-muted-foreground">Your average cost</span>
                    <span className="num font-medium">{money(avgCost)}</span>
                  </li>
                )}
              </ul>
              <div
                className="h-64"
                role="img"
                aria-label={`Line chart of the ${label.toLowerCase()} from ${day(points[0]!.date, true)} to ${day(points.at(-1)!.date, true)}. The same data is in the table below.`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--color-border)" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d: string) => day(d, spansYears)}
                      tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
                      tickLine={false}
                      axisLine={{ stroke: 'var(--color-border)' }}
                      minTickGap={32}
                    />
                    <YAxis
                      width={72}
                      tickFormatter={(v: number) => f.money(v, { currency, compact: true })}
                      tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      domain={['auto', 'auto']}
                    />
                    {avgCost !== null && (
                      <ReferenceLine
                        y={avgCost}
                        stroke="var(--color-muted-foreground)"
                        strokeDasharray="4 4"
                        ifOverflow="extendDomain"
                      />
                    )}
                    <Tooltip
                      cursor={{ stroke: 'var(--color-muted-foreground)', strokeWidth: 1 }}
                      content={(p) => <PriceTooltip {...p} format={money} noun={noun} />}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="close"
                      name={noun}
                      stroke="var(--color-chart-1)"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-card)' }}
                      isAnimationActive={false}
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
                    <caption className="sr-only">{label} by day</caption>
                    <thead className="sticky top-0 bg-card text-muted-foreground">
                      <tr>
                        <th scope="col" className="py-1 font-normal">
                          Date
                        </th>
                        <th scope="col" className="py-1 text-right font-normal">
                          {noun}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...points].reverse().map((p) => (
                        <tr key={p.date} className="border-t">
                          <td className="num py-1">{day(p.date, true)}</td>
                          <td className="num py-1 text-right">{money(p.close)}</td>
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
    </section>
  );
}

function PriceTooltip({
  active,
  payload,
  label,
  format,
  noun,
}: TooltipContentProps & { format: (v: number) => string; noun: string }) {
  if (!active || !payload?.length) return null;
  const v = payload[0]!.value as number;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
      <p className="mb-1 text-xs text-muted-foreground">{day(String(label), true)}</p>
      <p className="flex items-center gap-2">
        <span aria-hidden className="h-0.5 w-3 rounded-full bg-chart-1" />
        <span className="num font-semibold">{format(v)}</span>
        <span className="text-muted-foreground">{noun}</span>
      </p>
    </div>
  );
}
