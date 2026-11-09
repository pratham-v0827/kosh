import 'server-only';
import {
  buildPositions,
  composeBook,
  type ComposedBook,
  type Currency,
  defaultCurrency,
  pickPrice,
  type InstrumentMeta,
  type LedgerError,
  type LedgerTxn,
  type PriceInfo,
} from '@kosh/core';
import type { InstrumentInput, TransactionInput } from '@kosh/contracts';
import {
  type DocumentReference,
  FieldValue,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { HttpError } from './http';
import { fxOnDate, manualToPriceInfo, quoteToPriceInfo, readMarket } from './market';

/**
 * Ledger service: the ONLY writer of a user's transactions, book, snapshots and series
 * (ADR-0004/0005/0006). Every change runs in a Firestore transaction: read the active ledger and
 * the cached market data, apply the change, rebuild positions with @kosh/core, reject the change
 * if the ledger would become invalid, then write everything together.
 */

export const MANUAL_ACCOUNT = 'manual';

type TxnStatus = 'active' | 'void' | 'replaced';
export type RefreshTrigger = 'manual' | 'scheduled' | 'import' | 'mcp';

interface TxnDoc extends Omit<LedgerTxn, 'id'> {
  status: TxnStatus;
  source: 'manual';
  note?: string;
  createdAt: FieldValue;
  replacedBy?: string;
  voidedAt?: FieldValue;
}

interface InstrumentDoc {
  name: string;
  assetClass: InstrumentMeta['assetClass'];
  symbol: string | null;
  /** Absent on M1-era docs, which were always INR. */
  currency?: Currency;
  exchange?: 'NSE' | 'BSE';
}

export const istToday = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);

const slug = (s: string) =>
  s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'holding';

/** NSE (the default) keeps the short id; BSE listings get their own id so both can coexist. */
export function instrumentIdFor(input: InstrumentInput): string {
  const key = input.symbol ?? slug(input.name);
  return input.assetClass === 'IN_EQUITY' && input.exchange === 'BSE'
    ? `IN_EQUITY:BSE:${key}`
    : `${input.assetClass}:${key}`;
}

/** Manual-refresh limits (docs/PLAN.md §6.2). Scheduled refreshes are exempt. */
export const REFRESH_COOLDOWN_MS = 5 * 60_000;
export const REFRESH_DAILY_LIMIT = 30;

/** Instrument currency, its transactions' FX rate (looked up for USD if not given). */
export async function resolveCurrency(
  uid: string,
  instrumentId: string,
  tradeDate: string,
  fxRate: string | undefined,
  assetClassForNew?: InstrumentMeta['assetClass'],
): Promise<{ currency: Currency; fxRate?: string }> {
  let currency: Currency;
  if (assetClassForNew) {
    currency = defaultCurrency(assetClassForNew);
  } else {
    const snap = await adminDb().doc(`users/${uid}/instruments/${instrumentId}`).get();
    if (!snap.exists) throw new HttpError(404, 'NOT_FOUND', 'Unknown holding');
    currency = (snap.get('currency') as Currency | undefined) ?? 'INR';
  }
  if (currency === 'INR') return { currency };
  const rate = fxRate ?? (await fxOnDate(tradeDate));
  if (!rate) {
    throw new HttpError(422, 'VALIDATION_FAILED', 'Could not find the USD→INR rate for that date', {
      fields: { fxRate: 'Enter the USD→INR rate you paid' },
    });
  }
  return { currency, fxRate: rate };
}

