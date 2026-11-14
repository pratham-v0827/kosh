// M3 import framework: what an import would do, decided without a database.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LedgerTxn } from '@kosh/core';
import { MAX_IMPORT_ROWS, type NormalisedImport, runImport } from '@kosh/parsers';
import { describe, expect, it } from 'vitest';
import {
  draftRowToLedgerFields,
  fxDatesNeeded,
  importAccountId,
  planImport,
  type PlanInputs,
} from '@/server/import-plan';

const ctx = { today: '2026-11-14', maxRows: MAX_IMPORT_ROWS };
const parse = (text: string): NormalisedImport =>
  runImport({ bytes: new TextEncoder().encode(text), fileName: 'x.csv' }, ctx);
const sample = () =>
  runImport(
    {
      bytes: readFileSync(
        resolve(import.meta.dirname, '../../../packages/parsers/fixtures/kosh-csv/sample.csv'),
      ),
      fileName: 'x.csv',
    },
    ctx,
  );

const HEADER =
  'date,type,asset_class,name,symbol,exchange,quantity,price,fees,amount,ratio,fx_rate,reference,note';
const empty: PlanInputs = {
  existingFingerprints: new Set(),
  existingInstrumentIds: new Set(),
  existingLedger: [],
  fxByDate: new Map(),
};

/** Turn a plan's new rows into ledger transactions, as confirm would. */
const asLedger = (plan: ReturnType<typeof planImport>): LedgerTxn[] =>
  plan.rows
    .filter((r) => r.status === 'new')
    .map((r, i) => ({ ...draftRowToLedgerFields(r, plan.accountId), id: `t${i}`, seq: i + 1 }));

describe('planImport', () => {
  it('first import of the fixture: everything is new', () => {
    const plan = planImport(sample(), empty);
    expect(plan.accountId).toBe(importAccountId('kosh'));
    expect(plan.counts).toEqual({ total: 9, new: 9, duplicate: 0, needsAttention: 0 });
    expect(plan.newInstrumentIds.sort()).toEqual([
      'CRYPTO:BTC',
      'IN_EQUITY:RELIANCE',
      'MUTUAL_FUND:120590',
      'UNLISTED:acme-technologies-pre-ipo-series-a',
      'US_EQUITY:AAPL',
    ]);
    expect(new Set(plan.rows.map((r) => r.fingerprint)).size).toBe(9); // identical SIP rows kept
  });

  it('re-importing the same file adds nothing (0 new rows)', () => {
    const first = planImport(sample(), empty);
    const again = planImport(sample(), {
      ...empty,
      existingFingerprints: new Set(first.rows.map((r) => r.fingerprint)),
      existingInstrumentIds: new Set(first.newInstrumentIds),
      existingLedger: asLedger(first),
    });
    expect(again.counts).toEqual({ total: 9, new: 0, duplicate: 9, needsAttention: 0 });
    expect(again.newInstrumentIds).toEqual([]);
  });

  it('a file that overlaps an earlier one adds only the rows that are new', () => {
    const jan = parse(`${HEADER}\n2024-01-05,buy,in_equity,Infosys,INFY,NSE,2,1500,,,,,A1,\n`);
    const first = planImport(jan, empty);
    const both = parse(
      `${HEADER}\n2024-01-05,buy,in_equity,Infosys,INFY,NSE,2,1500.00,,,,,A1,\n` +
        '2024-02-05,buy,in_equity,Infosys,INFY,NSE,3,1600,,,,,A2,\n',
    );
    const plan = planImport(both, {
      ...empty,
      existingFingerprints: new Set(first.rows.map((r) => r.fingerprint)),
      existingInstrumentIds: new Set(first.newInstrumentIds),
      existingLedger: asLedger(first),
    });
    expect(plan.rows.map((r) => [r.line, r.status])).toEqual([
      [2, 'duplicate'],
      [3, 'new'],
    ]);
    expect(plan.newInstrumentIds).toEqual([]);
  });

  it('sets aside rows the ledger cannot apply, and keeps the rest', () => {
    const text =
      `${HEADER}\n2024-01-05,buy,in_equity,Infosys,INFY,NSE,2,1500,,,,,,\n` +
      '2024-02-01,sell,in_equity,Infosys,INFY,NSE,5,1600,,,,,,\n' + // more than held
      '2024-03-01,sell,in_equity,Infosys,INFY,NSE,1,1700,,,,,,\n';
    const plan = planImport(parse(text), empty);
    expect(plan.rows.map((r) => r.line)).toEqual([2, 4]);
    expect(plan.issues).toHaveLength(1);
    expect(plan.issues[0]).toMatchObject({ line: 3 });
    expect(plan.counts).toEqual({ total: 3, new: 2, duplicate: 0, needsAttention: 1 });
  });

  it('a sale in the file can use units bought in an earlier import of the same source', () => {
    const buy = planImport(
      parse(`${HEADER}\n2024-01-05,buy,in_equity,Infosys,INFY,NSE,5,1500,,,,,B1,\n`),
      empty,
    );
    const sell = planImport(
      parse(`${HEADER}\n2024-06-05,sell,in_equity,Infosys,INFY,NSE,5,1800,,,,,S1,\n`),
      {
        ...empty,
        existingLedger: asLedger(buy),
        existingInstrumentIds: new Set(['IN_EQUITY:INFY']),
      },
    );
    expect(sell.counts.new).toBe(1);
    expect(sell.issues).toEqual([]);
  });

  it('USD rows use the stated rate, else the looked-up rate, else need attention', () => {
    const text =
      `${HEADER}\n2024-06-14,buy,us_equity,Apple Inc.,AAPL,,5,190,,,,83.45,,\n` +
      '2024-06-17,buy,us_equity,Apple Inc.,AAPL,,1,195,,,,,,\n' +
      '2024-06-18,buy,us_equity,Apple Inc.,AAPL,,1,196,,,,,,\n' +
      '2024-07-01,split,us_equity,Apple Inc.,AAPL,,,,,,1:2,,,\n';
    const parsed = parse(text);
    expect(fxDatesNeeded(parsed)).toEqual(['2024-06-17', '2024-06-18']); // not the stated one, not the split
    const plan = planImport(parsed, {
      ...empty,
      fxByDate: new Map([
        ['2024-06-17', '83.5'],
        ['2024-06-18', null],
      ]),
    });
    expect(plan.rows.map((r) => [r.line, r.fxRate])).toEqual([
      [2, '83.45'],
      [3, '83.5'],
      [5, undefined],
    ]);
    expect(plan.issues).toEqual([expect.objectContaining({ line: 4, field: 'fx_rate' })]);
  });

  it('ledger fields carry only ledger data', () => {
    const plan = planImport(sample(), empty);
    const fields = draftRowToLedgerFields(plan.rows[0]!, plan.accountId);
    expect(fields).toEqual({
      accountId: 'import:kosh',
      instrumentId: 'IN_EQUITY:RELIANCE',
      type: 'BUY',
      tradeDate: '2024-04-01',
      currency: 'INR',
      qty: '10',
      price: '2900.5',
      fees: '15.2',
    });
  });
});
