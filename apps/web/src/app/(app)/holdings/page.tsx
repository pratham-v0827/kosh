'use client';

import { ASSET_CLASS_LABELS } from '@kosh/contracts';
import {
  ASSET_CLASSES,
  type AssetClass,
  type ConsolidatedRow,
  groupByInstrument,
  type HoldingView,
  withCombinedXirr,
} from '@kosh/core';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, List, Plus } from 'lucide-react';
import Link from 'next/link';
import { Fragment, type ReactNode, useMemo, useState } from 'react';
import { accountLabel } from '@/components/dashboard/labels';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { type ColumnId, ColumnChooser, useColumns } from '@/components/holdings/columns';
import { XirrValue } from '@/components/holdings/xirr-value';
import { Change, Money } from '@/components/num';
import { PriceBadge } from '@/components/price-badge';
import { useFormat } from '@/components/providers/settings-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { cn } from '@/lib/utils';

type SortKey = 'name' | 'value' | 'invested' | 'pnl' | 'pnlPct' | 'xirr';
const num = (v: string | number | null) => (v === null ? Number.NEGATIVE_INFINITY : Number(v));
const SORTERS: Record<SortKey, (r: ConsolidatedRow) => number | string> = {
  name: (r) => r.name.toLowerCase(),
  value: (r) => num(r.value),
  invested: (r) => num(r.invested),
  pnl: (r) => num(r.unrealised),
  pnlPct: (r) => num(r.unrealisedPct),
  xirr: (r) => num(r.xirr.rate),
};
const ALL_BROKERS = 'ALL';
/** Optional columns before Value and P&L, and after them. */
const BEFORE: readonly ColumnId[] = ['qty', 'avgCost', 'price', 'invested'];
const AFTER: readonly ColumnId[] = ['day', 'xirr', 'weight', 'brokers'];

