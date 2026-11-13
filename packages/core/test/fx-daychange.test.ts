import { describe, expect, it } from 'vitest';
import {
  buildPositions,
  composeBook,
  dayChange,
  groupByInstrument,
  type InstrumentMeta,
  type LedgerTxn,
  positionKey,
  valuePosition,
} from '../src';

const A = 'manual';
const AAPL = 'US_EQUITY:AAPL';
const RIL = 'IN_EQUITY:INE002A01018';
const k = (i: string) => positionKey(A, i);

describe('USD holdings and FX attribution (docs/PLAN.md §6.5)', () => {
  const txns: LedgerTxn[] = [
    {
      id: '1',
      accountId: A,
      instrumentId: AAPL,
      type: 'BUY',
      tradeDate: '2024-01-02',
      qty: '10',
      price: '100',
      currency: 'USD',
      fxRate: '83',
    },
  ];
  const p = buildPositions(txns).positions[k(AAPL)]!;

  it('stores INR and USD cost per lot', () => {
    expect(p).toMatchObject({
      currency: 'USD',
      openCost: '83000',
      openCostCcy: '1000',
      avgCost: '8300',
      avgCostCcy: '100',
    });
    expect(p.lots[0]).toMatchObject({ unitCost: '8300', unitCostCcy: '100', fx: '83' });
  });

  it('$100 @ ₹83 → $110 @ ₹85: value 93,500 = stock 8,500 + FX 2,000', () => {
    expect(valuePosition(p, '110', '85')).toEqual({
      value: '93500',
      unrealised: '10500',
      unrealisedPct: 10500 / 83000,
      stockEffect: '8500',
      fxEffect: '2000',
    });
  });

  it('converts USD sale proceeds at the sale-date FX', () => {
    const r = buildPositions([
      ...txns,
      {
        id: '2',
        accountId: A,
        instrumentId: AAPL,
        type: 'SELL',
        tradeDate: '2024-06-03',
        qty: '4',
        price: '120',
        fees: '1',
        currency: 'USD',
        fxRate: '84',
      },
    ]).positions[k(AAPL)]!;
    // proceeds (480 − 1) × 84 = 40,236; cost 4 × 8,300 = 33,200 → realised 7,036
    expect(r.realised).toBe('7036');
    expect(r.cashflows).toEqual([
      ['2024-01-02', -83000],
      ['2024-06-03', 40236],
    ]);
  });

  it('rejects USD money events without an FX rate, and currency changes', () => {
    const { errors } = buildPositions([
      {
        id: 'a',
        accountId: A,
        instrumentId: AAPL,
        type: 'BUY',
        tradeDate: '2024-01-02',
        qty: '1',
        price: '1',
        currency: 'USD',
      },
      {
        id: 'b',
        accountId: A,
        instrumentId: RIL,
        type: 'BUY',
        tradeDate: '2024-01-02',
        qty: '1',
        price: '1',
      },
      {
        id: 'c',
        accountId: A,
        instrumentId: RIL,
        type: 'BUY',
        tradeDate: '2024-01-03',
        qty: '1',
        price: '1',
        currency: 'USD',
        fxRate: '83',
      },
    ]);
    expect(errors.map((e) => e.code)).toEqual(['MISSING_FX', 'CURRENCY_MISMATCH']);
  });
});

