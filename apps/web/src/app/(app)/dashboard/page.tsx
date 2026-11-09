'use client';

import { ASSET_CLASS_LABELS } from '@kosh/contracts';
import { ASSET_CLASSES, groupByInstrument } from '@kosh/core';
import { Info, PiggyBank, Plus } from 'lucide-react';
import Link from 'next/link';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { Change, Money } from '@/components/num';
import { useFormat } from '@/components/providers/settings-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useBook } from '@/lib/hooks';

const CLASS_COLOR: Record<(typeof ASSET_CLASSES)[number], string> = {
  IN_EQUITY: 'bg-chart-1',
  MUTUAL_FUND: 'bg-chart-2',
  US_EQUITY: 'bg-chart-4',
  CRYPTO: 'bg-chart-3',
  UNLISTED: 'bg-chart-5',
};

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
  const f = useFormat();

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
  const rows = groupByInstrument(data.holdings);
  const allocation = ASSET_CLASSES.map((c) => ({ c, ...t.byAssetClass[c] }))
    .filter((a) => a.count > 0)
    .map((a) => ({
      ...a,
      pct: Number(t.invested) > 0 ? Number(a.invested) / Number(t.invested) : 0,
    }))
    .sort((a, b) => b.pct - a.pct);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Prices are manual for now. Live prices and “Last refreshed” arrive with the price
            engine.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/manual/new">
            <Plus aria-hidden /> Add holding
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Current value"
          explain="Quantity × your latest price, for holdings that have a price."
        >
          <Money value={t.value} />
          {t.unpricedCount > 0 && (
            <p className="mt-1 text-xs font-normal text-warn">
              {t.unpricedCount} holding{t.unpricedCount > 1 ? 's' : ''} without a price not included
            </p>
          )}
        </Kpi>
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
        </Kpi>
        <Kpi
          label="Realised P&L"
          explain="Profit or loss already booked on sales, matched first-in-first-out."
        >
          <Change value={t.realised} className="text-xl" />
        </Kpi>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Allocation by cost</CardTitle>
            <CardDescription>Share of the amount invested in each asset type.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
              {allocation.map((a) => (
                <div key={a.c} className={CLASS_COLOR[a.c]} style={{ width: `${a.pct * 100}%` }} />
              ))}
            </div>
            <ul className="space-y-2">
              {allocation.map((a) => (
                <li key={a.c} className="flex items-center gap-3 text-sm">
                  <span
                    aria-hidden
                    className={`size-2.5 shrink-0 rounded-full ${CLASS_COLOR[a.c]}`}
                  />
                  <span className="flex-1">{ASSET_CLASS_LABELS[a.c]}</span>
                  <span className="num text-muted-foreground">
                    {f.money(a.invested, { compact: true })}
                  </span>
                  <span className="num w-14 text-right font-medium">
                    {f.percent(a.pct, { decimals: 1 })}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
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
