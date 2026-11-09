'use client';

import type { BookTotals } from '@kosh/core';
import { collection, limit, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore';
import { History } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { Change, Money } from '@/components/num';
import { useAuth } from '@/components/providers/auth-provider';
import { Badge } from '@/components/ui/badge';
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
import { clientDb } from '@/lib/firebase/client';

interface SnapshotRow {
  id: string;
  createdAt: Timestamp;
  trigger: 'manual' | 'scheduled' | 'import' | 'mcp';
  totals: BookTotals;
  fx: { rate: string; asOf: string } | null;
}

const TRIGGER: Record<SnapshotRow['trigger'], string> = {
  manual: 'You',
  scheduled: 'Daily',
  import: 'Import',
  mcp: 'Claude',
};

const fmt = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);

export default function HistoryPage() {
  const { user } = useAuth();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; error: string }
    | { status: 'ready'; rows: SnapshotRow[] }
  >({ status: 'loading' });

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(clientDb(), `users/${user.uid}/snapshots`),
      orderBy('createdAt', 'desc'),
      limit(60),
    );
    return onSnapshot(
      q,
      (s) =>
        setState({
          status: 'ready',
          rows: s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SnapshotRow, 'id'>) })),
        }),
      (e) => setState({ status: 'error', error: e.message }),
    );
  }, [user]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Refresh history</h1>
        <p className="text-sm text-muted-foreground">
          Every refresh is recorded and never changed. Kosh also takes one automatic snapshot each
          morning.
        </p>
      </div>

      {state.status === 'loading' ? (
        <Skeleton className="h-64" />
      ) : state.status === 'error' ? (
        <ErrorState message={state.error} />
      ) : state.rows.length === 0 ? (
        <EmptyState icon={History} title="No refreshes yet">
          Use Refresh in the header to record your first snapshot.
        </EmptyState>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Snapshots</CardTitle>
            <CardDescription>Latest 60. Change is against the previous snapshot.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When (IST)</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">Day change</TableHead>
                  <TableHead className="text-right">USD/INR</TableHead>
                  <TableHead className="text-right">Prices</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.rows.map((r, i) => {
                  const prev = state.rows[i + 1];
                  const delta = prev ? Number(r.totals.value) - Number(prev.totals.value) : null;
                  return (
                    <TableRow key={r.id} className="num">
                      <TableCell className="whitespace-nowrap">
                        {fmt(r.createdAt.toDate())}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{TRIGGER[r.trigger]}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        <Money value={r.totals.value} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Change value={delta} showPct={false} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Change value={r.totals.dayChange} pct={r.totals.dayChangePct} />
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {r.fx ? `₹${r.fx.rate}` : '—'}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {r.totals.staleCount > 0 && (
                          <span className="text-warn">{r.totals.staleCount} stale · </span>
                        )}
                        {r.totals.unpricedCount > 0
                          ? `${r.totals.unpricedCount} unpriced`
                          : 'all priced'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
