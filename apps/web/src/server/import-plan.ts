import { buildPositions, type LedgerTxn } from '@kosh/core';
import {
  fingerprintAll,
  type NormalisedImport,
  type NormalisedRow,
  type RowIssue,
} from '@kosh/parsers';
import { instrumentIdFor } from './instrument-id';

/** A parsed statement row, ready to be stored in a draft import and later added to the ledger. */
export interface DraftRow extends Omit<NormalisedRow, 'fxRate'> {
  fingerprint: string;
  /** new = will be added on confirm; duplicate = already in the ledger, will be skipped. */
  status: 'new' | 'duplicate';
  instrumentId: string;
  fxRate?: string;
}

export interface ImportPlan {
  accountId: string;
  rows: DraftRow[];
  issues: RowIssue[];
  /** Instrument ids the import would create. */
  newInstrumentIds: string[];
  counts: { total: number; new: number; duplicate: number; needsAttention: number };
}

export interface PlanInputs {
  /** Fingerprints of the user's active imported transactions. */
  existingFingerprints: ReadonlySet<string>;
  existingInstrumentIds: ReadonlySet<string>;
  /** The user's active ledger, for a dry run of the combined result. */
  existingLedger: readonly LedgerTxn[];
  /** USD→INR reference rate by trade date, for USD rows without a stated rate. */
  fxByDate: ReadonlyMap<string, string | null>;
}

export const importAccountId = (source: string) => `import:${source}`;

const needsFx = (r: NormalisedRow) =>
  r.currency === 'USD' && r.type !== 'SPLIT' && r.type !== 'BONUS';

/** Dates for which a USD→INR rate has to be looked up before planning. */
export function fxDatesNeeded(parsed: NormalisedImport): string[] {
  return [...new Set(parsed.rows.filter((r) => needsFx(r) && !r.fxRate).map((r) => r.tradeDate))];
}

const toLedger = (r: DraftRow, accountId: string, id: string, seq: number): LedgerTxn => ({
  id,
  accountId,
  instrumentId: r.instrumentId,
  type: r.type,
  tradeDate: r.tradeDate,
  currency: r.currency,
  seq,
  ...(r.qty !== undefined ? { qty: r.qty } : {}),
  ...(r.price !== undefined ? { price: r.price } : {}),
  ...(r.fees !== undefined ? { fees: r.fees } : {}),
  ...(r.amount !== undefined ? { amount: r.amount } : {}),
  ...(r.ratio ? { ratio: r.ratio } : {}),
  ...(r.fxRate ? { fxRate: r.fxRate } : {}),
});

/** Ledger fields for a draft row (what confirm writes). */
export function draftRowToLedgerFields(
  r: DraftRow,
  accountId: string,
): Omit<LedgerTxn, 'id' | 'seq'> {
  const { id: _id, seq: _seq, ...fields } = toLedger(r, accountId, '', 0);
  void _id;
  void _seq;
  return fields;
}

/**
 * Decide what an import would do, without touching the database:
 *  1. give every row its instrument id and fingerprint;
 *  2. mark rows already in the ledger as duplicates;
 *  3. set aside USD rows whose exchange rate is unknown;
 *  4. dry-run the ledger with the new rows and set aside any that cannot apply
 *     (for example a sale of more units than held).
 */
export function planImport(parsed: NormalisedImport, inputs: PlanInputs): ImportPlan {
  const accountId = importAccountId(parsed.source);
  const issues: RowIssue[] = [...parsed.issues];

  const withIds = parsed.rows.map((r) => ({ ...r, instrumentId: instrumentIdFor(r.instrument) }));
  const prints = fingerprintAll(
    withIds.map((r) => ({
      source: parsed.source,
      accountId,
      instrumentId: r.instrumentId,
      type: r.type,
      tradeDate: r.tradeDate,
      qty: r.qty,
      price: r.price,
      amount: r.amount,
      ratio: r.ratio,
      brokerRef: r.brokerRef,
    })),
  );

  let candidates: DraftRow[] = [];
  for (const [i, r] of withIds.entries()) {
    const fingerprint = prints[i]!;
    const status = inputs.existingFingerprints.has(fingerprint) ? 'duplicate' : 'new';
    let fxRate = r.fxRate;
    if (status === 'new' && needsFx(r) && !fxRate) {
      fxRate = inputs.fxByDate.get(r.tradeDate) ?? undefined;
      if (!fxRate) {
        issues.push({
          line: r.line,
          field: 'fx_rate',
          message: 'No USD→INR rate found for this date. Add the rate you paid in fx_rate',
        });
        continue;
      }
    }
    const { fxRate: _stated, ...rest } = r;
    void _stated;
    candidates.push({ ...rest, fingerprint, status, ...(fxRate ? { fxRate } : {}) });
  }

  // Dry run: existing ledger + new rows, in file order after everything already there.
  const maxSeq = inputs.existingLedger.reduce((m, t) => Math.max(m, t.seq ?? 0), 0);
  const fresh = candidates.filter((r) => r.status === 'new');
  const { errors } = buildPositions([
    ...inputs.existingLedger,
    ...fresh.map((r, i) => toLedger(r, accountId, `line:${r.line}`, maxSeq + 1 + i)),
  ]);
  const rejected = new Map<number, string>();
  for (const e of errors) {
    const m = /^line:(\d+)$/.exec(e.txnId);
    if (m) rejected.set(Number(m[1]), e.message);
  }
  if (rejected.size > 0) {
    for (const [line, message] of rejected) issues.push({ line, message });
    candidates = candidates.filter((r) => r.status !== 'new' || !rejected.has(r.line));
  }

  const newRows = candidates.filter((r) => r.status === 'new');
  const newInstrumentIds = [
    ...new Set(
      newRows.map((r) => r.instrumentId).filter((id) => !inputs.existingInstrumentIds.has(id)),
    ),
  ];
  issues.sort((a, b) => a.line - b.line);
  return {
    accountId,
    rows: candidates,
    issues,
    newInstrumentIds,
    counts: {
      total: parsed.totalRows,
      new: newRows.length,
      duplicate: candidates.length - newRows.length,
      needsAttention: new Set(issues.map((i) => i.line)).size,
    },
  };
}
