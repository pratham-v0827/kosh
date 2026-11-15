// M3: what a holdings statement would change, decided without a database.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAX_IMPORT_ROWS, type NormalisedStatement, runImport } from '@kosh/parsers';
import { describe, expect, it } from 'vitest';
import {
  applyMappings,
  type CurrentLot,
  planStatement,
  type ResolvedIsin,
  statementAccountId,
  statementFxDates,
  type StatementPlan,
  type StatementPlanInputs,
  statementRowToLedgerFields,
} from '@/server/statement-plan';

const ctx = { today: '2026-11-14', maxRows: MAX_IMPORT_ROWS };
const fixture = (...p: string[]) =>
  readFileSync(resolve(import.meta.dirname, '../../../packages/parsers/fixtures', ...p));
const statement = (bytes: Uint8Array): NormalisedStatement => {
  const r = runImport({ bytes, fileName: 'x' }, ctx);
  if (r.kind !== 'positions') throw new Error('expected a holdings statement');
  return r;
};
const groww = () => statement(fixture('groww-holdings', 'holdings.xlsx'));
const indmoney = () => statement(fixture('indmoney-us-holdings', 'holdings.xls'));

const empty: StatementPlanInputs = {
  resolved: new Map(),
  current: [],
  existingInstrumentIds: new Set(),
  fxByDate: new Map(),
};
/** Every ISIN in the Groww fixture resolved to a made-up NSE ticker "T<n>". */
const allResolved = (s: NormalisedStatement) =>
  new Map<string, ResolvedIsin | null>(
    s.holdings.map((h, i) => [h.isin!, { symbol: `T${i}`, exchange: 'NSE' as const }]),
  );
/** The ledger as it would be after confirming a plan. */
const asCurrent = (plan: StatementPlan): CurrentLot[] =>
  plan.rows.map((r, i) => ({
    txnId: `txn${i}`,
    instrumentId: r.instrumentId,
    name: r.name,
    quantity: r.quantity,
    avgBuyPrice: r.avgBuyPrice,
    tradeDate: r.tradeDate,
  }));
const fxFor = (s: NormalisedStatement) => new Map(statementFxDates(s).map((d) => [d, '84.5']));

