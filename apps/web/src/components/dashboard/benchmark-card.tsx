'use client';

import {
  type BenchmarkGroup,
  type BenchmarkId,
  benchmarkComparison,
  type HoldingView,
} from '@kosh/core';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useMemo } from 'react';
import { useFormat } from '@/components/providers/settings-provider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { IndexCloses, Loadable } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { BENCHMARK_LABEL } from './labels';

const MARKET_TITLE = { IN: 'Indian holdings, in rupees', US: 'US holdings, in dollars' } as const;

/**
 * Each market's XIRR next to its index's XIRR for the same money on the same days. A list of
 * labelled figures, not a chart: there are at most three numbers to compare and they can be
 * negative.
 */
export function BenchmarkCard({
  holdings,
  asOf,
  indices,
}: {
  holdings: Record<string, HoldingView>;
  asOf: string;
  indices: Loadable<IndexCloses>;
}) {
  const groups = useMemo(
    () => (indices.status === 'ready' ? benchmarkComparison(holdings, asOf, indices.data) : null),
    [holdings, asOf, indices],
  );

  if (indices.status === 'loading') return <Skeleton className="h-48" />;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Compared with the market</CardTitle>
        <CardDescription>
          Your XIRR next to the index’s, as if the same money had gone into the index on the same
          days.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {indices.status === 'error' ? (
          <p className="text-sm text-muted-foreground">
            Index prices could not be loaded: {indices.error}
          </p>
        ) : groups!.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add Indian or US holdings with purchase dates to compare them with the Nifty 50, Sensex
            or S&amp;P 500.
          </p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            {groups!.map((g) => (
              <MarketBlock key={g.market} group={g} indices={indices.data} />
            ))}
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Index prices from Yahoo Finance (unofficial), updated daily. Past returns say nothing
          about future ones. Not investment advice.
        </p>
      </CardContent>
    </Card>
  );
}

function MarketBlock({ group, indices }: { group: BenchmarkGroup; indices: IndexCloses }) {
  const f = useFormat();
  const p = group.portfolio;
  const pct = (r: number) => f.percent(r, { signed: true, decimals: 1 });
  const id = `bench-${group.market}`;

  return (
    <section aria-labelledby={id} className="min-w-0">
      <h3 id={id} className="text-sm font-medium">
        {MARKET_TITLE[group.market]}
      </h3>
      {p.rate === null ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {p.reason === 'TOO_SHORT'
            ? 'Appears once your first purchase is 30 days old.'
            : p.reason === 'NOT_COMPUTABLE'
              ? 'Your XIRR cannot be calculated for these cash flows.'
              : 'Needs holdings with purchase dates (holdings statements have none).'}
        </p>
      ) : (
        // data-volatile: returns age by the day (end-to-end screenshots mask them).
        <dl className="mt-2 divide-y text-sm" data-volatile>
          <div className="flex items-baseline justify-between gap-3 py-1.5">
            <dt>Your holdings</dt>
            <dd className="num font-semibold">{pct(p.rate)}</dd>
          </div>
          {group.benchmarks.map(({ id: bid, result }) => (
            <div key={bid} className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className="text-muted-foreground">{BENCHMARK_LABEL[bid]}</dt>
              <dd className="flex items-baseline gap-3 text-right">
                {result.ok ? (
                  <>
                    <Difference points={(p.rate! - result.rate) * 100} />
                    <span className="num w-16">{pct(result.rate)}</span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {missingReason(bid, result.reason, indices)}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {(p.excluded.noDates > 0 || p.excluded.unpriced > 0 || p.approximate) && (
        <p className="mt-1 text-xs text-muted-foreground">
          {p.approximate && 'Approximate: some purchase dates are only the first purchase. '}
          {p.excluded.noDates > 0 &&
            `Leaves out ${p.excluded.noDates} holding${p.excluded.noDates > 1 ? 's' : ''} without purchase dates. `}
          {p.excluded.unpriced > 0 && `Leaves out ${p.excluded.unpriced} without a price.`}
        </p>
      )}
    </section>
  );
}

/** "You are ahead/behind by N points": colour, arrow and words, never colour alone. */
function Difference({ points }: { points: number }) {
  const shown = Math.abs(points).toFixed(1);
  if (shown === '0.0') return <span className="text-xs text-muted-foreground">level</span>;
  const ahead = points > 0;
  const Icon = ahead ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn('inline-flex items-center gap-0.5 text-xs', ahead ? 'text-gain' : 'text-loss')}
    >
      <Icon aria-hidden className="size-3" />
      {shown} pts {ahead ? 'ahead' : 'behind'}
    </span>
  );
}

function missingReason(id: BenchmarkId, reason: string, indices: IndexCloses): string {
  if (reason === 'NOT_COMPUTABLE') return 'Cannot be calculated';
  if (!indices[id]) return 'Not loaded yet: appears after the next refresh';
  return 'Your first purchase is older than the stored index history';
}
