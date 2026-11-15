'use client';

import { type HoldingView, type InstrumentRow, insights } from '@kosh/core';
import Link from 'next/link';
import { useMemo } from 'react';
import { Change } from '@/components/num';
import { useFormat } from '@/components/providers/settings-provider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Descriptive observations about the portfolio. Never a recommendation. */
export function InsightsCard({
  rows,
  holdings,
  asOf,
}: {
  rows: InstrumentRow[];
  holdings: Record<string, HoldingView>;
  asOf: string;
}) {
  const f = useFormat();
  const i = useMemo(() => insights(rows, holdings, asOf), [rows, holdings, asOf]);
  const period = i.holdingPeriod;
  const periodTotal = Number(period.longTerm) + Number(period.shortTerm) + Number(period.unknown);

  const mover = (r: InstrumentRow) => (
    <li key={r.instrumentId} className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <Link
        href={`/holdings/${encodeURIComponent(r.instrumentId)}`}
        className="min-w-0 truncate underline-offset-2 hover:underline"
      >
        {r.name}
      </Link>
      <Change value={r.dayChange} pct={r.dayChangePct} showPct className="shrink-0 text-sm" />
    </li>
  );

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Insights</CardTitle>
        <CardDescription>Facts about your holdings. Not investment advice.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <section aria-labelledby="ins-movers">
          <h3 id="ins-movers" className="text-sm font-medium">
            Today’s biggest moves
          </h3>
          {i.gainers.length + i.losers.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Appears once your holdings have a previous close.
            </p>
          ) : (
            <ul className="mt-1 divide-y">
              {i.gainers.map(mover)}
              {i.losers.map(mover)}
            </ul>
          )}
        </section>

        <section aria-labelledby="ins-conc">
          <h3 id="ins-conc" className="text-sm font-medium">
            Large positions
          </h3>
          {i.concentrated.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              No single holding is more than {f.percent(i.threshold, { decimals: 0 })} of your
              portfolio.
            </p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {i.concentrated.map((r) => (
                <li key={r.instrumentId} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{r.name}</span>
                  <span className="num font-medium">{f.percent(r.weight!, { decimals: 1 })}</span>
                </li>
              ))}
              <li className="text-xs text-muted-foreground">
                Each is more than {f.percent(i.threshold, { decimals: 0 })} of your portfolio’s
                value.
              </li>
            </ul>
          )}
        </section>

        {periodTotal > 0 && (
          <section aria-labelledby="ins-period">
            <h3 id="ins-period" className="text-sm font-medium">
              How long you have held
            </h3>
            <ul className="mt-1 space-y-1 text-sm">
              {(
                [
                  ['More than a year', period.longTerm],
                  ['Less than a year', period.shortTerm],
                  ['Unknown (statement holdings)', period.unknown],
                ] as const
              )
                .filter(([, v]) => Number(v) > 0)
                .map(([label, v]) => (
                  <li key={label} className="flex justify-between gap-3">
                    <span>{label}</span>
                    <span className="num">
                      {f.money(v, { compact: true })}{' '}
                      <span className="text-muted-foreground">
                        ({f.percent(Number(v) / periodTotal, { decimals: 0 })})
                      </span>
                    </span>
                  </li>
                ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">
              By value, from purchase dates. Informational only, not tax advice.
            </p>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
