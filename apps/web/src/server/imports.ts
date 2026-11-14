import 'server-only';
import { defaultCurrency, type InstrumentMeta, type LedgerTxn } from '@kosh/core';
import {
  ImportError,
  MAX_IMPORT_ROWS,
  type ParserInput,
  type RowIssue,
  runImport,
} from '@kosh/parsers';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { HttpError } from './http';
import {
  type DraftRow,
  draftRowToLedgerFields,
  fxDatesNeeded,
  type ImportPlan,
  planImport,
} from './import-plan';
import { applyLedgerChange, type ImportStatus, istToday } from './ledger';
import {
  IMPORT_WRITE_BUDGET,
  type ImportPreviewCounters,
  importWrites,
  nextImportPreviewCounters,
} from './limits';
import { fxOnDate } from './market';

/**
 * Statement imports (docs/PLAN.md §4.2): preview → confirm.
 * The uploaded file is parsed in memory and dropped; only the normalised rows are kept, in a
 * draft that expires after 24 hours. Nothing is written to the ledger until the user confirms.
 */

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
/** Issues stored and returned per import. The count is always exact. */
const MAX_ISSUES = 100;
/** Distinct trade dates for which a USD→INR rate is looked up in one preview. */
const MAX_FX_LOOKUPS = 40;

const SOURCE_LABELS: Record<string, string> = {
  kosh: 'Kosh CSV import',
  zerodha: 'Zerodha',
  groww: 'Groww',
  indmoney: 'INDmoney',
  cas: 'Mutual funds (CAS)',
  coindcx: 'CoinDCX',
};

export interface ImportPreview {
  importId: string;
  parser: string;
  source: string;
  counts: ImportPlan['counts'] & { newHoldings: number };
  rows: DraftRow[];
  issues: RowIssue[];
  issuesTruncated: boolean;
  expiresAt: string;
}

interface ImportDoc {
  status: ImportStatus;
  parser: string;
  source: string;
  accountId: string;
  counts: ImportPreview['counts'];
  rows?: DraftRow[];
  issues: RowIssue[];
  issuesTruncated: boolean;
}

const STATUS_FOR: Partial<Record<ImportError['code'], number>> = { FILE_TOO_LARGE: 413 };

/** Parse a file and store a draft import. The caller must zero `input.bytes` afterwards. */
export async function previewImport(uid: string, input: ParserInput): Promise<ImportPreview> {
  const db = adminDb();
  const userRef = db.doc(`users/${uid}`);
  const metaRef = db.doc(`userMeta/${uid}`);
  const now = new Date();
  const today = istToday(now);

  // Per-user daily limit, counted before any parsing work.
  await db.runTransaction(async (tx) => {
    const meta = (await tx.get(metaRef)).data() as Partial<ImportPreviewCounters> | undefined;
    tx.set(metaRef, nextImportPreviewCounters(meta, today), { merge: true });
  });

  let parsed;
  try {
    parsed = runImport(input, { today, maxRows: MAX_IMPORT_ROWS });
  } catch (e) {
    if (e instanceof ImportError) {
      throw new HttpError(STATUS_FOR[e.code] ?? 422, e.code, e.message, e.details);
    }
    throw e;
  }

  const [activeSnap, instSnap] = await Promise.all([
    userRef.collection('transactions').where('status', '==', 'active').get(),
    userRef.collection('instruments').select().get(),
  ]);
  const existingFingerprints = new Set<string>();
  const existingLedger: LedgerTxn[] = [];
  for (const d of activeSnap.docs) {
    const data = d.data();
    if (typeof data.fingerprint === 'string') existingFingerprints.add(data.fingerprint);
    existingLedger.push({ ...(data as Omit<LedgerTxn, 'id'>), id: d.id });
  }

  const fxByDate = new Map<string, string | null>();
  for (const date of fxDatesNeeded(parsed).slice(0, MAX_FX_LOOKUPS)) {
    fxByDate.set(date, await fxOnDate(date));
  }

  const plan = planImport(parsed, {
    existingFingerprints,
    existingInstrumentIds: new Set(instSnap.docs.map((d) => d.id)),
    existingLedger,
    fxByDate,
  });

  if (importWrites(plan.counts.new, plan.newInstrumentIds.length) > IMPORT_WRITE_BUDGET) {
    throw new HttpError(
      422,
      'TOO_MANY_ROWS',
      'This file is too large for one import. Split it into smaller files (for example by year)',
      { newRows: plan.counts.new, newHoldings: plan.newInstrumentIds.length },
    );
  }

  // One draft at a time: a new upload replaces any earlier unconfirmed one.
  const oldDrafts = await userRef.collection('imports').where('status', '==', 'draft').get();
  const ref = userRef.collection('imports').doc();
  const expiresAt = new Date(now.getTime() + DRAFT_TTL_MS);
  const doc: ImportDoc = {
    status: 'draft',
    parser: parsed.parser,
    source: parsed.source,
    accountId: plan.accountId,
    counts: { ...plan.counts, newHoldings: plan.newInstrumentIds.length },
    rows: plan.rows,
    issues: plan.issues.slice(0, MAX_ISSUES),
    issuesTruncated: plan.issues.length > MAX_ISSUES,
  };
  const batch = db.batch();
  for (const d of oldDrafts.docs) batch.delete(d.ref);
  // The file name is deliberately not stored: it often contains a client id or a person's name.
  batch.set(ref, { ...doc, createdAt: FieldValue.serverTimestamp(), expiresAt });
  await batch.commit();

  return {
    importId: ref.id,
    parser: doc.parser,
    source: doc.source,
    counts: doc.counts,
    rows: plan.rows,
    issues: doc.issues,
    issuesTruncated: doc.issuesTruncated,
    expiresAt: expiresAt.toISOString(),
  };
}

