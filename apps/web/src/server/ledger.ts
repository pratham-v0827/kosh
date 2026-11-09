import 'server-only';
import {
  buildPositions,
  composeBook,
  type InstrumentMeta,
  type LedgerError,
  type LedgerTxn,
  type PriceInfo,
} from '@kosh/core';
import type { InstrumentInput, TransactionInput } from '@kosh/contracts';
import { type DocumentReference, FieldValue, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { HttpError } from './http';

/**
 * Ledger service: the ONLY writer of a user's transactions and book (ADR-0004/0005).
 * Every change runs in a Firestore transaction: read the active ledger, apply the change,
 * rebuild positions with @kosh/core, reject if the ledger would become invalid, then write
 * the transactions and the recomputed book together.
 */

export const MANUAL_ACCOUNT = 'manual';

type TxnStatus = 'active' | 'void' | 'replaced';

interface TxnDoc extends Omit<LedgerTxn, 'id'> {
  status: TxnStatus;
  source: 'manual';
  note?: string;
  createdAt: FieldValue;
  replacedBy?: string;
  voidedAt?: FieldValue;
}

export const istToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

const slug = (s: string) =>
  s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'holding';

export function instrumentIdFor(input: InstrumentInput): string {
  return `${input.assetClass}:${input.symbol ?? slug(input.name)}`;
}

/** Turn a validated API transaction into ledger fields (drops undefined keys for Firestore). */
export function toLedgerFields(input: TransactionInput, accountId: string): Omit<LedgerTxn, 'id'> {
  const base = {
    accountId,
    instrumentId: input.instrumentId,
    type: input.type,
    tradeDate: input.tradeDate,
  };
  switch (input.type) {
    case 'BUY':
    case 'SELL':
      return {
        ...base,
        qty: input.qty,
        price: input.price,
        ...(input.fees ? { fees: input.fees } : {}),
      };
    case 'DIVIDEND':
    case 'FEE':
      return { ...base, amount: input.amount };
    case 'SPLIT':
    case 'BONUS':
      return { ...base, ratio: input.ratio };
  }
}

function describe(error: LedgerError): string {
  switch (error.code) {
    case 'SELL_EXCEEDS_HOLDING':
      return `${error.message}. Add the earlier purchase first, or reduce the quantity.`;
    case 'NO_HOLDING_FOR_ACTION':
      return `${error.message}, so a split or bonus cannot apply.`;
    default:
      return error.message;
  }
}

export interface LedgerChange {
  add?: { fields: Omit<LedgerTxn, 'id' | 'seq'>; note?: string }[];
  /** Transactions to retire. `replacedBy` is the index into `add` of the replacement, if any. */
  retire?: { id: string; status: Exclude<TxnStatus, 'active'>; replacedBy?: number }[];
  instruments?: InstrumentMeta[];
  prices?: Record<string, PriceInfo>;
}

export interface LedgerResult {
  addedIds: string[];
  bookVersion: number;
}

export async function applyLedgerChange(uid: string, change: LedgerChange): Promise<LedgerResult> {
  const db = adminDb();
  const userRef = db.doc(`users/${uid}`);
  const txCol = userRef.collection('transactions');
  const bookRef = userRef.collection('book').doc('current');
  const accountRef = userRef.collection('accounts').doc(MANUAL_ACCOUNT);

  return db.runTransaction(async (tx: Transaction) => {
    // ---------- reads (all before writes) ----------
    const [activeSnap, instSnap, priceSnap, bookSnap, accountSnap] = await Promise.all([
      tx.get(txCol.where('status', '==', 'active')),
      tx.get(userRef.collection('instruments')),
      tx.get(userRef.collection('manualPrices')),
      tx.get(bookRef),
      tx.get(accountRef),
    ]);

    const active = new Map<string, LedgerTxn>();
    for (const d of activeSnap.docs) {
      const data = d.data() as TxnDoc;
      active.set(d.id, { ...stripMeta(data), id: d.id });
    }

    for (const r of change.retire ?? []) {
      const existing = active.get(r.id);
      if (!existing)
        throw new HttpError(404, 'NOT_FOUND', 'Transaction not found or already removed');
      if (existing.accountId !== MANUAL_ACCOUNT) {
        throw new HttpError(
          409,
          'NOT_EDITABLE',
          'Imported transactions are managed by their import',
        );
      }
      active.delete(r.id);
    }

    const seqBase = Date.now();
    const newRefs: DocumentReference[] = (change.add ?? []).map(() => txCol.doc());
    (change.add ?? []).forEach((a, i) => {
      active.set(newRefs[i]!.id, { ...a.fields, id: newRefs[i]!.id, seq: seqBase + i });
    });

    const instruments: Record<string, InstrumentMeta> = {};
    for (const d of instSnap.docs)
      instruments[d.id] = { id: d.id, ...(d.data() as Omit<InstrumentMeta, 'id'>) };
    for (const i of change.instruments ?? []) instruments[i.id] ??= i;

    for (const t of active.values()) {
      if (!instruments[t.instrumentId]) throw new HttpError(404, 'NOT_FOUND', 'Unknown holding');
    }

    const prices: Record<string, PriceInfo> = {};
    for (const d of priceSnap.docs) {
      const p = d.data() as { price: string; asOf: string };
      prices[d.id] = { price: p.price, asOf: p.asOf, source: 'manual' };
    }
    Object.assign(prices, change.prices ?? {});

    // ---------- validate + compose ----------
    const { positions, errors } = buildPositions([...active.values()]);
    if (errors.length > 0) {
      throw new HttpError(422, 'LEDGER_INVALID', describe(errors[0]!), { errors });
    }
    const asOf = istToday();
    const composed = composeBook(positions, instruments, prices, asOf);
    const version = ((bookSnap.get('version') as number | undefined) ?? 0) + 1;

    // ---------- writes ----------
    const now = FieldValue.serverTimestamp();
    if (!accountSnap.exists) {
      tx.set(accountRef, {
        source: 'manual',
        label: 'Manual',
        method: 'manual',
        status: 'ok',
        createdAt: now,
      });
    }
    for (const i of change.instruments ?? []) {
      if (!instSnap.docs.some((d) => d.id === i.id)) {
        tx.set(userRef.collection('instruments').doc(i.id), {
          name: i.name,
          assetClass: i.assetClass,
          symbol: i.symbol,
          createdAt: now,
        });
      }
    }
    for (const [id, p] of Object.entries(change.prices ?? {})) {
      tx.set(
        userRef.collection('manualPrices').doc(id),
        {
          price: p.price,
          asOf: p.asOf,
          updatedAt: now,
          history: FieldValue.arrayUnion({ price: p.price, asOf: p.asOf, at: new Date() }),
        },
        { merge: true },
      );
    }
    (change.add ?? []).forEach((a, i) => {
      const doc: TxnDoc = {
        ...a.fields,
        seq: seqBase + i,
        status: 'active',
        source: 'manual',
        createdAt: now,
        ...(a.note ? { note: a.note } : {}),
      };
      tx.set(newRefs[i]!, doc);
    });
    for (const r of change.retire ?? []) {
      tx.update(txCol.doc(r.id), {
        status: r.status,
        voidedAt: now,
        ...(r.replacedBy !== undefined ? { replacedBy: newRefs[r.replacedBy]!.id } : {}),
      });
    }
    tx.set(bookRef, { version, updatedAt: now, asOf, ...composed });

    return { addedIds: newRefs.map((r) => r.id), bookVersion: version };
  });
}

function stripMeta(d: TxnDoc): Omit<LedgerTxn, 'id'> {
  const { accountId, instrumentId, type, tradeDate, qty, price, fees, amount, ratio, seq } = d;
  return { accountId, instrumentId, type, tradeDate, qty, price, fees, amount, ratio, seq };
}

/** Load one active manual transaction (for edit/delete). */
export async function getActiveTxn(uid: string, id: string) {
  const snap = await adminDb().doc(`users/${uid}/transactions/${id}`).get();
  const data = snap.data() as TxnDoc | undefined;
  if (!snap.exists || !data || data.status !== 'active') {
    throw new HttpError(404, 'NOT_FOUND', 'Transaction not found or already removed');
  }
  return { id, ...data };
}

/** IDs of all active manual transactions for an instrument. */
export async function activeTxnIdsFor(uid: string, instrumentId: string): Promise<string[]> {
  const snap = await adminDb()
    .collection(`users/${uid}/transactions`)
    .where('status', '==', 'active')
    .where('instrumentId', '==', instrumentId)
    .get();
  return snap.docs.filter((d) => d.get('accountId') === MANUAL_ACCOUNT).map((d) => d.id);
}