describe('planStatement — Groww (ISIN only)', () => {
  it('first import: every holding is added under its resolved ticker', () => {
    const s = groww();
    const plan = planStatement(s, { ...empty, resolved: allResolved(s) });
    expect(plan.accountId).toBe(statementAccountId('groww'));
    expect(plan.accountId).toBe('import:groww');
    expect(plan.counts).toEqual({
      total: 11,
      added: 11,
      changed: 0,
      unchanged: 0,
      removed: 0,
      skipped: 0,
      needsAttention: 0,
      unresolved: 0,
    });
    expect(plan.rows[0]).toMatchObject({
      status: 'added',
      instrumentId: 'IN_EQUITY:T0',
      symbol: 'T0',
      exchange: 'NSE',
      isin: 'INE029A01011',
      unresolved: false,
      tradeDate: '2026-10-31', // no purchase date in the file: the statement date
      dateQuality: 'unknown',
      quantity: '37',
      statementPrice: '341.85',
    });
    expect(plan.newInstrumentIds).toHaveLength(11);
    expect(new Set(plan.rows.map((r) => r.fingerprint)).size).toBe(11);
    expect(plan.olderThanCurrent).toBe(false);
  });

  it('unresolved ISINs are imported under the ISIN and flagged, never dropped', () => {
    const s = groww();
    const resolved = allResolved(s);
    resolved.set(s.holdings[1]!.isin!, null); // looked up, not found
    resolved.delete(s.holdings[2]!.isin!); // never looked up
    const plan = planStatement(s, { ...empty, resolved });
    expect(plan.rows).toHaveLength(11);
    expect(plan.counts.unresolved).toBe(2);
    expect(plan.rows[1]).toMatchObject({
      unresolved: true,
      instrumentId: `IN_EQUITY:${s.holdings[1]!.isin}`,
    });
    expect(plan.rows[1]).not.toHaveProperty('exchange');
    expect(plan.rows[1]!.symbol).toBeUndefined();
  });

  it('a BSE-only listing and a ticker the user already holds keep their identities', () => {
    const s = groww();
    const resolved = allResolved(s);
    resolved.set(s.holdings[0]!.isin!, { symbol: '500547', exchange: 'BSE' });
    resolved.set(s.holdings[1]!.isin!, {
      symbol: 'HEROMOTOCO',
      exchange: 'NSE',
      instrumentId: 'IN_EQUITY:HEROMOTOCO',
    });
    const plan = planStatement(s, {
      ...empty,
      resolved,
      existingInstrumentIds: new Set(['IN_EQUITY:HEROMOTOCO']),
    });
    expect(plan.rows[0]!.instrumentId).toBe('IN_EQUITY:BSE:500547');
    expect(plan.rows[1]!.instrumentId).toBe('IN_EQUITY:HEROMOTOCO');
    expect(plan.newInstrumentIds).not.toContain('IN_EQUITY:HEROMOTOCO');
    expect(plan.newInstrumentIds).toHaveLength(10);
  });

  it('the same statement again changes nothing', () => {
    const s = groww();
    const resolved = allResolved(s);
    const first = planStatement(s, { ...empty, resolved });
    const again = planStatement(s, {
      ...empty,
      resolved,
      current: asCurrent(first),
      existingInstrumentIds: new Set(first.newInstrumentIds),
      currentStatementDate: s.statementDate,
    });
    expect(again.counts).toMatchObject({ added: 0, changed: 0, unchanged: 11, removed: 0 });
    expect(again.newInstrumentIds).toEqual([]);
    expect(again.rows.map((r) => r.fingerprint)).toEqual(first.rows.map((r) => r.fingerprint));
  });

  it('a newer statement shows what was added, changed and removed', () => {
    const before = groww();
    const resolved = allResolved(before);
    const first = planStatement(before, { ...empty, resolved });
    const current = asCurrent(first);

    const after = groww();
    after.statementDate = '2026-11-10';
    after.holdings[0] = { ...after.holdings[0]!, quantity: '50', avgBuyPrice: '320.1' }; // bought more
    after.holdings.splice(3, 1); // sold out of the 4th holding
    after.holdings.push({
      ...after.holdings[1]!,
      line: 99,
      name: 'NEW HOLDING LTD',
      isin: 'INE000A01000',
    });
    resolved.set('INE000A01000', { symbol: 'NEWCO', exchange: 'NSE' });

    const plan = planStatement(after, {
      ...empty,
      resolved,
      current,
      existingInstrumentIds: new Set(first.newInstrumentIds),
      currentStatementDate: before.statementDate,
    });
    expect(plan.counts).toMatchObject({ added: 1, changed: 1, unchanged: 9, removed: 1 });
    // untouched holdings keep the date of the statement that first showed them
    expect(plan.rows.find((r) => r.instrumentId === 'IN_EQUITY:T1')).toMatchObject({
      status: 'unchanged',
      tradeDate: '2026-10-31',
    });
    expect(plan.rows.find((r) => r.instrumentId === 'IN_EQUITY:T0')).toMatchObject({
      status: 'changed',
      tradeDate: '2026-10-31', // still the earliest date known, not the new statement's
      quantity: '50',
      previous: { txnId: 'txn0', quantity: '37', avgBuyPrice: '318.46' },
    });
    expect(plan.removed).toEqual([
      {
        txnId: 'txn3',
        instrumentId: 'IN_EQUITY:T3',
        name: 'ITC LTD',
        quantity: '113',
        avgBuyPrice: '412.09',
      },
    ]);
    expect(plan.newInstrumentIds).toEqual(['IN_EQUITY:NEWCO']);
    expect(plan.olderThanCurrent).toBe(false);
  });

  it('an older statement is recognised as such', () => {
    const s = groww();
    const plan = planStatement(s, {
      ...empty,
      resolved: allResolved(s),
      currentStatementDate: '2026-11-05',
    });
    expect(plan.olderThanCurrent).toBe(true);
  });

  it('never removes holdings when some rows could not be read', () => {
    const s = groww();
    const resolved = allResolved(s);
    const current = asCurrent(planStatement(s, { ...empty, resolved }));
    // the 2nd row failed to parse: it is missing from holdings and listed as an issue
    const damaged = groww();
    const [lost] = damaged.holdings.splice(1, 1);
    damaged.issues.push({ line: lost!.line, field: 'Quantity', message: 'not a valid number' });
    const plan = planStatement(damaged, { ...empty, resolved, current });
    expect(plan.removalsSuppressed).toBe(true);
    expect(plan.removed).toEqual([]);
    expect(plan.counts).toMatchObject({ removed: 0, needsAttention: 1, unchanged: 10 });
  });

  it('two ISINs that resolve to one ticker are not merged silently', () => {
    const s = groww();
    const resolved = allResolved(s);
    resolved.set(s.holdings[1]!.isin!, { symbol: 'T0', exchange: 'NSE' });
    const plan = planStatement(s, { ...empty, resolved });
    expect(plan.rows).toHaveLength(10);
    expect(plan.issues).toEqual([
      expect.objectContaining({
        line: s.holdings[1]!.line,
        message: expect.stringMatching(/more than once/),
      }),
    ]);
  });
});

