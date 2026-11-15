import 'server-only';
import { InstrumentInput } from '@kosh/contracts';
import { defaultCurrency, type InstrumentMeta } from '@kosh/core';
import {
  fingerprint,
  type NormalisedStatement,
  type ReconciliationCheck,
  type RowIssue,
} from '@kosh/parsers';
import { lookupIsin } from '@kosh/prices';
import { FieldValue, type Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { HttpError } from './http';
import { instrumentIdFor } from './instrument-id';
import { applyLedgerChange, type ImportStatus } from './ledger';
import { IMPORT_WRITE_BUDGET, importWrites } from './limits';
import { fxOnDate, providerContext } from './market';
import {
  type CurrentLot,
  planStatement,
  type RemovedRow,
  type ResolvedIsin,
  statementAccountId,
  statementFxDates,
  type StatementPlan,
  type StatementRow,
  statementRowToLedgerFields,
} from './statement-plan';

/**
 * Importing a HOLDINGS statement (Groww, INDmoney…): a snapshot that replaces the same broker's
 * earlier statement. Preview stores a draft with the difference; confirm applies it in one
 * ledger transaction. See docs/parsers/m3-holdings-spec.md.
 */

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ISSUES = 100;
const MAX_FX_LOOKUPS = 40;
/** New ISINs looked up in one preview (each is one throttled request, cached for everyone). */
const MAX_ISIN_LOOKUPS = 40;
/** How long "no Indian listing found" is remembered before asking again. */
const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface StatementPreview {
  kind: 'positions';
  importId: string;
  parser: string;
  source: string;
  label: string;
  statementDate: string;
  counts: StatementPlan['counts'] & { newHoldings: number };
  rows: StatementRow[];
  removed: RemovedRow[];
  issues: RowIssue[];
  issuesTruncated: boolean;
  skipped: NormalisedStatement['skipped'];
  reconciliation: ReconciliationCheck[];
  notes: string[];
  olderThanCurrent: boolean;
  removalsSuppressed: boolean;
  expiresAt: string;
}

/** The same file was imported before and nothing has replaced it since. */
export interface AlreadyImported {
  kind: 'positions';
  alreadyImported: true;
  importId: string;
  label: string;
  statementDate: string;
}

export interface StatementDraftDoc extends Omit<StatementPreview, 'importId' | 'expiresAt'> {
  status: ImportStatus;
  accountId: string;
  fileHash: string;
}

interface IsinDoc {
  symbol?: string;
  exchange?: 'NSE' | 'BSE';
  name?: string;
  notFound?: boolean;
  checkedAt?: Timestamp;
}

/**
 * ISIN → ticker, in order: the user's own instruments, the shared cache, then a lookup (cached
 * for everyone afterwards). The shared cache only ever holds lookup results, never anything a
 * user typed, so one user cannot change another's mapping.
 */
async function resolveIsins(
  isins: string[],
  own: Map<string, ResolvedIsin>,
  now: Date,
): Promise<Map<string, ResolvedIsin | null>> {
  const db = adminDb();
  const out = new Map<string, ResolvedIsin | null>();
  const pending: string[] = [];
  for (const isin of isins) {
    const mine = own.get(isin);
    if (mine) out.set(isin, mine);
    else pending.push(isin);
  }
  if (pending.length === 0) return out;

  const snaps = await db.getAll(...pending.map((i) => db.doc(`isinMap/${i}`)));
  const toLookUp: string[] = [];
  snaps.forEach((snap, n) => {
    const isin = pending[n]!;
    const d = snap.exists ? (snap.data() as IsinDoc) : null;
    if (d?.symbol && d.exchange) {
      out.set(isin, {
        symbol: d.symbol,
        exchange: d.exchange,
        ...(d.name ? { name: d.name } : {}),
      });
    } else if (
      d?.notFound &&
      d.checkedAt &&
      now.getTime() - d.checkedAt.toMillis() < NOT_FOUND_TTL_MS
    ) {
      out.set(isin, null);
    } else toLookUp.push(isin);
  });

  const ctx = providerContext(now);
  for (const isin of toLookUp.slice(0, MAX_ISIN_LOOKUPS)) {
    const r = await lookupIsin(isin, ctx);
    if (r.status === 'found') {
      out.set(isin, r.match);
      await db.doc(`isinMap/${isin}`).set({ ...r.match, checkedAt: FieldValue.serverTimestamp() });
    } else if (r.status === 'not-found') {
      out.set(isin, null);
      await db
        .doc(`isinMap/${isin}`)
        .set({ notFound: true, checkedAt: FieldValue.serverTimestamp() });
    } else {
      out.set(isin, null); // unavailable: unresolved for now, and not remembered
    }
  }
  return out;
}

export async function previewStatement(
  uid: string,
  parsed: NormalisedStatement,
  fileHash: string,
  now: Date,
): Promise<StatementPreview | AlreadyImported> {
  const db = adminDb();
  const userRef = db.doc(`users/${uid}`);
  const accountId = statementAccountId(parsed.account);

  const [activeSnap, instSnap, importsSnap] = await Promise.all([
    userRef.collection('transactions').where('status', '==', 'active').get(),
    userRef.collection('instruments').get(),
    userRef.collection('imports').where('accountId', '==', accountId).get(),
  ]);

  // The statement currently in the ledger for this broker: the latest confirmed import.
  const confirmed = importsSnap.docs
    .filter((d) => d.get('status') === 'confirmed' && d.get('kind') === 'positions')
    .sort(
      (a, b) =>
        ((b.get('confirmedAt') as Timestamp | undefined)?.toMillis() ?? 0) -
        ((a.get('confirmedAt') as Timestamp | undefined)?.toMillis() ?? 0),
    )[0];
  if (confirmed && confirmed.get('fileHash') === fileHash) {
    return {
      kind: 'positions',
      alreadyImported: true,
      importId: confirmed.id,
      label: parsed.label,
      statementDate: parsed.statementDate,
    };
  }

  const names = new Map(instSnap.docs.map((d) => [d.id, (d.get('name') as string) ?? d.id]));
  const current: CurrentLot[] = activeSnap.docs
    .filter(
      (d) =>
        d.get('accountId') === accountId &&
        d.get('type') === 'OPENING_BALANCE' &&
        d.get('importId'),
    )
    .map((d) => ({
      txnId: d.id,
      instrumentId: d.get('instrumentId') as string,
      name: names.get(d.get('instrumentId') as string) ?? (d.get('instrumentId') as string),
      quantity: d.get('qty') as string,
      avgBuyPrice: d.get('price') as string,
      tradeDate: d.get('tradeDate') as string,
    }));

  // ISINs the user already holds under a ticker (from an earlier import or a manual mapping).
  const own = new Map<string, ResolvedIsin>();
  for (const d of instSnap.docs) {
    const isin = d.get('isin') as string | undefined;
    const symbol = d.get('symbol') as string | null;
    if (isin && symbol) {
      own.set(isin, {
        instrumentId: d.id,
        symbol,
        exchange: (d.get('exchange') as 'NSE' | 'BSE' | undefined) ?? 'NSE',
      });
    }
  }
  const isins = [
    ...new Set(parsed.holdings.filter((h) => !h.symbol && h.isin).map((h) => h.isin!)),
  ];
  const resolved = await resolveIsins(isins, own, now);

  const fxByDate = new Map<string, string | null>();
  for (const date of statementFxDates(parsed).slice(0, MAX_FX_LOOKUPS)) {
    fxByDate.set(date, await fxOnDate(date));
  }

  const plan = planStatement(parsed, {
    resolved,
    current,
    existingInstrumentIds: new Set(instSnap.docs.map((d) => d.id)),
    fxByDate,
    currentStatementDate: (confirmed?.get('statementDate') as string | undefined) ?? null,
  });

  const writes = importWrites(
    plan.counts.added + 2 * plan.counts.changed + plan.counts.removed,
    plan.newInstrumentIds.length,
  );
  if (writes > IMPORT_WRITE_BUDGET) {
    throw new HttpError(422, 'TOO_MANY_ROWS', 'This statement is too large for one import', {
      rows: plan.rows.length,
    });
  }

  const oldDrafts = await userRef.collection('imports').where('status', '==', 'draft').get();
  const ref = userRef.collection('imports').doc();
  const expiresAt = new Date(now.getTime() + DRAFT_TTL_MS);
  const doc: StatementDraftDoc = {
    status: 'draft',
    kind: 'positions',
    parser: parsed.parser,
    source: parsed.source,
    label: parsed.label,
    accountId,
    fileHash,
    statementDate: parsed.statementDate,
    counts: { ...plan.counts, newHoldings: plan.newInstrumentIds.length },
    rows: plan.rows,
    removed: plan.removed,
    issues: plan.issues.slice(0, MAX_ISSUES),
    issuesTruncated: plan.issues.length > MAX_ISSUES,
    skipped: parsed.skipped,
    reconciliation: parsed.reconciliation,
    notes: parsed.notes,
    olderThanCurrent: plan.olderThanCurrent,
    removalsSuppressed: plan.removalsSuppressed,
  };
  const batch = db.batch();
  for (const d of oldDrafts.docs) batch.delete(d.ref);
  // Neither the file nor its name is stored: only its SHA-256, to recognise the same file again.
  batch.set(ref, { ...doc, createdAt: FieldValue.serverTimestamp(), expiresAt });
  await batch.commit();

  const { status: _status, accountId: _account, fileHash: _hash, ...preview } = doc;
  void _status;
  void _account;
  void _hash;
  return { ...preview, importId: ref.id, expiresAt: expiresAt.toISOString() };
}

export interface StatementConfirmOptions {
  /** Required when the statement is older than the one in the ledger. */
  acceptOlder?: boolean;
  /** Tickers the user typed for unresolved rows, by file row. */
  mappings?: { line: number; symbol: string; exchange?: 'NSE' | 'BSE' }[];
}

/** Apply a user's ticker to an unresolved row. Throws 422 for a ticker Kosh would not accept. */
function applyMapping(
  row: StatementRow,
  mapping: NonNullable<StatementConfirmOptions['mappings']>[number],
  source: string,
  accountId: string,
): StatementRow {
  const checked = InstrumentInput.safeParse({
    name: row.name,
    assetClass: row.assetClass,
    symbol: mapping.symbol,
    ...(mapping.exchange ? { exchange: mapping.exchange } : {}),
  });
  if (!checked.success || !checked.data.symbol) {
    throw new HttpError(422, 'VALIDATION_FAILED', `Row ${row.line}: that is not a valid ticker`, {
      fields: { [`mappings.${row.line}`]: 'Letters, digits and . - & only' },
    });
  }
  const symbol = checked.data.symbol;
  const exchange = checked.data.exchange ?? 'NSE';
  const instrumentId = instrumentIdFor({
    assetClass: row.assetClass,
    name: row.name,
    symbol,
    exchange,
  });
  return {
    ...row,
    instrumentId,
    symbol,
    exchange,
    unresolved: false,
    fingerprint: fingerprint({
      source,
      accountId,
      instrumentId,
      type: 'OPENING_BALANCE',
      tradeDate: row.tradeDate,
      qty: row.quantity,
      price: row.avgBuyPrice,
    }),
  };
}

export async function confirmStatement(
  uid: string,
  importId: string,
  draft: StatementDraftDoc,
  options: StatementConfirmOptions = {},
) {
  if (draft.olderThanCurrent && !options.acceptOlder) {
    throw new HttpError(
      409,
      'OLDER_STATEMENT',
      'This statement is older than the one already imported. Confirm that you want to go back to it',
    );
  }
  const mappings = new Map((options.mappings ?? []).map((m) => [m.line, m]));
  const rows = draft.rows.map((r) => {
    const m = mappings.get(r.line);
    return m && r.unresolved ? applyMapping(r, m, draft.source, draft.accountId) : r;
  });

  const toAdd = rows.filter((r) => r.status !== 'unchanged');
  const retire = [
    ...rows.flatMap((r) => (r.status === 'changed' && r.previous ? [r.previous.txnId] : [])),
    ...draft.removed.map((r) => r.txnId),
  ];
  if (toAdd.length === 0 && retire.length === 0) {
    throw new HttpError(
      422,
      'NOTHING_TO_IMPORT',
      'Your holdings already match this statement. There is nothing to change',
    );
  }

  const instruments = new Map<string, InstrumentMeta>();
  for (const r of toAdd) {
    if (instruments.has(r.instrumentId)) continue;
    instruments.set(r.instrumentId, {
      id: r.instrumentId,
      name: r.name,
      assetClass: r.assetClass,
      symbol: r.symbol ?? null,
      currency: defaultCurrency(r.assetClass),
      ...(r.exchange ? { exchange: r.exchange } : {}),
      ...(r.isin ? { isin: r.isin } : {}),
      instrumentType: r.instrumentType,
    });
  }
  // The statement's closing price values a holding straight away; a live quote replaces it as
  // soon as one with a later date arrives, and it is all an unmapped holding has.
  const manualPrices: Record<string, { price: string; asOf: string }> = {};
  for (const r of toAdd) {
    if (r.statementPrice) {
      manualPrices[r.instrumentId] = { price: r.statementPrice, asOf: draft.statementDate };
    }
  }

  const result = await applyLedgerChange(uid, {
    accounts: [{ id: draft.accountId, source: draft.source, label: draft.label }],
    instruments: [...instruments.values()],
    add: toAdd.map((r) => ({
      fields: statementRowToLedgerFields(r, draft.accountId),
      importMeta: { fingerprint: r.fingerprint, importId, parser: draft.parser },
    })),
    retireImported: retire,
    manualPrices,
    importDoc: { id: importId, action: 'confirm' },
  });
  return {
    added: toAdd.filter((r) => r.status === 'added').length,
    changed: toAdd.filter((r) => r.status === 'changed').length,
    removed: draft.removed.length,
    unchanged: rows.length - toAdd.length,
    unresolved: toAdd.filter((r) => r.unresolved).length,
    bookVersion: result.bookVersion,
  };
}

/**
 * Give an unmapped holding (imported under its ISIN) a ticker. The holding moves to the ticker's
 * identity, so it is priced and consolidates with the same stock held elsewhere.
 */
export async function mapInstrumentSymbol(
  uid: string,
  instrumentId: string,
  input: { symbol: string; exchange?: 'NSE' | 'BSE' },
) {
  const snap = await adminDb().doc(`users/${uid}/instruments/${instrumentId}`).get();
  if (!snap.exists) throw new HttpError(404, 'NOT_FOUND', 'Holding not found');
  const assetClass = snap.get('assetClass') as InstrumentMeta['assetClass'];
  if (snap.get('symbol') || assetClass !== 'IN_EQUITY' || !snap.get('isin')) {
    throw new HttpError(409, 'ALREADY_MAPPED', 'This holding already has a ticker');
  }
  const name = snap.get('name') as string;
  const checked = InstrumentInput.safeParse({
    name,
    assetClass,
    symbol: input.symbol,
    ...(input.exchange ? { exchange: input.exchange } : {}),
  });
  if (!checked.success || !checked.data.symbol) {
    throw new HttpError(422, 'VALIDATION_FAILED', 'That is not a valid ticker', {
      fields: { symbol: 'Letters, digits and . - & only' },
    });
  }
  const symbol = checked.data.symbol;
  const exchange = checked.data.exchange ?? 'NSE';
  const to: InstrumentMeta = {
    id: instrumentIdFor({ assetClass, name, symbol, exchange }),
    name,
    assetClass,
    symbol,
    currency: defaultCurrency(assetClass),
    exchange,
    isin: snap.get('isin') as string,
    ...(snap.get('instrumentType')
      ? { instrumentType: snap.get('instrumentType') as 'STOCK' | 'ETF' }
      : {}),
  };
  const result = await applyLedgerChange(uid, { rekey: { from: instrumentId, to } });
  return { instrumentId: to.id, moved: result.moved ?? 0, bookVersion: result.bookVersion };
}
