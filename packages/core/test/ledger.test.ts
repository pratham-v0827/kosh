import { describe, expect, it } from 'vitest';
import { buildPositions, type LedgerTxn, positionKey, positionXirr, valuePosition } from '../src';

const A = 'manual';
const I = 'INE002A01018';
const key = positionKey(A, I);
let n = 0;
const t = (x: Omit<LedgerTxn, 'id' | 'accountId' | 'instrumentId'>): LedgerTxn => ({
  id: `t${++n}`,
  accountId: A,
  instrumentId: I,
  ...x,
});

describe('buildPositions — FIFO (docs/PLAN.md §6.5)', () => {
  const base = [
    t({ type: 'BUY', tradeDate: '2024-01-10', qty: '10', price: '100' }),
    t({ type: 'BUY', tradeDate: '2024-02-10', qty: '10', price: '120' }),
    t({ type: 'SELL', tradeDate: '2024-03-10', qty: '15', price: '150' }),
  ];

  it('realises 650 and leaves 5 @120 (cost 600)', () => {
    const { positions, errors } = buildPositions(base);
    const p = positions[key]!;
    expect(errors).toEqual([]);
    expect(p.realised).toBe('650');
    expect(p.qty).toBe('5');
    expect(p.openCost).toBe('600');
    expect(p.avgCost).toBe('120');
    expect(p.lots).toEqual([{ date: '2024-02-10', qty: '5', unitCost: '120' }]);
  });

  it('applies a 1:2 split → 10 @60, cost unchanged', () => {
    const p = buildPositions([
      ...base,
      t({ type: 'SPLIT', tradeDate: '2024-04-01', ratio: { from: 1, to: 2 } }),
    ]).positions[key]!;
    expect(p.qty).toBe('10');
    expect(p.openCost).toBe('600');
    expect(p.avgCost).toBe('60');
  });

  it('applies a 1:1 bonus → 10 units, cost 600, avg 60', () => {
    const p = buildPositions([
      ...base,
      t({ type: 'BONUS', tradeDate: '2024-04-01', ratio: { from: 1, to: 1 } }),
    ]).positions[key]!;
    expect(p.qty).toBe('10');
    expect(p.openCost).toBe('600');
    expect(p.avgCost).toBe('60');
    expect(p.lots.at(-1)).toEqual({ date: '2024-04-01', qty: '5', unitCost: '0' });
  });

  it('is independent of input order', () => {
    const a = buildPositions(base).positions[key];
    const b = buildPositions([...base].reverse()).positions[key];
    expect(b).toEqual(a);
  });

  it('applies same-day corporate actions before trades', () => {
    const p = buildPositions([
      t({ type: 'BUY', tradeDate: '2024-01-01', qty: '10', price: '100' }),
      // listed first, but on the ex-date the sale is of post-split units
      t({ type: 'SELL', tradeDate: '2024-02-01', qty: '20', price: '55' }),
      t({ type: 'SPLIT', tradeDate: '2024-02-01', ratio: { from: 1, to: 2 } }),
    ]).positions[key]!;
    expect(p.qty).toBe('0');
    expect(p.realised).toBe('100'); // 20 × 55 − 1000
  });
});

