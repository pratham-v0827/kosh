// Holdings imported from a statement have no trade history: the purchase date is either the
// first-purchase date (approximate) or not known at all. Returns that depend on dates must say so.
import { describe, expect, it } from 'vitest';
import {
  buildPositions,
  composeBook,
  type InstrumentMeta,
  type LedgerTxn,
  positionKey,
  type PriceInfo,
} from '../src';

const A = 'import:groww';
const I = 'IN_EQUITY:ITC';
const instruments: Record<string, InstrumentMeta> = {
  [I]: { id: I, name: 'ITC', assetClass: 'IN_EQUITY', symbol: 'ITC' },
};
const price: PriceInfo = {
  price: '500',
  currency: 'INR',
  asOf: '2026-11-13T10:00:00.000Z',
  source: 'yahoo-unofficial',
  status: 'fresh',
};
const lot = (x: Partial<LedgerTxn>): LedgerTxn => ({
  id: Math.random().toString(36),
  accountId: A,
  instrumentId: I,
  type: 'OPENING_BALANCE',
  tradeDate: '2025-01-01',
  qty: '10',
  price: '400',
  ...x,
});
const holding = (txns: LedgerTxn[]) => {
  const { positions, errors } = buildPositions(txns);
  expect(errors).toEqual([]);
  return composeBook(positions, instruments, { [I]: price }, '2026-11-14', null).holdings[
    positionKey(A, I)
  ]!;
};

describe('date quality of a position', () => {
  it('is exact by default, and XIRR is computed', () => {
    const h = holding([lot({ type: 'BUY' })]);
    expect(h.dateQuality).toBe('exact');
    expect(h.xirr).toBeGreaterThan(0);
    expect(h.xirrNote).toBeNull();
  });

  it('unknown purchase date: value and P&L are exact, XIRR is withheld with a reason', () => {
    const h = holding([lot({ tradeDate: '2026-01-31', dateQuality: 'unknown' })]);
    expect(h.dateQuality).toBe('unknown');
    expect(h.value).toBe('5000');
    expect(h.unrealised).toBe('1000');
    expect(h.xirr).toBeNull();
    expect(h.xirrNote).toBe('NO_DATES');
  });

  it('approximate date: XIRR is computed and the position is marked approximate', () => {
    const h = holding([lot({ dateQuality: 'approximate' })]);
    expect(h.dateQuality).toBe('approximate');
    expect(h.xirr).toBeGreaterThan(0);
    expect(h.xirrNote).toBeNull();
  });

  it('the least certain lot decides', () => {
    expect(
      holding([lot({ type: 'BUY' }), lot({ tradeDate: '2025-06-01', dateQuality: 'approximate' })])
        .dateQuality,
    ).toBe('approximate');
    expect(
      holding([
        lot({ dateQuality: 'approximate' }),
        lot({ tradeDate: '2025-06-01', dateQuality: 'unknown' }),
        lot({ type: 'BUY', tradeDate: '2025-07-01' }),
      ]).dateQuality,
    ).toBe('unknown');
  });

  it('a missing price still explains itself first', () => {
    const { positions } = buildPositions([lot({ dateQuality: 'unknown' })]);
    const h = composeBook(positions, instruments, {}, '2026-11-14', null).holdings[
      positionKey(A, I)
    ]!;
    expect(h.xirrNote).toBe('NO_PRICE');
  });
});
