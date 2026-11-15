'use client';

import {
  type AllocationBy,
  allocation,
  type HoldingView,
  MARKET_CAP_LIST,
  marketCapOf,
} from '@kosh/core';
import { useMemo, useState } from 'react';
import { useFormat } from '@/components/providers/settings-provider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { sliceLabel } from './labels';

const GROUPINGS: { by: AllocationBy; label: string }[] = [
  { by: 'assetClass', label: 'Asset type' },
  { by: 'account', label: 'Broker' },
  { by: 'geography', label: 'Country' },
  { by: 'instrumentType', label: 'Kind' },
  { by: 'marketCap', label: 'Market cap' },
];

const listDate = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
}).format(new Date(`${MARKET_CAP_LIST.asOf}T00:00:00Z`));

/**
 * Part-to-whole as ranked horizontal bars (one hue, largest first, one shared baseline): easier to
 * compare than slices of a donut. Every figure is printed beside its bar, so nothing depends on
 * colour or hovering.
 */
export function AllocationCard({ holdings }: { holdings: Record<string, HoldingView> }) {
  const f = useFormat();
  const [by, setBy] = useState<AllocationBy>('assetClass');
  const slices = useMemo(
    () => allocation(holdings, by, { marketCap: marketCapOf }),
    [holdings, by],
  );
  const anyPriced = slices.some((s) => s.valueWeight !== null);
  const unpriced = slices.reduce((n, s) => n + s.unpriced, 0);

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Allocation</CardTitle>
        <CardDescription>
          {anyPriced ? 'Share of current value' : 'Share of the amount invested (no prices yet)'}
          {by === 'marketCap' ? ', Indian shares only.' : '.'}
        </CardDescription>
        <div role="radiogroup" aria-label="Group by" className="mt-2 flex flex-wrap gap-1">
          {GROUPINGS.map((g) => (
            <button
              key={g.by}
              type="button"
              role="radio"
              aria-checked={by === g.by}
              onClick={() => setBy(g.by)}
              className={cn(
                'min-h-8 rounded-md border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
                by === g.by && 'border-primary bg-accent text-accent-foreground',
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {slices.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {by === 'marketCap'
              ? 'No Indian shares to group by market cap.'
              : 'No open holdings to show.'}
          </p>
        )}
        <ul className="space-y-3">
          {slices.map((s) => {
            const share = anyPriced ? (s.valueWeight ?? 0) : s.costWeight;
            return (
              <li key={s.key}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{sliceLabel(by, s.key)}</span>
                  <span className="flex shrink-0 items-baseline gap-3">
                    <span className="num text-muted-foreground">
                      {f.money(anyPriced ? s.value : s.invested, { compact: true })}
                    </span>
                    <span className="num w-14 text-right font-medium">
                      {f.percent(share, { decimals: 1 })}
                    </span>
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-muted" aria-hidden>
                  <div
                    className="h-2 rounded-full bg-chart-1"
                    style={{ width: `${Math.max(share * 100, share > 0 ? 1 : 0)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        {anyPriced && unpriced > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {unpriced} holding{unpriced === 1 ? '' : 's'} without a price{' '}
            {unpriced === 1 ? 'is' : 'are'} not in these shares.
          </p>
        )}
        {by === 'marketCap' && slices.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            From AMFI’s list for the six months to {listDate}: the 100 largest companies are large
            cap, the next 150 mid cap, and every other share small cap, including ones listed since.
            ETFs and funds are left out.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
