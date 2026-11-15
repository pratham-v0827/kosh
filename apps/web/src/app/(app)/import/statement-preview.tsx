'use client';

import { AlertTriangle, CheckCircle2, CircleSlash, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useFormat } from '@/components/providers/settings-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';

// Shapes written by the server (apps/web/src/server/statement-imports.ts).
export interface StatementRow {
  line: number;
  status: 'added' | 'changed' | 'unchanged';
  instrumentId: string;
  instrumentType: 'STOCK' | 'ETF';
  name: string;
  symbol?: string;
  exchange?: 'NSE' | 'BSE';
  isin?: string;
  unresolved: boolean;
  quantity: string;
  avgBuyPrice: string;
  investedAmount: string;
  currency: 'INR' | 'USD';
  tradeDate: string;
  dateQuality: 'approximate' | 'unknown';
  warnings: string[];
  previous?: { quantity: string; avgBuyPrice: string };
  fingerprint: string;
}
interface Check {
  id: string;
  label: string;
  status: 'ok' | 'warning' | 'not-available';
  detail: string;
  currency?: 'INR' | 'USD';
  fileTotal?: string;
  rowsTotal?: string;
  difference?: string;
}
export interface StatementDraft {
  id: string;
  kind: 'positions';
  parser: string;
  label: string;
  statementDate: string;
  counts: {
    total: number;
    added: number;
    changed: number;
    unchanged: number;
    removed: number;
    skipped: number;
    needsAttention: number;
    unresolved: number;
    newHoldings: number;
  };
  rows?: StatementRow[];
  removed?: {
    txnId: string;
    instrumentId: string;
    name: string;
    quantity: string;
    avgBuyPrice: string;
  }[];
  issues: { line: number; field?: string; message: string }[];
  issuesTruncated?: boolean;
  skipped?: { line: number; reason: string }[];
  reconciliation?: Check[];
  notes?: string[];
  olderThanCurrent?: boolean;
  removalsSuppressed?: boolean;
}

type Busy = 'upload' | 'confirm' | 'discard' | null;
const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const CHECK_ICON = {
  ok: <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-gain" />,
  warning: <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warn-fg" />,
  'not-available': (
    <CircleSlash aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
  ),
} as const;
const CHECK_WORD = { ok: 'Matches', warning: 'Check', 'not-available': 'Not available' } as const;

