'use client';

import { ASSET_CLASS_LABELS } from '@kosh/contracts';
import { ASSET_CLASSES, type AssetClass, groupByInstrument, type InstrumentRow } from '@kosh/core';
import { ArrowDown, ArrowUp, ChevronRight, List, Plus } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { Change, Money } from '@/components/num';
import { PriceBadge } from '@/components/price-badge';
import { useFormat } from '@/components/providers/settings-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBook } from '@/lib/hooks';

type SortKey = 'name' | 'value' | 'invested' | 'pnl' | 'pnlPct';
const num = (v: string | number | null) => (v === null ? Number.NEGATIVE_INFINITY : Number(v));
const SORTERS: Record<SortKey, (r: InstrumentRow) => number | string> = {
  name: (r) => r.name.toLowerCase(),
  value: (r) => num(r.value),
  invested: (r) => num(r.invested),
  pnl: (r) => num(r.unrealised),
  pnlPct: (r) => num(r.unrealisedPct),
};

export default function HoldingsPage() {
  const book = useBook();
  const f = useFormat();
  const [tab, setTab] = useState<'ALL' | AssetClass>('ALL');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'value',
    dir: 'desc',
  });

  const all = useMemo(
    () => (book.status === 'ready' && book.data ? groupByInstrument(book.data.holdings) : []),
    [book],
  );
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = all.filter(
      (r) =>
        (tab === 'ALL' || r.assetClass === tab) &&
        (!needle ||
          r.name.toLowerCase().includes(needle) ||
          r.symbol?.toLowerCase().includes(needle)),
    );
    const get = SORTERS[sort.key];
    return filtered.sort((a, b) => {
      const x = get(a);
      const y = get(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return sort.dir === 'asc' ? c : -c;
    });
  }, [all, tab, q, sort]);

  if (book.status === 'loading') return <Skeleton className="h-96" />;
  if (book.status === 'error') return <ErrorState message={book.error} />;
  if (all.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Holdings</h1>
        <EmptyState
          icon={List}
          title="No holdings yet"
          action={
            <Button asChild>
              <Link href="/manual/new">
                <Plus aria-hidden /> Add a holding
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const counts = Object.fromEntries(
    ASSET_CLASSES.map((c) => [c, all.filter((r) => r.assetClass === c).length]),
  );
  const header = (
    key: SortKey,
    label: string,
    align: 'left' | 'right' = 'right',
    extra?: string,
  ) => {
    const active = sort.key === key;
    return (
      <TableHead
        className={
          [align === 'right' ? 'text-right' : '', extra ?? ''].join(' ').trim() || undefined
        }
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <button
          type="button"
          className="-mx-1 inline-flex min-h-6 min-w-6 items-center gap-1 rounded px-1 hover:text-foreground"
          onClick={() =>
            setSort((s) => ({
              key,
              dir: s.key === key && s.dir === 'desc' ? 'asc' : key === 'name' ? 'asc' : 'desc',
            }))
          }
        >
          {label}
          {active &&
            (sort.dir === 'asc' ? (
              <ArrowUp aria-hidden className="size-3" />
            ) : (
              <ArrowDown aria-hidden className="size-3" />
            ))}
        </button>
      </TableHead>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Holdings</h1>
        <Button asChild size="sm">
          <Link href="/manual/new">
            <Plus aria-hidden /> Add holding
          </Link>
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="gap-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* One row that scrolls sideways on phones, instead of wrapping over the search box. */}
          <div className="-mx-4 min-w-0 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0 lg:pb-0">
            <TabsList aria-label="Asset type" className="w-max justify-start">
              <TabsTrigger value="ALL">All ({all.length})</TabsTrigger>
              {ASSET_CLASSES.filter((c) => counts[c]).map((c) => (
                <TabsTrigger key={c} value={c}>
                  {ASSET_CLASS_LABELS[c]} ({counts[c]})
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <Input
            type="search"
            aria-label="Search holdings"
            placeholder="Search name or symbol"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="lg:w-64"
          />
        </div>

        {/* One panel, re-filtered per tab, so every trigger controls a real tabpanel. */}
        <TabsContent value={tab}>
          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No holdings match.</p>
          ) : (
            <>
              {/* ≥ lg: table */}
              <div className="hidden rounded-xl border bg-card lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {header('name', 'Name', 'left')}
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Avg cost</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      {header('invested', 'Invested', 'right', 'hidden xl:table-cell')}
                      {header('value', 'Value')}
                      {header('pnl', 'P&L')}
                      <TableHead className="text-right">Day</TableHead>
                      <TableHead className="hidden text-right xl:table-cell">Weight</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.instrumentId} className="num">
                        <TableCell className="max-w-64">
                          <Link
                            href={`/holdings/${encodeURIComponent(r.instrumentId)}`}
                            className="block min-h-6 truncate py-0.5 font-medium hover:underline"
                          >
                            {r.name}
                          </Link>
                          <span className="text-xs text-muted-foreground">
                            {ASSET_CLASS_LABELS[r.assetClass]}
                            {r.symbol ? ` · ${r.symbol}` : ''}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{f.qty(r.qty)}</TableCell>
                        <TableCell className="text-right">
                          {f.money(r.avgCostCcy, { currency: r.currency })}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-col items-end gap-0.5">
                            {r.price && f.money(r.price.price, { currency: r.price.currency })}
                            <PriceBadge status={r.priceStatus} price={r.price} />
                          </div>
                        </TableCell>
                        <TableCell className="hidden text-right xl:table-cell">
                          <Money value={r.invested} />
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          <Money value={r.value} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Change value={r.unrealised} pct={r.unrealisedPct} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Change value={r.dayChange} pct={r.dayChangePct} showPct={false} />
                        </TableCell>
                        <TableCell className="hidden text-right text-muted-foreground xl:table-cell">
                          {r.weight === null ? '—' : f.percent(r.weight, { decimals: 1 })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* < lg: cards */}
              <ul className="space-y-2 lg:hidden">
                {rows.map((r) => (
                  <li key={r.instrumentId}>
                    <Link
                      href={`/holdings/${encodeURIComponent(r.instrumentId)}`}
                      className="flex items-center gap-3 rounded-xl border bg-card p-4"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="truncate font-medium">{r.name}</p>
                        <PriceBadge status={r.priceStatus} price={r.price} plain />
                        <p className="num text-xs text-muted-foreground">
                          {f.qty(r.qty)} ×{' '}
                          {r.price
                            ? f.money(r.price.price, { currency: r.price.currency })
                            : 'no price'}
                        </p>
                      </div>
                      <div className="text-right">
                        <Money value={r.value ?? r.invested} className="font-medium" />
                        <div className="text-xs">
                          <Change
                            value={r.unrealised}
                            pct={r.unrealisedPct}
                            showPct={false}
                            className="text-xs"
                          />
                        </div>
                      </div>
                      <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
