'use client';

import {
  BENCHMARK_IDS,
  type BenchmarkId,
  type BookTotals,
  type FxInfo,
  type HoldingView,
  type IndexPoint,
} from '@kosh/core';
import { DEFAULT_SETTINGS, type Settings } from '@kosh/contracts';
import { collection, doc, onSnapshot, query, type Timestamp, where } from 'firebase/firestore';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { clientDb } from '@/lib/firebase/client';

export interface Book {
  version: number;
  asOf: string;
  updatedAt: Timestamp | null;
  holdings: Record<string, HoldingView>;
  totals: BookTotals;
  fx: FxInfo | null;
  lastRefresh?: {
    at: Timestamp;
    snapshotId: string;
    trigger: 'manual' | 'scheduled' | 'import' | 'mcp';
  };
}

export type Loadable<T> =
  { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: T };

/** Subscribe to one Firestore document owned by the signed-in user. */
function useOwnDoc<T>(path: (uid: string) => string, fallback: T | null): Loadable<T | null> {
  const { user } = useAuth();
  const [state, setState] = useState<Loadable<T | null>>({ status: 'loading' });
  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      doc(clientDb(), path(uid)),
      (snap) => setState({ status: 'ready', data: snap.exists() ? (snap.data() as T) : fallback }),
      (e) => setState({ status: 'error', error: e.message }),
    );
    // path is a stable inline function per call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);
  return uid ? state : { status: 'loading' };
}

/** The user's book (holdings + totals). `data` is null before the first holding is added. */
export const useBook = () => useOwnDoc<Book>((uid) => `users/${uid}/book/current`, null);

/** The user's settings, kept in sync with the theme. */
export function useSettings(): Loadable<Settings> {
  const doc = useOwnDoc<{ settings: Settings }>((uid) => `users/${uid}`, null);
  const { setTheme } = useTheme();
  const theme = doc.status === 'ready' ? doc.data?.settings.theme : undefined;
  useEffect(() => {
    if (theme) setTheme(theme);
  }, [theme, setTheme]);
  if (doc.status !== 'ready') return doc;
  return { status: 'ready', data: { ...DEFAULT_SETTINGS, ...doc.data?.settings } };
}

export interface TxnRow {
  id: string;
  accountId: string;
  instrumentId: string;
  type: 'BUY' | 'SELL' | 'DIVIDEND' | 'FEE' | 'SPLIT' | 'BONUS' | 'OPENING_BALANCE';
  tradeDate: string;
  qty?: string;
  price?: string;
  fees?: string;
  amount?: string;
  ratio?: { from: number; to: number };
  currency?: 'INR' | 'USD';
  fxRate?: string;
  note?: string;
  seq?: number;
}

/** Active transactions for one instrument, newest first. */
export function useTransactions(instrumentId: string): Loadable<TxnRow[]> {
  const { user } = useAuth();
  const [state, setState] = useState<Loadable<TxnRow[]>>({ status: 'loading' });
  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return;
    // Equality-only filters need no composite index; ordering is done client-side.
    const q = query(
      collection(clientDb(), `users/${uid}/transactions`),
      where('status', '==', 'active'),
      where('instrumentId', '==', instrumentId),
    );
    return onSnapshot(
      q,
      (snap) =>
        setState({
          status: 'ready',
          data: snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<TxnRow, 'id'>) }))
            .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate) || (b.seq ?? 0) - (a.seq ?? 0)),
        }),
      (e) => setState({ status: 'error', error: e.message }),
    );
  }, [uid, instrumentId]);
  return state;
}

export interface SeriesPointView {
  /** YYYY-MM-DD */
  date: string;
  value: number;
  invested: number;
}

/**
 * The user's daily value history, from one `series/{year}` document per year (written by every
 * refresh and by the daily job). Sorted by date.
 */
export function useSeries(): Loadable<SeriesPointView[]> {
  const { user } = useAuth();
  const [state, setState] = useState<Loadable<SeriesPointView[]>>({ status: 'loading' });
  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      collection(clientDb(), `users/${uid}/series`),
      (snap) => {
        const points: SeriesPointView[] = [];
        for (const d of snap.docs) {
          const days = (d.get('d') ?? {}) as Record<string, { v?: number; inv?: number }>;
          for (const [date, p] of Object.entries(days)) {
            if (typeof p?.v === 'number' && typeof p?.inv === 'number') {
              points.push({ date, value: p.v, invested: p.inv });
            }
          }
        }
        points.sort((a, b) => a.date.localeCompare(b.date));
        setState({ status: 'ready', data: points });
      },
      (e) => setState({ status: 'error', error: e.message }),
    );
  }, [uid]);
  return uid ? state : { status: 'loading' };
}

export type IndexCloses = Partial<Record<BenchmarkId, IndexPoint[]>>;

/**
 * Daily closes of the benchmark indices (shared market data, `indices/{id}/years/{yyyy}`), oldest
 * first. Ready once every index has answered; an index with no data yet is simply missing.
 */
export function useBenchmarkIndices(): Loadable<IndexCloses> {
  const { user } = useAuth();
  const [state, setState] = useState<Loadable<IndexCloses>>({ status: 'loading' });
  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return;
    const data: IndexCloses = {};
    const answered = new Set<BenchmarkId>();
    const unsubs = BENCHMARK_IDS.map((id) =>
      onSnapshot(
        collection(clientDb(), `indices/${id}/years`),
        (snap) => {
          const points: IndexPoint[] = [];
          for (const d of snap.docs) {
            const days = (d.get('d') ?? {}) as Record<string, unknown>;
            for (const [date, close] of Object.entries(days)) {
              if (typeof close === 'number' && close > 0) points.push({ date, close });
            }
          }
          points.sort((a, b) => a.date.localeCompare(b.date));
          if (points.length > 0) data[id] = points;
          else delete data[id];
          answered.add(id);
          if (answered.size === BENCHMARK_IDS.length)
            setState({ status: 'ready', data: { ...data } });
        },
        (e) => setState({ status: 'error', error: e.message }),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [uid]);
  return uid ? state : { status: 'loading' };
}