export function StatementPreview({
  draft,
  busy,
  setBusy,
}: {
  draft: StatementDraft;
  busy: Busy;
  setBusy: (b: Busy) => void;
}) {
  const f = useFormat();
  const rows = useMemo(() => draft.rows ?? [], [draft.rows]);
  const by = (status: StatementRow['status']) => rows.filter((r) => r.status === status);
  const added = by('added');
  const changed = by('changed');
  const unchanged = by('unchanged');
  const removed = draft.removed ?? [];
  const leftOut = draft.issues.length + (draft.skipped?.length ?? 0);
  const [tab, setTab] = useState(
    added.length ? 'added' : changed.length ? 'changed' : removed.length ? 'removed' : 'unchanged',
  );
  const [tickers, setTickers] = useState<
    Record<number, { symbol: string; exchange: 'NSE' | 'BSE' }>
  >({});
  const [acceptOlder, setAcceptOlder] = useState(false);
  const nothingToDo = added.length + changed.length + removed.length === 0;

  async function confirm() {
    setBusy('confirm');
    try {
      const mappings = Object.entries(tickers)
        .filter(([, m]) => m.symbol.trim() !== '')
        .map(([line, m]) => ({
          line: Number(line),
          symbol: m.symbol.trim(),
          exchange: m.exchange,
        }));
      const r = await api<{ added: number; changed: number; removed: number; unresolved: number }>(
        `/api/v1/imports/${draft.id}/confirm`,
        { method: 'POST', body: { acceptOlder, mappings } },
      );
      toast.success(
        `${draft.label}: ${plural(r.added, 'holding')} added, ${r.changed} updated, ${r.removed} removed` +
          (r.unresolved
            ? `. ${plural(r.unresolved, 'holding')} still ${r.unresolved === 1 ? 'needs' : 'need'} a ticker`
            : ''),
      );
    } catch (e) {
      toast.error(message(e, 'Could not import'));
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    setBusy('discard');
    try {
      await api(`/api/v1/imports/${draft.id}`, { method: 'DELETE' });
    } catch (e) {
      toast.error(message(e, 'Could not discard'));
    } finally {
      setBusy(null);
    }
  }

  const holdingCell = (r: StatementRow) => (
    <div className="min-w-48">
      <span className="font-medium">{r.name}</span>
      {r.instrumentType === 'ETF' && (
        <Badge variant="outline" className="ml-2">
          ETF
        </Badge>
      )}
      <div className="text-xs text-muted-foreground">
        {r.symbol ? `${r.symbol}${r.exchange ? ` · ${r.exchange}` : ''}` : r.isin}
      </div>
      {r.unresolved && r.status !== 'unchanged' && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`ticker-${r.line}`}>
            Ticker for {r.name}
          </label>
          <Input
            id={`ticker-${r.line}`}
            placeholder="Ticker, e.g. RELIANCE"
            className="h-8 w-44"
            value={tickers[r.line]?.symbol ?? ''}
            onChange={(e) =>
              setTickers((t) => ({
                ...t,
                [r.line]: {
                  symbol: e.target.value.toUpperCase(),
                  exchange: t[r.line]?.exchange ?? 'NSE',
                },
              }))
            }
          />
          <select
            aria-label={`Exchange for ${r.name}`}
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={tickers[r.line]?.exchange ?? 'NSE'}
            onChange={(e) =>
              setTickers((t) => ({
                ...t,
                [r.line]: {
                  symbol: t[r.line]?.symbol ?? '',
                  exchange: e.target.value as 'NSE' | 'BSE',
                },
              }))
            }
          >
            <option value="NSE">NSE</option>
            <option value="BSE">BSE</option>
          </select>
        </div>
      )}
      {r.warnings.map((w) => (
        <p key={w} className="mt-1 flex gap-1 text-xs text-warn-fg">
          <AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" /> {w}
        </p>
      ))}
    </div>
  );

  const table = (list: StatementRow[], showPrevious: boolean) => (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Row</TableHead>
            <TableHead>Holding</TableHead>
            <TableHead className="text-right">Quantity</TableHead>
            <TableHead className="text-right">Average price</TableHead>
            <TableHead className="text-right">Invested</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((r) => (
            <TableRow key={r.fingerprint}>
              <TableCell className="num text-muted-foreground">{r.line}</TableCell>
              <TableCell>{holdingCell(r)}</TableCell>
              <TableCell className="num text-right">
                {f.qty(r.quantity)}
                {showPrevious && r.previous && (
                  <div className="text-xs text-muted-foreground">
                    was {f.qty(r.previous.quantity)}
                  </div>
                )}
              </TableCell>
              <TableCell className="num text-right">
                {f.money(r.avgBuyPrice, { currency: r.currency })}
                {showPrevious && r.previous && (
                  <div className="text-xs text-muted-foreground">
                    was {f.money(r.previous.avgBuyPrice, { currency: r.currency })}
                  </div>
                )}
              </TableCell>
              <TableCell className="num text-right">
                {f.money(r.investedAmount, { currency: r.currency })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
  const none = (text: string) => <p className="text-sm text-muted-foreground">{text}</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Check before importing</CardTitle>
        <CardDescription>
          {draft.label} holdings as on <span className="num">{draft.statementDate}</span>, read as{' '}
          <span className="num">{draft.parser}</span>. Nothing has changed yet. Importing replaces
          your earlier {draft.label} statement holdings with these.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <section
          aria-label="Checks against the file's own totals"
          className="rounded-lg border p-3"
        >
          <h3 className="text-sm font-medium">Does the file add up?</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {(draft.reconciliation ?? []).map((c) => (
              <li key={c.id} className="flex gap-2">
                {CHECK_ICON[c.status]}
                <span>
                  <span className="font-medium">{c.label}:</span>{' '}
                  <span className="sr-only">{CHECK_WORD[c.status]}. </span>
                  {c.detail}
                  {c.fileTotal !== undefined && c.rowsTotal !== undefined && (
                    <span className="num block text-xs text-muted-foreground">
                      File {f.money(c.fileTotal, { currency: c.currency ?? 'INR' })} · rows{' '}
                      {f.money(c.rowsTotal, { currency: c.currency ?? 'INR' })} · difference{' '}
                      {f.money(c.difference ?? '0', { currency: c.currency ?? 'INR' })}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {(draft.notes ?? []).map((n) => (
            <p key={n} className="mt-2 text-sm text-muted-foreground">
              {n}
            </p>
          ))}
        </section>

        {draft.counts.unresolved > 0 && (
          <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
            {plural(draft.counts.unresolved, 'holding')} could not be matched to an exchange ticker.{' '}
            {draft.counts.unresolved === 1 ? 'It is' : 'They are'} still imported and valued at the
            statement’s closing price. Type the ticker below to get live prices, or do it later.
          </p>
        )}
        {draft.removalsSuppressed && (
          <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
            Some rows could not be read, so holdings missing from this file are kept as they are.
          </p>
        )}

        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <div className="-mx-1 overflow-x-auto px-1">
            <TabsList aria-label="What this statement changes" className="w-max justify-start">
              <TabsTrigger value="added">New ({added.length})</TabsTrigger>
              <TabsTrigger value="changed">Changed ({changed.length})</TabsTrigger>
              <TabsTrigger value="removed">Removed ({removed.length})</TabsTrigger>
              <TabsTrigger value="unchanged">Unchanged ({unchanged.length})</TabsTrigger>
              <TabsTrigger value="issues">Left out ({leftOut})</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="added">
            {added.length ? table(added, false) : none('No new holdings in this statement.')}
          </TabsContent>
          <TabsContent value="changed">
            {changed.length
              ? table(changed, true)
              : none('No holding has a different quantity or average price.')}
          </TabsContent>
          <TabsContent value="removed">
            {removed.length === 0 ? (
              none('No holding has disappeared from the statement.')
            ) : (
              <>
                <p className="mb-2 text-sm text-muted-foreground">
                  These are in Kosh but not in this statement, so they will be removed.
                </p>
                <ul className="space-y-1 text-sm">
                  {removed.map((r) => (
                    <li
                      key={r.txnId}
                      className="flex justify-between gap-4 border-b py-1 last:border-0"
                    >
                      <span className="font-medium">{r.name}</span>
                      <span className="num text-muted-foreground">{f.qty(r.quantity)} units</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </TabsContent>
          <TabsContent value="unchanged">
            {unchanged.length ? table(unchanged, false) : none('Nothing is unchanged.')}
          </TabsContent>
          <TabsContent value="issues">
            {leftOut === 0 ? (
              none('Every row was used.')
            ) : (
              <ul className="space-y-1 text-sm">
                {draft.issues.map((i, n) => (
                  <li key={`i-${i.line}-${n}`} className="flex gap-2">
                    <span className="num w-16 shrink-0 text-muted-foreground">Row {i.line}</span>
                    <span>
                      {i.field && <span className="font-medium">{i.field}: </span>}
                      {i.message}
                    </span>
                  </li>
                ))}
                {(draft.skipped ?? []).map((s) => (
                  <li key={`s-${s.line}`} className="flex gap-2">
                    <span className="num w-16 shrink-0 text-muted-foreground">Row {s.line}</span>
                    <span className="text-muted-foreground">Skipped: {s.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>

        {draft.olderThanCurrent && (
          <label className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={acceptOlder}
              onChange={(e) => setAcceptOlder(e.target.checked)}
            />
            <span>
              This statement is <strong>older</strong> than the one already imported. Tick to go
              back to it anyway.
            </span>
          </label>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          {nothingToDo && (
            <p className="mr-auto text-sm text-muted-foreground">
              Your {draft.label} holdings already match this statement.
            </p>
          )}
          <Button variant="outline" disabled={busy !== null} onClick={discard}>
            Discard
          </Button>
          <Button
            disabled={
              busy !== null || nothingToDo || (draft.olderThanCurrent === true && !acceptOlder)
            }
            onClick={confirm}
          >
            {busy === 'confirm' && <Loader2 aria-hidden className="animate-spin" />}
            Import {draft.label} holdings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