describe('planStatement — INDmoney US (tickers, first-purchase dates)', () => {
  it('uses the ticker directly and dates each lot at its first purchase', () => {
    const s = indmoney();
    const plan = planStatement(s, { ...empty, fxByDate: fxFor(s) });
    expect(plan.accountId).toBe('import:indmoney-us');
    expect(plan.counts).toMatchObject({
      total: 10,
      added: 9,
      skipped: 1,
      needsAttention: 0,
      unresolved: 0,
    });
    expect(plan.rows.find((r) => r.symbol === 'BF.B')).toMatchObject({
      instrumentId: 'US_EQUITY:BF.B',
      tradeDate: '2022-02-17',
      dateQuality: 'approximate',
      fxRate: '84.5',
      currency: 'USD',
      unresolved: false,
    });
    expect(plan.rows.find((r) => r.symbol === 'BA')!.warnings).toHaveLength(1);
  });

  it('asks for one exchange rate per distinct first-purchase date', () => {
    const s = indmoney();
    expect(statementFxDates(s)).toHaveLength(9);
    expect(statementFxDates(groww())).toEqual([]); // rupee holdings need none
  });

  it('a holding whose exchange rate is unknown is set aside, not removed', () => {
    const s = indmoney();
    const fx = fxFor(s);
    const first = planStatement(s, { ...empty, fxByDate: fx });
    const orcl = first.rows.find((r) => r.symbol === 'ORCL')!;

    // ORCL changed and its rate is missing now; everything else is as before
    const next = indmoney();
    next.holdings[0] = { ...next.holdings[0]!, quantity: '5' };
    const noRate = new Map<string, string | null>(fx);
    noRate.set(orcl.tradeDate, null);
    const plan = planStatement(next, {
      ...empty,
      fxByDate: noRate,
      current: asCurrent(first),
    });
    expect(plan.issues).toEqual([
      expect.objectContaining({ line: orcl.line, field: 'Holding Since' }),
    ]);
    expect(plan.removed).toEqual([]); // ORCL stays in the ledger as it was
    expect(plan.counts).toMatchObject({ unchanged: 8, changed: 0, added: 0, needsAttention: 1 });
  });

  it('unchanged rows need no exchange rate at all', () => {
    const s = indmoney();
    const first = planStatement(s, { ...empty, fxByDate: fxFor(s) });
    const again = planStatement(s, { ...empty, current: asCurrent(first) }); // empty fx map
    expect(again.counts).toMatchObject({ unchanged: 9, needsAttention: 0 });
  });
});

describe('statementRowToLedgerFields', () => {
  it('writes an opening lot with its date quality', () => {
    const s = indmoney();
    const plan = planStatement(s, { ...empty, fxByDate: fxFor(s) });
    expect(statementRowToLedgerFields(plan.rows[0]!, plan.accountId)).toEqual({
      accountId: 'import:indmoney-us',
      instrumentId: 'US_EQUITY:ORCL',
      type: 'OPENING_BALANCE',
      tradeDate: '2023-03-14',
      qty: '3.25817364',
      price: '104.338292',
      currency: 'USD',
      fxRate: '84.5',
      dateQuality: 'approximate',
    });
    const g = groww();
    const gp = planStatement(g, { ...empty, resolved: allResolved(g) });
    expect(statementRowToLedgerFields(gp.rows[0]!, gp.accountId)).toEqual({
      accountId: 'import:groww',
      instrumentId: 'IN_EQUITY:T0',
      type: 'OPENING_BALANCE',
      tradeDate: '2026-10-31',
      qty: '37',
      price: '318.46',
      currency: 'INR',
      dateQuality: 'unknown',
    });
  });
});

