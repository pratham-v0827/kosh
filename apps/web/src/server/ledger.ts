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
import type { TransactionInput } from '@kosh/contracts';
import {
  type DocumentReference,
  FieldValue,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { HttpError } from './http';
import {
  appendHistory,
  assertLedgerSize,
  type ImportRowCounters,
  nextImportRowCounters,
  nextWriteCounters,
  type WriteCounters,
} from './limits';
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

/** Where an imported transaction came from. Lets a re-import be recognised and an import undone. */
export interface ImportMeta {
  /** De-duplication key (see @kosh/parsers fingerprint). */
  fingerprint: string;
  importId: string;
  /** "kosh.csv@1.0.0" */
  parser: string;
  brokerRef?: string;
}

interface TxnDoc extends Omit<LedgerTxn, 'id'>, Partial<ImportMeta> {
  status: TxnStatus;
  source: 'manual' | 'import';
  note?: string;
  createdAt: FieldValue;
  replacedBy?: string;
  voidedAt?: FieldValue;
}

export type ImportStatus = 'draft' | 'confirmed' | 'undone';

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

export { instrumentIdFor } from './instrument-id';

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
  /** `importMeta` marks a row from a statement: rows whose fingerprint is already active are skipped. */
  add?: { fields: Omit<LedgerTxn, 'id' | 'seq'>; note?: string; importMeta?: ImportMeta }[];
  /** Transactions to retire. `replacedBy` is the index into `add` of the replacement, if any. */
  retire?: { id: string; status: Exclude<TxnStatus, 'active'>; replacedBy?: number }[];
  /** Source accounts to create or refresh (imports). The manual account is created on demand. */
  accounts?: { id: string; source: string; label: string }[];
  /**
   * Finish an import in the same transaction as the ledger write:
   *  - confirm: the draft must still be a live draft; it becomes "confirmed" with final counts.
   *  - undo: every active transaction of that import is voided; it becomes "undone".
   */
  importDoc?: { id: string; action: 'confirm' | 'undo' };
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
  /** Imported rows not added because the same row is already in the ledger. */
  duplicates?: number;
  /** Transactions voided by an import undo. */
  voided?: number;
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
    const importRef = change.importDoc
      ? userRef.collection('imports').doc(change.importDoc.id)
      : null;
    const [activeSnap, instSnap, priceSnap, bookSnap, accountSnap, metaSnap, importSnap] =
      await Promise.all([
        tx.get(txCol.where('status', '==', 'active')),
        tx.get(userRef.collection('instruments')),
        tx.get(userRef.collection('manualPrices')),
        tx.get(bookRef),
        tx.get(accountRef),
        tx.get(metaRef),
        importRef ? tx.get(importRef) : Promise.resolve(null),
      ]);

    // An import is finished exactly once: two confirms (or a confirm racing an undo) cannot both win.
    if (change.importDoc) {
      const status = importSnap?.get('status') as ImportStatus | undefined;
      if (!importSnap?.exists) throw new HttpError(404, 'NOT_FOUND', 'Import not found');
      if (change.importDoc.action === 'confirm') {
        if (status !== 'draft')
          throw new HttpError(409, 'IMPORT_NOT_DRAFT', 'This import was already confirmed');
        const expires = importSnap.get('expiresAt') as { toDate?: () => Date } | undefined;
        if (expires?.toDate && expires.toDate().getTime() < now.getTime()) {
          throw new HttpError(410, 'IMPORT_EXPIRED', 'This preview expired. Upload the file again');
        }
      } else if (status !== 'confirmed') {
        throw new HttpError(409, 'IMPORT_NOT_CONFIRMED', 'Only a confirmed import can be undone');
      }
    }

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
    // SEC-002: user edits (not refreshes) are rate limited per user, inside this transaction.
    const isEdit =
      !trigger &&
      ((change.add?.length ?? 0) > 0 ||
        (change.retire?.length ?? 0) > 0 ||
        change.importDoc !== undefined ||
        (change.instruments?.length ?? 0) > 0 ||
        Object.keys(change.manualPrices ?? {}).length > 0);
    const writeCounters = isEdit
      ? nextWriteCounters(metaSnap.data() as Partial<WriteCounters> | undefined, now, today)
      : null;

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

    // Undo an import: void everything it added that is still active.
    const undoIds =
      change.importDoc?.action === 'undo'
        ? activeSnap.docs.filter((d) => d.get('importId') === change.importDoc!.id).map((d) => d.id)
        : [];
    for (const id of undoIds) active.delete(id);

    // Imported rows already in the ledger (same fingerprint, still active) are skipped, so
    // importing the same statement twice adds nothing.
    const knownFingerprints = new Set<string>();
    for (const d of activeSnap.docs) {
      const f = d.get('fingerprint') as string | undefined;
      if (f && !undoIds.includes(d.id)) knownFingerprints.add(f);
    }
    let duplicates = 0;
    const adds = (change.add ?? []).filter((a) => {
      const f = a.importMeta?.fingerprint;
      if (!f) return true;
      if (knownFingerprints.has(f)) {
        duplicates++;
        return false;
      }
      knownFingerprints.add(f);
      return true;
    });
    if (duplicates > 0 && (change.retire ?? []).some((r) => r.replacedBy !== undefined)) {
      throw new Error('replacedBy cannot be combined with de-duplicated adds');
    }

    const seqBase = Date.now();
    const newRefs: DocumentReference[] = adds.map(() => txCol.doc());
    adds.forEach((a, i) => {
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
    // SEC-003: manual prices only for the user's own instruments (also rejects odd ids like "a/b").
    for (const id of Object.keys(change.manualPrices ?? {})) {
      if (!instruments[id]) throw new HttpError(404, 'NOT_FOUND', 'Unknown holding');
    }
    if (adds.length > 0 || (change.instruments?.length ?? 0) > 0) {
      assertLedgerSize(active.size, Object.keys(instruments).length);
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
    if (!accountSnap.exists && adds.some((a) => a.fields.accountId === MANUAL_ACCOUNT)) {
      tx.set(accountRef, {
        source: 'manual',
        label: 'Manual',
        method: 'manual',
        status: 'ok',
        createdAt: ts,
      });
    }
    for (const a of change.accounts ?? []) {
      tx.set(
        userRef.collection('accounts').doc(a.id),
        { source: a.source, label: a.label, method: 'import', status: 'ok', updatedAt: ts },
        { merge: true },
      );
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
      const previous = priceSnap.docs.find((d) => d.id === id)?.get('history') as
        { price: string; asOf: string; at: unknown }[] | undefined;
      tx.set(
        userRef.collection('manualPrices').doc(id),
        {
          price: p.price,
          asOf: p.asOf,
          updatedAt: ts,
          // SEC-004: bounded (was an ever-growing arrayUnion)
          history: appendHistory(previous, { price: p.price, asOf: p.asOf, at: now }),
        },
        { merge: true },
      );
    }
    if (writeCounters) tx.set(metaRef, writeCounters, { merge: true });
    if (change.importDoc?.action === 'confirm') {
      // Imported rows per user per day are capped: each row is a Firestore write.
      tx.set(
        metaRef,
        nextImportRowCounters(
          metaSnap.data() as Partial<ImportRowCounters> | undefined,
          today,
          adds.length,
        ),
        { merge: true },
      );
    }
    adds.forEach((a, i) => {
      const doc: TxnDoc = {
        ...a.fields,
        seq: seqBase + i,
        status: 'active',
        source: a.importMeta ? 'import' : 'manual',
        createdAt: ts,
        ...(a.note ? { note: a.note } : {}),
        ...(a.importMeta ?? {}),
      };
      tx.set(newRefs[i]!, doc);
    });
    for (const id of undoIds) tx.update(txCol.doc(id), { status: 'void', voidedAt: ts });
    if (importRef && change.importDoc) {
      tx.set(
        importRef,
        change.importDoc.action === 'confirm'
          ? {
              status: 'confirmed' satisfies ImportStatus,
              confirmedAt: ts,
              added: adds.length,
              skippedDuplicates: duplicates,
              // the draft rows are no longer needed once they are in the ledger
              rows: FieldValue.delete(),
              expiresAt: FieldValue.delete(),
            }
          : { status: 'undone' satisfies ImportStatus, undoneAt: ts, voided: undoIds.length },
        { merge: true },
      );
    }
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
      ...(change.importDoc?.action === 'confirm' ? { duplicates } : {}),
      ...(change.importDoc?.action === 'undo' ? { voided: undoIds.length } : {}),
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
