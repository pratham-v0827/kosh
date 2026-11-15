'use client';

import { ASSET_CLASS_LABELS } from '@kosh/contracts';
import { type ChartRange, groupByInstrument, portfolioXirr } from '@kosh/core';
import { Info, PiggyBank, Plus } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AllocationCard } from '@/components/dashboard/allocation-card';
import { BenchmarkCard } from '@/components/dashboard/benchmark-card';
import { InsightsCard } from '@/components/dashboard/insights-card';

import { RangePicker, ValueChart } from '@/components/dashboard/value-chart';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { Change, Money } from '@/components/num';
import { sourceLabel } from '@/components/price-badge';
import { useFormat } from '@/components/providers/settings-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useBenchmarkIndices, useBook, useSeries } from '@/lib/hooks';

function Explain({ children }: { children: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        className="rounded-full text-muted-foreground"
        aria-label="How this is calculated"
      >
        <Info aria-hidden className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{children}</TooltipContent>
    </Tooltip>
  );
}

function Kpi({
  label,
  explain,
  children,
}: {
  label: string;
  explain: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-2 py-5">
      <CardHeader className="flex items-center gap-1.5 px-5">
        <CardDescription>{label}</CardDescription>
        <Explain>{explain}</Explain>
      </CardHeader>
      <CardContent className="px-5 text-2xl font-semibold tracking-tight">{children}</CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const book = useBook();
  const series = useSeries();
  const indices = useBenchmarkIndices();
  const f = useFormat();
  const [range, setRange] = useState<ChartRange>('3M');
  const holdings = book.status === 'ready' ? book.data?.holdings : undefined;
  const rows = useMemo(() => (holdings ? groupByInstrument(holdings) : []), [holdings]);

  if (book.status === 'loading') {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }
  if (book.status === 'error') return <ErrorState message={book.error} />;

  const data = book.data;
  if (!data || data.totals.holdingsCount === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <EmptyState
          icon={PiggyBank}
          title="Your ledger is empty"
          action={
            <Button asChild>
              <Link href="/manual/new">
                <Plus aria-hidden /> Add your first holding
              </Link>
            </Button>
          }
        >
          Start with an unlisted share or anything you track by hand. Broker, CAS and crypto imports
          are coming next.
        </EmptyState>
      </div>
    );
  }

  const t = data.totals;
  const xirr = portfolioXirr(data.holdings, data.asOf);
  // Where today's prices came from, for the badges under the headline figure.
  const sources = new Map<string, number>();
  for (const h of Object.values(data.holdings)) {
    if (Number(h.qty) > 0 && h.price)
      sources.set(h.price.source, (sources.get(h.price.source) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {f.view.currency === 'USD' && f.usdInr
              ? 'Values in US dollars, converted from rupees at today’s rate.'
              : 'Values in ₹.'}{' '}
            Prices update automatically from free sources; unlisted shares use the price you set.
            {data.fx && (
              <>
                {' '}
                USD at ₹{data.fx.rate} ({data.fx.asOf}, ECB reference).
              </>
            )}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/manual/new">
            <Plus aria-hidden /> Add holding
          </Link>
        </Button>
      </div>

      <section aria-label="Current value" className="space-y-2">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          Current value
          <Explain>Quantity × your latest price, for holdings that have a price.</Explain>
        </p>
        <p className="text-4xl font-semibold tracking-tight break-words sm:text-5xl">
          <Money value={t.value} />
        </p>
        {(t.unpricedCount > 0 || t.staleCount > 0) && (
          <p className="text-xs text-warn-fg">
            {t.unpricedCount > 0 &&
              `${t.unpricedCount} holding${t.unpricedCount > 1 ? 's' : ''} without a price not included. `}
            {t.staleCount > 0 &&
              `Includes ${t.staleCount} stale price${t.staleCount > 1 ? 's' : ''}.`}
          </p>
        )}
        {sources.size > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Price sources">
            {[...sources].map(([source, n]) => (
              <li
                key={source}
                className="inline-flex min-h-6 items-center rounded-full border px-2 text-xs text-muted-foreground"
              >
                {sourceLabel(source)} · {n}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Invested"
          explain="What you paid for the units you still hold, including charges (FIFO cost)."
        >
          <Money value={t.invested} />
        </Kpi>
        <Kpi label="Unrealised P&L" explain="Current value minus invested, for priced holdings.">
          <Change
            value={t.pricedInvested === '0' ? null : t.unrealised}
            pct={t.unrealisedPct}
            className="text-xl"
            stacked
          />
          {Number(t.realised) !== 0 && (
            <p className="mt-1 text-xs font-normal text-muted-foreground">
              Realised on sales: <Change value={t.realised} className="text-xs" showPct={false} />
            </p>
          )}
        </Kpi>
        <Kpi
          label="Day change"
          explain="Move since the previous close or NAV (24 hours for crypto), including the USD/INR move for US holdings. Holdings without a previous price are left out."
        >
          {t.dayChangeCount > 0 ? (
            <Change value={t.dayChange} pct={t.dayChangePct} className="text-xl" stacked />
          ) : (
            <>
              <span className="text-muted-foreground">—</span>
              <p className="mt-1 text-xs font-normal text-muted-foreground">
                Appears once a holding has a previous close or NAV.
              </p>
            </>
          )}
        </Kpi>
        <Kpi
          label="XIRR (annualised)"
          explain="Your yearly return, taking into account when you put money in and took it out. Holdings without purchase dates (from holdings statements) are left out."
        >
          {xirr.rate !== null ? (
            <span className="num">{f.percent(xirr.rate, { signed: true, decimals: 1 })}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          <p className="mt-1 text-xs font-normal text-muted-foreground">
            {xirr.reason === 'TOO_SHORT'
              ? 'Shown once your first purchase is 30 days old.'
              : xirr.reason === 'NO_DATA'
                ? 'Needs holdings with purchase dates.'
                : xirr.reason === 'NOT_COMPUTABLE'
                  ? 'Cannot be calculated for these cash flows.'
                  : xirr.approximate
                    ? 'Approximate: some purchase dates are only the first purchase.'
                    : 'From your dated purchases and sales.'}
            {xirr.excluded.noDates > 0 &&
              ` Leaves out ${xirr.excluded.noDates} holding${xirr.excluded.noDates > 1 ? 's' : ''} without purchase dates.`}
            {xirr.excluded.unpriced > 0 && ` Leaves out ${xirr.excluded.unpriced} without a price.`}
          </p>
        </Kpi>
      </div>

      <section aria-label="Value over time" className="space-y-3">
        <RangePicker value={range} onChange={setRange} />
        <ValueChart series={series} range={range} asOf={data.asOf} />
      </section>

      <BenchmarkCard holdings={data.holdings} asOf={data.asOf} indices={indices} />

      <div className="grid gap-4 lg:grid-cols-2">
        <AllocationCard holdings={data.holdings} />
        <InsightsCard rows={rows} holdings={data.holdings} asOf={data.asOf} />
      </div>

      <div className="grid gap-4">
        <Card className="min-w-0">
          <CardHeader className="flex items-center justify-between">
            <div>
              <CardTitle>Largest holdings</CardTitle>
              <CardDescription>By current value, or cost when there is no price.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/holdings">See all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {rows.slice(0, 5).map((r) => (
                <li key={r.instrumentId}>
                  <Link
                    href={`/holdings/${encodeURIComponent(r.instrumentId)}`}
                    className="flex items-center gap-3 rounded-md py-3 hover:bg-accent/50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {ASSET_CLASS_LABELS[r.assetClass]}
                      </p>
                    </div>
                    <div className="text-right">
                      <Money value={r.value ?? r.invested} className="font-medium" />
                      <div className="text-xs">
                        {r.value ? (
                          <Change
                            value={r.unrealised}
                            pct={r.unrealisedPct}
                            showPct={false}
                            className="text-xs"
                          />
                        ) : (
                          <span className="text-warn">No price</span>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