describe('the ledger a preview was planned against (BUG-018)', () => {
  it('lists every current lot, unchanged ones included, so confirm can tell it changed', () => {
    const s = groww();
    const first = planStatement(s, { ...empty, resolved: allResolved(s) });
    const current = asCurrent(first);
    const again = planStatement(s, { ...empty, resolved: allResolved(s), current });
    expect(again.counts.unchanged).toBe(11);
    expect(again.basis).toEqual(
      current.map((c) => ({ txnId: c.txnId, instrumentId: c.instrumentId })),
    );
    expect(first.basis).toEqual([]);
  });
});

describe('applyMappings: tickers typed for unresolved rows (BUG-019)', () => {
  const unresolvedPlan = () => {
    const s = groww();
    const resolved = allResolved(s);
    resolved.set(s.holdings[1]!.isin!, null);
    resolved.set(s.holdings[2]!.isin!, null);
    return planStatement(s, { ...empty, resolved });
  };

  it('moves a mapped row to the ticker and leaves the others as they are', () => {
    const plan = unresolvedPlan();
    const line = plan.rows[1]!.line;
    const rows = applyMappings(
      plan.rows,
      [{ line, symbol: 'abc', exchange: 'BSE' }],
      'groww',
      plan.accountId,
    );
    expect(rows[1]).toMatchObject({
      instrumentId: 'IN_EQUITY:BSE:ABC',
      symbol: 'ABC',
      exchange: 'BSE',
      unresolved: false,
    });
    expect(rows[1]!.fingerprint).not.toBe(plan.rows[1]!.fingerprint);
    expect(rows[2]).toEqual(plan.rows[2]);
    expect(rows[0]).toEqual(plan.rows[0]);
  });

  it('ignores a mapping for a row that already has a ticker', () => {
    const plan = unresolvedPlan();
    const rows = applyMappings(
      plan.rows,
      [{ line: plan.rows[0]!.line, symbol: 'XYZ' }],
      'groww',
      plan.accountId,
    );
    expect(rows[0]).toEqual(plan.rows[0]);
  });

  it('ignores a mapping for an unchanged row (it is not written again)', () => {
    const plan = unresolvedPlan();
    const again = planStatement(groww(), {
      ...empty,
      resolved: new Map(
        plan.rows.map((r) => [
          r.isin!,
          r.unresolved ? null : { symbol: r.symbol!, exchange: 'NSE' as const },
        ]),
      ),
      current: asCurrent(plan),
    });
    expect(again.rows[1]).toMatchObject({ status: 'unchanged', unresolved: true });
    const rows = applyMappings(
      again.rows,
      [{ line: again.rows[1]!.line, symbol: 'T0' }],
      'groww',
      again.accountId,
    );
    expect(rows).toEqual(again.rows);
  });

  it('refuses a ticker that is not one', () => {
    const plan = unresolvedPlan();
    expect(() =>
      applyMappings(
        plan.rows,
        [{ line: plan.rows[1]!.line, symbol: '../x?y=' }],
        'groww',
        plan.accountId,
      ),
    ).toThrow(/not a valid ticker/);
  });

  it('refuses two rows on one ticker: the account would hold two lots of one share', () => {
    const plan = unresolvedPlan();
    const [a, b] = [plan.rows[1]!.line, plan.rows[2]!.line];
    expect(() =>
      applyMappings(
        plan.rows,
        [
          { line: a, symbol: 'SAME' },
          { line: b, symbol: 'same' },
        ],
        'groww',
        plan.accountId,
      ),
    ).toThrow(/already/);
    // …or on the ticker of another row of the statement.
    expect(() =>
      applyMappings(plan.rows, [{ line: a, symbol: 'T0' }], 'groww', plan.accountId),
    ).toThrow(/already/);
  });
});