export default function HoldingsPage() {
  const book = useBook();
  const f = useFormat();
  const { shown, toggle } = useColumns();
  const [tab, setTab] = useState<'ALL' | AssetClass>('ALL');
  const [broker, setBroker] = useState<string>(ALL_BROKERS);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'value',
    dir: 'desc',
  });

  const data = book.status === 'ready' ? book.data : null;
  // Brokers with something still held, largest first.
  const brokers = useMemo(() => {
    const totals = new Map<string, number>();
    for (const h of Object.values(data?.holdings ?? {})) {
      if (Number(h.qty) > 0)
        totals.set(h.accountId, (totals.get(h.accountId) ?? 0) + Number(h.value ?? h.openCost));
    }
    return [...totals].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }, [data]);
  const activeBroker = brokers.includes(broker) ? broker : ALL_BROKERS;

  // One broker: only its positions, so every figure (weight too) is that broker's.
  const holdings = useMemo(() => {
    const all = data?.holdings ?? {};
    if (activeBroker === ALL_BROKERS) return all;
    return Object.fromEntries(Object.entries(all).filter(([, h]) => h.accountId === activeBroker));
  }, [data, activeBroker]);
  const all = useMemo(
    () => (data ? withCombinedXirr(groupByInstrument(holdings), holdings, data.asOf) : []),
    [data, holdings],
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
  if (brokers.length === 0) {
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
  const has = (c: ColumnId) => shown.has(c);
  const header = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => {
    const active = sort.key === key;
    return (
      <TableHead
        className={align === 'right' ? 'text-right' : undefined}
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
  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Optional cells of one line, for the columns before or after Value and P&L; `sub` lines are one account's share. */
  const optional = (
    group: readonly ColumnId[],
    cells: Partial<Record<ColumnId, ReactNode>>,
    sub = false,
  ): ReactNode[] =>
    group.filter(has).map((c) => (
      <TableCell
        key={c}
        className={cn(
          c === 'brokers' ? 'text-left' : 'text-right',
          sub && 'text-sm text-muted-foreground',
          c === 'weight' && 'text-muted-foreground',
        )}
      >
        {cells[c] ?? null}
      </TableCell>
    ));

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
          <div className="flex flex-wrap items-center gap-2">
            {brokers.length > 1 && (
              <Select value={activeBroker} onValueChange={setBroker}>
                <SelectTrigger aria-label="Broker" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_BROKERS}>All brokers</SelectItem>
                  {brokers.map((b) => (
                    <SelectItem key={b} value={b}>
                      {accountLabel(b)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Input
              type="search"
              aria-label="Search holdings"
              placeholder="Search name or symbol"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="min-w-0 flex-1 lg:w-56 lg:flex-none"
            />
            <div className="hidden lg:block">
              <ColumnChooser shown={shown} toggle={toggle} />
            </div>
          </div>
        </div>

        {/* One panel, re-filtered per tab, so every trigger controls a real tabpanel. */}
        <TabsContent value={tab}>
          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No holdings match.</p>
          ) : (
            <>
              {/* ≥ lg: table */}
              <div className="hidden overflow-x-auto rounded-xl border bg-card lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {header('name', 'Name', 'left')}
                      {has('qty') && <TableHead className="text-right">Qty</TableHead>}
                      {has('avgCost') && <TableHead className="text-right">Avg cost</TableHead>}
                      {has('price') && <TableHead className="text-right">Price</TableHead>}
                      {has('invested') && header('invested', 'Invested')}
                      {header('value', 'Value')}
                      {header('pnl', 'P&L')}
                      {has('day') && <TableHead className="text-right">Day</TableHead>}
                      {has('xirr') && header('xirr', 'XIRR')}
                      {has('weight') && <TableHead className="text-right">Weight</TableHead>}
                      {has('brokers') && <TableHead>Brokers</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const multi = r.accounts.length > 1;
                      const brokersHeld = new Set(r.accounts.map((a) => a.accountId)).size;
                      const expanded = multi && open.has(r.instrumentId);
                      const subId = `acc-${r.instrumentId}`;
                      const parts = r.positionKeys
                        .map((k) => holdings[k])
                        .filter((h): h is HoldingView => !!h && Number(h.qty) > 0)
                        .sort((a, b) => num(b.value ?? b.openCost) - num(a.value ?? a.openCost));
                      return (
                        <Fragment key={r.instrumentId}>
                          <TableRow className="num">
                            <TableCell className="max-w-64">
                              <div className="flex items-start gap-1">
                                {multi ? (
                                  <button
                                    type="button"
                                    aria-expanded={expanded}
                                    aria-controls={expanded ? subId : undefined}
                                    aria-label={`${expanded ? 'Hide' : 'Show'} the ${r.accounts.length} positions in ${r.name}`}
                                    onClick={() => toggleOpen(r.instrumentId)}
                                    className="-ml-1 mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-accent"
                                  >
                                    {expanded ? (
                                      <ChevronDown aria-hidden className="size-4" />
                                    ) : (
                                      <ChevronRight aria-hidden className="size-4" />
                                    )}
                                  </button>
                                ) : (
                                  <span aria-hidden className="-ml-1 w-6 shrink-0" />
                                )}
                                <div className="min-w-0">
                                  <Link
                                    href={`/holdings/${encodeURIComponent(r.instrumentId)}`}
                                    className="block min-h-6 truncate py-0.5 font-medium hover:underline"
                                  >
                                    {r.name}
                                  </Link>
                                  <span className="text-xs text-muted-foreground">
                                    {ASSET_CLASS_LABELS[r.assetClass]}
                                    {r.symbol ? ` · ${r.symbol}` : ''}
                                    {brokersHeld > 1 ? ` · ${brokersHeld} accounts` : ''}
                                    {r.instrumentIds.length > 1 ? ' · NSE + BSE' : ''}
                                  </span>
                                </div>
                              </div>
                            </TableCell>
                            {optional(BEFORE, {
                              qty: f.qty(r.qty),
                              avgCost: f.money(r.avgCostCcy, { currency: r.currency }),
                              price: (
                                <div className="flex flex-col items-end gap-0.5">
                                  {r.price &&
                                    f.money(r.price.price, { currency: r.price.currency })}
                                  <PriceBadge status={r.priceStatus} price={r.price} />
                                </div>
                              ),
                              invested: <Money value={r.invested} />,
                            })}
                            <TableCell className="text-right font-medium">
                              <Money value={r.value} />
                            </TableCell>
                            <TableCell className="text-right">
                              <Change value={r.unrealised} pct={r.unrealisedPct} stacked />
                            </TableCell>
                            {optional(AFTER, {
                              day: (
                                <Change value={r.dayChange} pct={r.dayChangePct} showPct={false} />
                              ),
                              xirr: (
                                <XirrValue
                                  rate={r.xirr.rate}
                                  why={r.xirr.reason}
                                  approximate={r.xirr.approximate}
                                />
                              ),
                              weight:
                                r.weight === null ? '—' : f.percent(r.weight, { decimals: 1 }),
                              brokers: (
                                <span className="text-sm">
                                  {r.accounts.map((a) => accountLabel(a.accountId)).join(', ')}
                                </span>
                              ),
                            })}
                          </TableRow>
                          {expanded &&
                            parts.map((h, i) => (
                              <TableRow
                                key={h.key}
                                id={i === 0 ? subId : undefined}
                                className="num bg-muted/40"
                              >
                                <TableCell className="pl-9 text-sm">
                                  {accountLabel(h.accountId)}
                                  {r.instrumentIds.length > 1 &&
                                    (h.instrumentId.startsWith('IN_EQUITY:BSE:')
                                      ? ' · BSE'
                                      : ' · NSE')}
                                </TableCell>
                                {optional(
                                  BEFORE,
                                  {
                                    qty: f.qty(h.qty),
                                    avgCost: f.money(h.avgCostCcy, { currency: h.currency }),
                                    invested: <Money value={h.openCost} />,
                                  },
                                  true,
                                )}
                                <TableCell className="text-right text-sm">
                                  <Money value={h.value} />
                                </TableCell>
                                <TableCell className="text-right text-sm">
                                  <Change value={h.unrealised} pct={h.unrealisedPct} stacked />
                                </TableCell>
                                {optional(
                                  AFTER,
                                  {
                                    day: (
                                      <Change
                                        value={h.dayChange}
                                        pct={h.dayChangePct}
                                        showPct={false}
                                      />
                                    ),
                                    xirr: (
                                      <XirrValue
                                        rate={h.xirr}
                                        why={h.xirrNote}
                                        approximate={h.dateQuality === 'approximate'}
                                      />
                                    ),
                                  },
                                  true,
                                )}
                              </TableRow>
                            ))}
                        </Fragment>
                      );
                    })}
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
                        {r.accounts.length > 1 && (
                          <p className="truncate text-xs text-muted-foreground">
                            {r.accounts.map((a) => accountLabel(a.accountId)).join(' · ')}
                          </p>
                        )}
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