describe('day change', () => {
  const p = buildPositions([
    {
      id: '1',
      accountId: A,
      instrumentId: RIL,
      type: 'BUY',
      tradeDate: '2026-01-05',
      qty: '10',
      price: '90',
    },
  ]).positions[k(RIL)]!;

  it('10 units, prev close 100 → 102: +20 (+2.00%)', () => {
    expect(dayChange(p, { price: '102', prevClose: '100', asOf: '2026-11-06T10:00:00Z' })).toEqual({
      change: '20',
      pct: 0.02,
    });
  });

  it('a lot bought on the quote date moves from its buy price', () => {
    const today = buildPositions([
      {
        id: '1',
        accountId: A,
        instrumentId: RIL,
        type: 'BUY',
        tradeDate: '2026-11-06',
        qty: '10',
        price: '101',
      },
    ]).positions[k(RIL)]!;
    expect(
      dayChange(today, { price: '102', prevClose: '100', asOf: '2026-11-06T10:00:00Z' })?.change,
    ).toBe('10');
  });

  it('includes the FX move for USD holdings', () => {
    const usd = buildPositions([
      {
        id: '1',
        accountId: A,
        instrumentId: AAPL,
        type: 'BUY',
        tradeDate: '2024-01-02',
        qty: '10',
        price: '100',
        currency: 'USD',
        fxRate: '83',
      },
    ]).positions[k(AAPL)]!;
    // 10 × 102 × 85 − 10 × 100 × 84 = 86,700 − 84,000
    expect(
      dayChange(
        usd,
        { price: '102', prevClose: '100', asOf: '2026-11-06T21:00:00Z' },
        { rate: '85', prevRate: '84' },
      )?.change,
    ).toBe('2700');
  });

  it('is null without a previous close', () => {
    expect(dayChange(p, { price: '102', asOf: '2026-11-06' })).toBeNull();
  });
});

describe('composeBook with live quotes and FX', () => {
  const instruments: Record<string, InstrumentMeta> = {
    [AAPL]: { id: AAPL, name: 'Apple', assetClass: 'US_EQUITY', symbol: 'AAPL', currency: 'USD' },
    [RIL]: { id: RIL, name: 'Reliance', assetClass: 'IN_EQUITY', symbol: 'INE002A01018' },
  };
  const { positions } = buildPositions([
    {
      id: '1',
      accountId: A,
      instrumentId: AAPL,
      type: 'BUY',
      tradeDate: '2024-01-02',
      qty: '10',
      price: '100',
      currency: 'USD',
      fxRate: '83',
    },
    {
      id: '2',
      accountId: A,
      instrumentId: RIL,
      type: 'BUY',
      tradeDate: '2024-01-02',
      qty: '10',
      price: '2400',
    },
  ]);
  const prices = {
    [AAPL]: {
      price: '110',
      prevClose: '108',
      currency: 'USD' as const,
      asOf: '2026-11-06T21:00:00Z',
      source: 'finnhub',
      status: 'fresh' as const,
    },
    [RIL]: {
      price: '2500',
      prevClose: '2510',
      currency: 'INR' as const,
      asOf: '2026-11-06T10:00:00Z',
      source: 'manual',
      status: 'stale' as const,
    },
  };

  it('marks USD holdings unpriced when FX is unavailable', () => {
    const b = composeBook(positions, instruments, prices, '2026-11-09', null);
    expect(b.holdings[k(AAPL)]).toMatchObject({
      priceStatus: 'missing',
      xirrNote: 'NO_FX',
      value: null,
    });
    expect(b.totals.unpricedCount).toBe(1);
  });

  it('values, totals day change and counts stale prices', () => {
    const b = composeBook(positions, instruments, prices, '2026-11-09', {
      rate: '85',
      prevRate: '85',
      asOf: '2026-11-06',
      source: 'frankfurter-ecb',
      status: 'fresh',
    });
    expect(b.holdings[k(AAPL)]).toMatchObject({
      value: '93500',
      fxEffect: '2000',
      stockEffect: '8500',
      fxRate: '85',
      dayChange: '1700',
    });
    expect(b.holdings[k(RIL)]).toMatchObject({
      value: '25000',
      priceStatus: 'stale',
      dayChange: '-100',
    });
    expect(b.totals).toMatchObject({
      value: '118500',
      dayChange: '1600',
      staleCount: 1,
      unpricedCount: 0,
    });
    const rows = groupByInstrument(b.holdings);
    expect(rows.find((r) => r.instrumentId === AAPL)).toMatchObject({
      currency: 'USD',
      avgCostCcy: '100',
      fxEffect: '2000',
    });
  });
});
