// LOCAL-ONLY check against real broker exports. Skipped unless the environment variables below
// point at files on this computer, so it never runs in CI and no real file is ever in the repo.
//
//   KOSH_REAL_GROWW=<path to a Groww holdings .xlsx>
//   KOSH_REAL_INDMONEY=<path to an INDmoney US holdings .xls>
//   pnpm --filter @kosh/parsers exec vitest run test/real-files.local.test.ts
//
// It asserts structure and reconciliation and prints STATUSES ONLY: never a name, symbol,
// quantity, amount or row count from the file.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_ROWS, type NormalisedStatement, runImport } from '../src';

const groww = process.env.KOSH_REAL_GROWW;
const indmoney = process.env.KOSH_REAL_INDMONEY;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

function statement(path: string): NormalisedStatement {
  const result = runImport(
    { bytes: readFileSync(path), fileName: 'real' },
    { today, maxRows: MAX_IMPORT_ROWS },
  );
  if (result.kind !== 'positions') throw new Error('expected a holdings statement');
  return result;
}

/** What may be shown about a real file: statuses and yes/no answers. */
const summary = (s: NormalisedStatement) => ({
  parser: s.parser,
  everyRowAccountedFor:
    s.holdings.length + s.skipped.length + new Set(s.issues.map((i) => i.line)).size ===
    s.totalRows,
  rowsNeedingAttention: s.issues.length,
  rowsSkipped: s.skipped.length,
  rowsWithWarnings: s.holdings.filter((h) => h.warnings.length > 0).length,
  statementDateFound: s.notes.length === 0,
  reconciliation: Object.fromEntries(s.reconciliation.map((c) => [c.id, c.status])),
  decimalsOnly: s.holdings.every((h) =>
    [h.quantity, h.avgBuyPrice, h.investedAmount].every((v) => /^\d+(\.\d+)?$/.test(v)),
  ),
});

describe.skipIf(!groww)('real Groww holdings file (local only)', () => {
  it('is detected, fully read and reconciles with its own summary', () => {
    const s = statement(groww!);
    console.log('GROWW', JSON.stringify(summary(s)));
    expect(s.parser).toBe('groww.holdings@1.0.0');
    expect(s.issues).toHaveLength(0);
    expect(s.notes).toHaveLength(0);
    expect(s.holdings.every((h) => /^IN[A-Z0-9]{10}$/.test(h.isin ?? ''))).toBe(true);
    expect(s.holdings.every((h) => h.statementPrice !== undefined)).toBe(true);
    for (const id of ['rows', 'invested', 'value', 'row-values']) {
      expect(s.reconciliation.find((c) => c.id === id)?.status, id).toBe('ok');
    }
  });
});

describe.skipIf(!indmoney)('real INDmoney US holdings file (local only)', () => {
  it('is detected and fully read; the known odd rows are skipped or flagged', () => {
    const s = statement(indmoney!);
    console.log('INDMONEY', JSON.stringify(summary(s)));
    expect(s.parser).toBe('indmoney.us-holdings@1.0.0');
    expect(s.issues).toHaveLength(0);
    expect(s.notes).toHaveLength(0);
    expect(s.holdings.every((h) => h.currency === 'USD' && h.acquiredOn !== undefined)).toBe(true);
    expect(s.holdings.every((h) => (h.quantity.split('.')[1] ?? '').length <= 8)).toBe(true);
    expect(s.reconciliation.find((c) => c.id === 'rows')?.status).toBe('ok');
  });
});
