import { createHash } from 'node:crypto';
import { canonicalDecimal } from './values';

/** The fields that identify one statement row. Money values are decimal strings. */
export interface FingerprintFields {
  source: string;
  accountId: string;
  instrumentId: string;
  type: string;
  tradeDate: string;
  qty?: string;
  price?: string;
  amount?: string;
  ratio?: { from: number; to: number };
  brokerRef?: string;
}

const num = (v: string | undefined) => (v === undefined ? '' : canonicalDecimal(v));

/**
 * Stable identity of a statement row: sha256 over source, account, date, instrument, type,
 * quantity, price/amount and the broker's reference. Importing the same row again produces the
 * same fingerprint, so it is skipped instead of being added twice.
 *
 * Fees and notes are left out on purpose: brokers re-issue statements with corrected charges, and
 * that must not turn every row into a "new" one.
 */
export function fingerprint(f: FingerprintFields, occurrence = 1): string {
  const parts = [
    f.source,
    f.accountId,
    f.tradeDate,
    f.instrumentId,
    f.type,
    num(f.qty),
    num(f.price),
    num(f.amount),
    f.ratio ? `${f.ratio.from}:${f.ratio.to}` : '',
    f.brokerRef ?? '',
    // 2nd, 3rd… identical row in the same file (e.g. two equal SIP buys on one day)
    occurrence > 1 ? `#${occurrence}` : '',
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Fingerprints for a whole file. Rows that are identical in every identifying field are numbered
 * in file order, so genuine repeats are kept AND a re-import of the same file still matches.
 */
export function fingerprintAll(rows: FingerprintFields[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = fingerprint(r);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : fingerprint(r, n);
  });
}
