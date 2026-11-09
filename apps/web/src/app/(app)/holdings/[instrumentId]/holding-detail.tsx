'use client';

import { ASSET_CLASS_LABELS } from '@kosh/contracts';
import { groupByInstrument, MIN_XIRR_DAYS } from '@kosh/core';
import { ArrowLeft, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ErrorState } from '@/components/empty-state';
import { Change, Money } from '@/components/num';
import { formatAsOf, PriceBadge, sourceLabel } from '@/components/price-badge';
import { PriceDialog } from '@/components/price-dialog';
import { UnlistedPriceLinks } from '@/components/unlisted-price-links';
import { useFormat } from '@/components/providers/settings-provider';
import { TransactionDialog, TXN_LABELS } from '@/components/transaction-dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { type TxnRow, useBook, useTransactions } from '@/lib/hooks';

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="num text-lg font-semibold">{children}</dd>
    </div>
  );
}

function describeTxn(t: TxnRow, f: ReturnType<typeof useFormat>) {
  const currency = t.currency ?? 'INR';
  const m = (v: string) => f.money(v, { currency });
  const fx = currency === 'USD' && t.fxRate ? ` @ ₹${t.fxRate}/$` : '';
  switch (t.type) {
    case 'BUY':
    case 'SELL':
    case 'OPENING_BALANCE':
      return `${f.qty(t.qty ?? '0')} × ${m(t.price ?? '0')}${t.fees ? ` + ${m(t.fees)} charges` : ''}${fx}`;
    case 'DIVIDEND':
    case 'FEE':
      return `${m(t.amount ?? '0')}${fx}`;
    case 'SPLIT':
    case 'BONUS':
      return `${t.ratio?.from}:${t.ratio?.to}`;
  }
}

