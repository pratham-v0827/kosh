'use client';

import type { BookTotals, FxInfo, HoldingView } from '@kosh/core';
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