async function readImport(uid: string, importId: string) {
  const snap = await adminDb().doc(`users/${uid}/imports/${importId}`).get();
  if (!snap.exists) throw new HttpError(404, 'NOT_FOUND', 'Import not found');
  return snap.data() as ImportDoc;
}

/** Add a draft's new rows to the ledger. `skipLines` are rows the user unticked in the preview. */
export async function confirmImport(uid: string, importId: string, skipLines: number[] = []) {
  const draft = await readImport(uid, importId);
  if (draft.status !== 'draft') {
    throw new HttpError(409, 'IMPORT_NOT_DRAFT', 'This import was already confirmed');
  }
  const skip = new Set(skipLines);
  const rows = (draft.rows ?? []).filter((r) => r.status === 'new' && !skip.has(r.line));
  if (rows.length === 0) {
    throw new HttpError(422, 'NOTHING_TO_IMPORT', 'There are no new rows to import');
  }

  const instruments = new Map<string, InstrumentMeta>();
  for (const r of rows) {
    if (instruments.has(r.instrumentId)) continue;
    instruments.set(r.instrumentId, {
      id: r.instrumentId,
      name: r.instrument.name,
      assetClass: r.instrument.assetClass,
      symbol: r.instrument.symbol ?? null,
      currency: defaultCurrency(r.instrument.assetClass),
      ...(r.instrument.exchange ? { exchange: r.instrument.exchange } : {}),
    });
  }

  const result = await applyLedgerChange(uid, {
    accounts: [
      {
        id: draft.accountId,
        source: draft.source,
        label: SOURCE_LABELS[draft.source] ?? draft.source,
      },
    ],
    instruments: [...instruments.values()],
    add: rows.map((r) => ({
      fields: draftRowToLedgerFields(r, draft.accountId),
      ...(r.note ? { note: r.note } : {}),
      importMeta: {
        fingerprint: r.fingerprint,
        importId,
        parser: draft.parser,
        ...(r.brokerRef ? { brokerRef: r.brokerRef } : {}),
      },
    })),
    importDoc: { id: importId, action: 'confirm' },
  });
  return {
    added: result.addedIds.length,
    skippedDuplicates: result.duplicates ?? 0,
    bookVersion: result.bookVersion,
  };
}

/** Discard a draft, or undo a confirmed import by voiding the transactions it added. */
export async function removeImport(uid: string, importId: string) {
  const doc = await readImport(uid, importId);
  if (doc.status === 'draft') {
    await adminDb().doc(`users/${uid}/imports/${importId}`).delete();
    return { discarded: true as const };
  }
  if (doc.status !== 'confirmed') {
    throw new HttpError(409, 'IMPORT_NOT_CONFIRMED', 'This import was already undone');
  }
  const result = await applyLedgerChange(uid, { importDoc: { id: importId, action: 'undo' } });
  return { voided: result.voided ?? 0, bookVersion: result.bookVersion };
}