describe('buildPositions — fees, cash events, cash flows', () => {
  it('adds buy fees to cost and deducts sell fees from proceeds', () => {
    const p = buildPositions([
      t({ type: 'BUY', tradeDate: '2024-01-01', qty: '10', price: '100', fees: '20' }),
      t({ type: 'SELL', tradeDate: '2024-06-01', qty: '4', price: '150', fees: '10' }),
    ]).positions[key]!;
    // unit cost 102; sold 4 → cost 408; proceeds 600 − 10 = 590 → realised 182
    expect(p.realised).toBe('182');
    expect(p.openCost).toBe('612');
    expect(p.fees).toBe('30');
    expect(p.cashflows).toEqual([
      ['2024-01-01', -1020],
      ['2024-06-01', 590],
    ]);
  });

  it('aggregates same-day cash flows and records dividends', () => {
    const p = buildPositions([
      t({ type: 'BUY', tradeDate: '2024-01-01', qty: '1', price: '100' }),
      t({ type: 'BUY', tradeDate: '2024-01-01', qty: '1', price: '110' }),
      t({ type: 'DIVIDEND', tradeDate: '2024-03-01', amount: '5' }),
    ]).positions[key]!;
    expect(p.dividends).toBe('5');
    expect(p.cashflows).toEqual([
      ['2024-01-01', -210],
      ['2024-03-01', 5],
    ]);
  });

  it('keeps fully sold positions with qty 0 so realised P&L is not lost', () => {
    const p = buildPositions([
      t({ type: 'BUY', tradeDate: '2024-01-01', qty: '3', price: '10' }),
      t({ type: 'SELL', tradeDate: '2024-02-01', qty: '3', price: '12' }),
    ]).positions[key]!;
    expect(p.qty).toBe('0');
    expect(p.avgCost).toBe('0');
    expect(p.realised).toBe('6');
  });

  it('supports fractional quantities exactly (no float drift)', () => {
    const p = buildPositions([
      t({ type: 'BUY', tradeDate: '2024-01-01', qty: '0.1', price: '0.2' }),
      t({ type: 'BUY', tradeDate: '2024-01-02', qty: '0.2', price: '0.1' }),
    ]).positions[key]!;
    expect(p.qty).toBe('0.3');
    expect(p.openCost).toBe('0.04');
  });

  it('separates positions per account and instrument', () => {
    const { positions } = buildPositions([
      {
        ...t({ type: 'BUY', tradeDate: '2024-01-01', qty: '1', price: '1' }),
        accountId: 'zerodha',
      },
      { ...t({ type: 'BUY', tradeDate: '2024-01-01', qty: '2', price: '1' }), accountId: 'groww' },
    ]);
    expect(Object.keys(positions).sort()).toEqual([
      positionKey('groww', I),
      positionKey('zerodha', I),
    ]);
  });
});

describe('buildPositions — validation', () => {
  it('rejects a sell larger than the holding and skips it entirely', () => {
    const sell = t({ type: 'SELL', tradeDate: '2024-02-01', qty: '11', price: '1' });
    const { positions, errors } = buildPositions([
      t({ type: 'BUY', tradeDate: '2024-01-01', qty: '10', price: '1' }),
      sell,
    ]);
    expect(errors).toEqual([
      expect.objectContaining({ txnId: sell.id, code: 'SELL_EXCEEDS_HOLDING' }),
    ]);
    expect(positions[key]!.qty).toBe('10');
  });

  it('rejects a sell dated before the buy', () => {
    const { errors } = buildPositions([
      t({ type: 'SELL', tradeDate: '2023-12-31', qty: '1', price: '1' }),
      t({ type: 'BUY', tradeDate: '2024-01-01', qty: '1', price: '1' }),
    ]);
    expect(errors[0]?.code).toBe('SELL_EXCEEDS_HOLDING');
  });

  it('rejects missing or non-positive values and bad ratios', () => {
    const { errors } = buildPositions([
      t({ type: 'BUY', tradeDate: '2024-01-01', qty: '0', price: '1' }),
      t({ type: 'BUY', tradeDate: '2024-01-01', price: '1' }),
      t({ type: 'SPLIT', tradeDate: '2024-01-02', ratio: { from: 0, to: 2 } }),
      t({ type: 'BONUS', tradeDate: '2024-01-02', ratio: { from: 1, to: 1 } }),
      t({ type: 'DIVIDEND', tradeDate: '2024-01-03', amount: '-1' }),
    ]);
    expect(errors.map((e) => e.code)).toEqual([
      'NON_POSITIVE_VALUE',
      'MISSING_FIELD',
      'INVALID_RATIO',
      'NO_HOLDING_FOR_ACTION',
      'NON_POSITIVE_VALUE',
    ]);
  });
});

describe('valuation', () => {
  const p = buildPositions([t({ type: 'BUY', tradeDate: '2023-01-01', qty: '10', price: '100' })])
    .positions[key]!;

  it('values a position at a price', () => {
    expect(valuePosition(p, '110')).toEqual({
      value: '1100',
      unrealised: '100',
      unrealisedPct: 0.1,
    });
  });

  it('returns null % when open cost is zero', () => {
    const bonusOnly = { ...p, openCost: '0' };
    expect(valuePosition(bonusOnly, '1').unrealisedPct).toBeNull();
  });

  it('computes XIRR with the current value as the final flow', () => {
    const r = positionXirr(p, '1100', '2024-01-01');
    expect(r.ok && r.rate).toBeCloseTo(0.1, 9);
  });
});