/** Turn a validated API transaction into ledger fields (drops undefined keys for Firestore). */
export function toLedgerFields(
  input: TransactionInput,
  accountId: string,
  money: { currency: Currency; fxRate?: string },
): Omit<LedgerTxn, 'id'> {
  const base = {
    accountId,
    instrumentId: input.instrumentId,
    type: input.type,
    tradeDate: input.tradeDate,
    currency: money.currency,
    ...(money.fxRate ? { fxRate: money.fxRate } : {}),
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
      // Corporate actions move no money, so no FX rate.
      return {
        accountId,
        instrumentId: input.instrumentId,
        type: input.type,
        tradeDate: input.tradeDate,
        currency: money.currency,
        ratio: input.ratio,
      };
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
  /** Manual prices in the instrument's currency. */
  manualPrices?: Record<string, { price: string; asOf: string }>;
  /** Record an immutable snapshot (a "refresh"). */
  snapshot?: { trigger: RefreshTrigger };
}

export interface LedgerResult {
  addedIds: string[];
  bookVersion: number;
  snapshotId?: string;
  totals: ComposedBook['totals'];
  skipped?: 'ALREADY_SNAPSHOTTED_TODAY' | 'NO_HOLDINGS';
}

export interface BookLastRefresh {
  at: FieldValue | Date;
  snapshotId: string;
  trigger: RefreshTrigger;
}

export async function applyLedgerChange(
  uid: string,
  change: LedgerChange,
  db: Firestore = adminDb(),
): Promise<LedgerResult> {
  const userRef = db.doc(`users/${uid}`);
  const txCol = userRef.collection('transactions');
  const bookRef = userRef.collection('book').doc('current');
  const accountRef = userRef.collection('accounts').doc(MANUAL_ACCOUNT);
  const metaRef = db.doc(`userMeta/${uid}`);
  const now = new Date();
  const today = istToday(now);

  return db.runTransaction(async (tx: Transaction) => {
    // ---------- reads (all before writes) ----------
    const [activeSnap, instSnap, priceSnap, bookSnap, accountSnap, metaSnap] = await Promise.all([
      tx.get(txCol.where('status', '==', 'active')),
      tx.get(userRef.collection('instruments')),
      tx.get(userRef.collection('manualPrices')),
      tx.get(bookRef),
      tx.get(accountRef),
      tx.get(metaRef),
    ]);

    const trigger = change.snapshot?.trigger;
    if (trigger === 'scheduled' && bookSnap.get('lastScheduledDay') === today) {
      return {
        addedIds: [],
        bookVersion: (bookSnap.get('version') as number) ?? 0,
        totals: bookSnap.get('totals'),
        skipped: 'ALREADY_SNAPSHOTTED_TODAY' as const,
      };
    }
    if (trigger === 'manual' || trigger === 'mcp')
      enforceRefreshLimits(metaSnap.data(), now, today);

    const active = new Map<string, LedgerTxn>();
    for (const d of activeSnap.docs)
      active.set(d.id, { ...stripMeta(d.data() as TxnDoc), id: d.id });

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
    for (const d of instSnap.docs) {
      const doc = d.data() as InstrumentDoc;
      instruments[d.id] = { id: d.id, ...doc, currency: doc.currency ?? 'INR' };
    }
    for (const i of change.instruments ?? []) instruments[i.id] ??= i;
    for (const t of active.values()) {
      if (!instruments[t.instrumentId]) throw new HttpError(404, 'NOT_FOUND', 'Unknown holding');
    }

    const market = await readMarket(tx, Object.keys(instruments), now);

    // ---------- validate + compose ----------
    const { positions, errors } = buildPositions([...active.values()]);
    if (errors.length > 0)
      throw new HttpError(422, 'LEDGER_INVALID', describe(errors[0]!), { errors });

    const manual: Record<
      string,
      { price: string; asOf: string; updatedAt?: Date | { toDate?: () => Date } }
    > = {};
    for (const d of priceSnap.docs) manual[d.id] = d.data() as { price: string; asOf: string };
    // prices set in THIS change were entered now
    for (const [id, p] of Object.entries(change.manualPrices ?? {}))
      manual[id] = { ...p, updatedAt: now };

    const prices: Record<string, PriceInfo> = {};
    for (const inst of Object.values(instruments)) {
      const q = market.quotes.get(inst.id);
      const m = manual[inst.id];
      const chosen = pickPrice(
        q ? quoteToPriceInfo(q, inst.assetClass, now) : null,
        m ? manualToPriceInfo(m, inst.assetClass, inst.currency ?? 'INR', now) : null,
      );
      if (chosen) prices[inst.id] = chosen;
    }

    const composed = composeBook(positions, instruments, prices, today, market.fx);
    if (trigger === 'scheduled' && composed.totals.holdingsCount === 0) {
      return {
        addedIds: [],
        bookVersion: (bookSnap.get('version') as number) ?? 0,
        totals: composed.totals,
        skipped: 'NO_HOLDINGS' as const,
      };
    }
    const version = ((bookSnap.get('version') as number | undefined) ?? 0) + 1;

    // ---------- writes ----------
    const ts = FieldValue.serverTimestamp();
    if (!accountSnap.exists && (change.add?.length ?? 0) > 0) {
      tx.set(accountRef, {
        source: 'manual',
        label: 'Manual',
        method: 'manual',
        status: 'ok',
        createdAt: ts,
      });
    }
    for (const i of change.instruments ?? []) {
      if (!instSnap.docs.some((d) => d.id === i.id)) {
        const doc: InstrumentDoc & { createdAt: FieldValue } = {
          name: i.name,
          assetClass: i.assetClass,
          symbol: i.symbol,
          currency: i.currency ?? defaultCurrency(i.assetClass),
          ...(i.assetClass === 'IN_EQUITY' ? { exchange: i.exchange ?? 'NSE' } : {}),
          createdAt: ts,
        };
        tx.set(userRef.collection('instruments').doc(i.id), doc);
        if (i.symbol && i.assetClass !== 'UNLISTED') {
          // Public identifiers only: lets the daily job price it without knowing who holds it.
          tx.set(
            db.doc(`trackedInstruments/${i.id}`),
            {
              assetClass: i.assetClass,
              symbol: i.symbol,
              ...(i.assetClass === 'IN_EQUITY' ? { exchange: i.exchange ?? 'NSE' } : {}),
            },
            { merge: true },
          );
        }
      }
    }
    for (const [id, p] of Object.entries(change.manualPrices ?? {})) {
      tx.set(
        userRef.collection('manualPrices').doc(id),
        {
          price: p.price,
          asOf: p.asOf,
          updatedAt: ts,
          history: FieldValue.arrayUnion({ price: p.price, asOf: p.asOf, at: now }),
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
        createdAt: ts,
        ...(a.note ? { note: a.note } : {}),
      };
      tx.set(newRefs[i]!, doc);
    });
    for (const r of change.retire ?? []) {
      tx.update(txCol.doc(r.id), {
        status: r.status,
        voidedAt: ts,
        ...(r.replacedBy !== undefined ? { replacedBy: newRefs[r.replacedBy]!.id } : {}),
      });
    }

    let snapshotId: string | undefined;
    let lastRefresh = bookSnap.get('lastRefresh') as BookLastRefresh | undefined;
    if (trigger) {
      const snapRef = userRef.collection('snapshots').doc();
      snapshotId = snapRef.id;
      tx.set(snapRef, buildSnapshot(composed, { trigger, bookVersion: version, today, at: now }));
      tx.set(
        userRef.collection('series').doc(today.slice(0, 4)),
        {
          d: {
            [today]: {
              v: Number(composed.totals.value),
              inv: Number(composed.totals.invested),
              rz: Number(composed.totals.realised),
              dv: Number(composed.totals.dividends),
              s: snapshotId,
              at: now,
            },
          },
        },
        { merge: true },
      );
      const sameDay = metaSnap.get('refreshDay') === today;
      tx.set(
        metaRef,
        {
          refreshCount: FieldValue.increment(1),
          lastRefreshAt: ts,
          ...(trigger === 'manual' || trigger === 'mcp'
            ? {
                refreshDay: today,
                refreshesToday: sameDay ? FieldValue.increment(1) : 1,
                lastManualRefreshAt: now,
              }
            : {}),
        },
        { merge: true },
      );
      tx.set(
        db.doc(`metrics/daily_${today}`),
        { day: today, refreshes: FieldValue.increment(1) },
        { merge: true },
      );
      lastRefresh = { at: now, snapshotId, trigger };
    }

    tx.set(bookRef, {
      version,
      updatedAt: ts,
      asOf: today,
      ...composed,
      ...(lastRefresh ? { lastRefresh } : {}),
      ...(trigger === 'scheduled'
        ? { lastScheduledDay: today }
        : bookSnap.get('lastScheduledDay')
          ? { lastScheduledDay: bookSnap.get('lastScheduledDay') }
          : {}),
    });

    return {
      addedIds: newRefs.map((r) => r.id),
      bookVersion: version,
      totals: composed.totals,
      ...(snapshotId ? { snapshotId } : {}),
    };
  });
}

function enforceRefreshLimits(meta: Record<string, unknown> | undefined, now: Date, today: string) {
  const last = meta?.lastManualRefreshAt as { toDate?: () => Date } | Date | undefined;
  const lastMs = last instanceof Date ? last.getTime() : last?.toDate?.().getTime();
  if (lastMs && now.getTime() - lastMs < REFRESH_COOLDOWN_MS) {
    const retryAfter = Math.ceil((REFRESH_COOLDOWN_MS - (now.getTime() - lastMs)) / 1000);
    throw new HttpError(
      429,
      'REFRESH_COOLDOWN',
      `You can refresh again in ${Math.ceil(retryAfter / 60)} min`,
      { retryAfter },
    );
  }
  if (meta?.refreshDay === today && Number(meta?.refreshesToday ?? 0) >= REFRESH_DAILY_LIMIT) {
    throw new HttpError(
      429,
      'REFRESH_DAILY_LIMIT',
      `Daily limit of ${REFRESH_DAILY_LIMIT} refreshes reached`,
      { retryAfter: 3600 },
    );
  }
}

/** Immutable record of one refresh. Rows are maps (Firestore cannot store nested arrays). */
function buildSnapshot(
  b: ComposedBook,
  m: { trigger: RefreshTrigger; bookVersion: number; today: string; at: Date },
) {
  const rows = Object.values(b.holdings)
    .filter((h) => Number(h.qty) > 0)
    .map((h) => ({
      k: h.key,
      i: h.instrumentId,
      n: h.name,
      c: h.assetClass,
      q: h.qty,
      inv: h.openCost,
      ...(h.price
        ? { p: h.price.price, cur: h.price.currency, src: h.price.source, a: h.price.asOf }
        : {}),
      st: h.priceStatus,
      v: h.value,
      dc: h.dayChange,
    }));
  return {
    createdAt: m.at,
    trigger: m.trigger,
    bookVersion: m.bookVersion,
    asOfDate: m.today,
    fx: b.fx ? { rate: b.fx.rate, asOf: b.fx.asOf, source: b.fx.source } : null,
    totals: b.totals,
    rows,
  };
}

function stripMeta(d: TxnDoc): Omit<LedgerTxn, 'id'> {
  const {
    accountId,
    instrumentId,
    type,
    tradeDate,
    qty,
    price,
    fees,
    amount,
    ratio,
    seq,
    currency,
    fxRate,
  } = d;
  return {
    accountId,
    instrumentId,
    type,
    tradeDate,
    qty,
    price,
    fees,
    amount,
    ratio,
    seq,
    currency,
    fxRate,
  };
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