function ConfirmDelete({
  title,
  body,
  onConfirm,
  trigger,
}: {
  title: string;
  body: string;
  onConfirm: () => Promise<void>;
  trigger: React.ReactNode;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={onConfirm}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function HoldingDetail() {
  const { instrumentId: raw } = useParams<{ instrumentId: string }>();
  const instrumentId = decodeURIComponent(raw);
  const router = useRouter();
  const f = useFormat();
  const book = useBook();
  const txns = useTransactions(instrumentId);

  if (book.status === 'loading') return <Skeleton className="h-96" />;
  if (book.status === 'error') return <ErrorState message={book.error} />;

  const holdings = book.data
    ? Object.values(book.data.holdings).filter((h) => h.instrumentId === instrumentId)
    : [];
  const row = book.data
    ? groupByInstrument(book.data.holdings, { includeClosed: true }).find(
        (r) => r.instrumentId === instrumentId,
      )
    : undefined;

  if (!row || holdings.length === 0) {
    return (
      <div className="space-y-4">
        <ErrorState message="This holding doesn’t exist or was deleted." />
        <Button asChild variant="outline">
          <Link href="/holdings">Back to holdings</Link>
        </Button>
      </div>
    );
  }

  const single = holdings.length === 1 ? holdings[0]! : null;
  const xirrText =
    single?.xirr !== null && single?.xirr !== undefined
      ? f.percent(single.xirr, { signed: true })
      : single?.xirrNote === 'TOO_SHORT'
        ? `Shown after ${MIN_XIRR_DAYS} days`
        : single?.xirrNote === 'NO_FX'
          ? 'Needs USD/INR rate'
          : single?.xirrNote === 'NO_PRICE'
            ? 'Needs a price'
            : '—';
  const lots = holdings.flatMap((h) => h.lots);
  const closed = Number(row.qty) === 0;

  async function deleteTxn(id: string) {
    try {
      await api(`/api/v1/transactions/${id}`, { method: 'DELETE' });
      toast.success('Transaction deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete');
    }
  }

  async function deleteHolding() {
    try {
      await api(`/api/v1/holdings/${encodeURIComponent(instrumentId)}`, { method: 'DELETE' });
      toast.success(`${row!.name} deleted`);
      router.replace('/holdings');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete');
    }
  }

  return (
    <div className="space-y-6">
      <Link
        href="/holdings"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> Holdings
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{row.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">{ASSET_CLASS_LABELS[row.assetClass]}</Badge>
            {row.symbol && <span className="font-mono text-xs">{row.symbol}</span>}
            {closed && <Badge variant="outline">Fully sold</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <PriceDialog
            instrumentId={instrumentId}
            currency={row.currency}
            current={row.price?.source === 'manual' ? row.price.price : undefined}
            trigger={
              <Button variant="outline" size="sm">
                <Tag aria-hidden /> {row.price ? 'Update price' : 'Set price'}
              </Button>
            }
          />
          <TransactionDialog
            instrumentId={instrumentId}
            currency={row.currency}
            trigger={
              <Button size="sm">
                <Plus aria-hidden /> Add transaction
              </Button>
            }
          />
        </div>
      </div>

      <Card>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <Stat label="Quantity">{f.qty(row.qty)}</Stat>
            <Stat label="Average cost">
              {f.money(row.avgCostCcy, { currency: row.currency })}
              {row.currency === 'USD' && (
                <span className="block text-xs font-normal text-muted-foreground">
                  {f.money(row.avgCost)} at purchase FX
                </span>
              )}
            </Stat>
            <Stat label="Invested">
              <Money value={row.invested} />
            </Stat>
            <Stat label="Price">
              {row.price ? (
                <>
                  {f.money(row.price.price, { currency: row.price.currency })}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {sourceLabel(row.price.source)} · {formatAsOf(row.price.asOf)}
                    {row.fxRate ? ` · ₹${row.fxRate}/$` : ''}
                  </span>
                </>
              ) : (
                <span className="text-base text-warn">Not set</span>
              )}
              <PriceBadge status={row.priceStatus} price={row.price} className="mt-1" />
            </Stat>
            <Stat label="Current value">
              <Money value={row.value} />
            </Stat>
            <Stat label="Unrealised P&L">
              <Change
                value={row.unrealised}
                pct={row.unrealisedPct}
                className="text-base"
                stacked
              />
            </Stat>
            <Stat label="Day change">
              <Change value={row.dayChange} pct={row.dayChangePct} className="text-base" stacked />
            </Stat>
            <Stat label="Realised P&L">
              <Change value={row.realised} className="text-base" />
            </Stat>
            {row.currency === 'USD' && row.fxEffect !== null && (
              <Stat label="Of which: stock / currency">
                <span className="flex flex-col gap-0.5 text-base">
                  <Change value={row.stockEffect} showPct={false} className="text-sm" />
                  <Change value={row.fxEffect} showPct={false} className="text-sm" />
                </span>
              </Stat>
            )}
            <Stat label="XIRR (annualised)">
              <span
                className={
                  single?.xirr === null || single?.xirr === undefined
                    ? 'text-base font-normal text-muted-foreground'
                    : ''
                }
              >
                {xirrText}
              </span>
            </Stat>
          </dl>
          {row.price?.source === 'manual' && (
            <p className="mt-4 text-xs text-muted-foreground">
              Manual, indicative price entered by you.
            </p>
          )}
          {row.assetClass === 'UNLISTED' && (
            <div className="mt-4">
              <UnlistedPriceLinks />
            </div>
          )}
          {row.price?.source === 'yahoo-unofficial' && (
            <p className="mt-4 text-xs text-muted-foreground">
              From Yahoo Finance’s unofficial endpoint: may be delayed, and may stop working without
              notice.
            </p>
          )}
          {row.currency === 'USD' && row.fxEffect !== null && (
            <p className="mt-2 text-xs text-muted-foreground">
              P&amp;L in ₹ splits into the share-price move (at today’s rate) and the USD/INR move
              since each purchase.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
          <CardDescription>Edits keep the original entry in history.</CardDescription>
        </CardHeader>
        <CardContent>
          {txns.status === 'loading' ? (
            <Skeleton className="h-24" />
          ) : txns.status === 'error' ? (
            <ErrorState message={txns.error} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txns.data.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="num whitespace-nowrap">{t.tradeDate}</TableCell>
                    <TableCell>{TXN_LABELS[t.type]}</TableCell>
                    <TableCell className="num">
                      {describeTxn(t, f)}
                      {t.note && (
                        <span className="block text-xs text-muted-foreground">{t.note}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {t.accountId === 'manual' && (
                        <>
                          <TransactionDialog
                            instrumentId={instrumentId}
                            currency={row.currency}
                            existing={t}
                            trigger={
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Edit ${TXN_LABELS[t.type]} on ${t.tradeDate}`}
                              >
                                <Pencil aria-hidden />
                              </Button>
                            }
                          />
                          <ConfirmDelete
                            title="Delete this transaction?"
                            body="It is removed from your cost, P&L and returns. The entry stays in history."
                            onConfirm={() => deleteTxn(t.id)}
                            trigger={
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Delete ${TXN_LABELS[t.type]} on ${t.tradeDate}`}
                              >
                                <Trash2 aria-hidden />
                              </Button>
                            }
                          />
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {lots.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Open lots</CardTitle>
            <CardDescription>
              Units still held, oldest first. Sales use the oldest lots first (FIFO).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Acquired</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Cost per unit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lots.map((l, i) => (
                  <TableRow key={`${l.date}-${i}`} className="num">
                    <TableCell>{l.date}</TableCell>
                    <TableCell className="text-right">{f.qty(l.qty)}</TableCell>
                    <TableCell className="text-right">{f.money(l.unitCost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <ConfirmDelete
          title={`Delete ${row.name}?`}
          body="All its manual transactions are removed from your portfolio. They stay in history."
          onConfirm={deleteHolding}
          trigger={
            <Button variant="ghost" className="text-destructive hover:text-destructive">
              <Trash2 aria-hidden /> Delete holding
            </Button>
          }
        />
      </div>
    </div>
  );
}
