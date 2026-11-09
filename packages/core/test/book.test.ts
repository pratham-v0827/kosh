import { describe, expect, it } from 'vitest';
import {
  buildPositions,
  composeBook,
  groupByInstrument,
  type InstrumentMeta,
  type LedgerTxn,
  positionKey,
} from '../src';

const instruments: Record<string, InstrumentMeta> = {
  'UNLISTED:acme': {
    id: 'UNLISTED:acme',
    name: 'Acme Pre-IPO',
    assetClass: 'UNLISTED',
    symbol: null,
  },
  'IN_EQUITY:INE002A01018': {
    id: 'IN_EQUITY:INE002A01018',
    name: 'Reliance Industries',
    assetClass: 'IN_EQUITY',
    symbol: 'INE002A01018',
  },
};

const txns: LedgerTxn[] = [
  {
    id: '1',
    accountId: 'manual',
    instrumentId: 'UNLISTED:acme',
    type: 'BUY',
    tradeDate: '2023-01-01',
    qty: '100',
    price: '200',
  },
  {
    id: '2',
    accountId: 'manual',
    instrumentId: 'IN_EQUITY:INE002A01018',
    type: 'BUY',
    tradeDate: '2024-01-01',
    qty: '10',
    price: '2400',
  },
  {
    id: '3',
    accountId: 'manual',
    instrumentId: 'IN_EQUITY:INE002A01018',
    type: 'SELL',
    tradeDate: '2024-02-01',
    qty: '4',
    price: '2500',
  },
];

describe('composeBook', () => {
  const { positions } = buildPositions(txns);
  const book = composeBook(
    positions,
    instruments,
    {
      'UNLISTED:acme': {
        price: '220',
        asOf: '2024-01-01',
        source: 'manual',
        currency: 'INR',
        status: 'fresh',
      },
    },
    '2024-01-01',
  );

  it('values priced holdings and leaves unpriced ones as null with a reason', () => {
    const acme = book.holdings[positionKey('manual', 'UNLISTED:acme')]!;
    expect(acme.value).toBe('22000');
    expect(acme.unrealised).toBe('2000');
    expect(acme.unrealisedPct).toBeCloseTo(0.1, 12);
    expect(acme.xirr).toBeCloseTo(0.1, 9); // 365 days, +10%
    expect(acme.cashflows).toEqual([{ d: '2023-01-01', a: -20000 }]);

    const ril = book.holdings[positionKey('manual', 'IN_EQUITY:INE002A01018')]!;
    expect(ril.value).toBeNull();
    expect(ril.xirrNote).toBe('NO_PRICE');
  });

  it('totals only priced holdings in value and P&L, but all open holdings in invested', () => {
    expect(book.totals).toMatchObject({
      invested: '34400', // 20,000 + 6 × 2,400
      value: '22000',
      pricedInvested: '20000',
      unrealised: '2000',
      realised: '400', // 4 × (2,500 − 2,400)
      holdingsCount: 2,
      unpricedCount: 1,
    });
    expect(book.totals.byAssetClass.UNLISTED).toEqual({
      invested: '20000',
      value: '22000',
      count: 1,
    });
    expect(book.totals.byAssetClass.IN_EQUITY).toEqual({ invested: '14400', value: '0', count: 1 });
  });

  it('groups the same instrument across accounts and computes weights over priced value', () => {
    const multi = buildPositions([
      ...txns,
      {
        id: '4',
        accountId: 'zerodha',
        instrumentId: 'UNLISTED:acme',
        type: 'BUY',
        tradeDate: '2023-06-01',
        qty: '50',
        price: '210',
      },
    ]).positions;
    const b = composeBook(
      multi,
      instruments,
      {
        'UNLISTED:acme': {
          price: '220',
          asOf: '2024-01-01',
          source: 'manual',
          currency: 'INR',
          status: 'fresh',
        },
      },
      '2024-01-01',
    );
    const rows = groupByInstrument(b.holdings);
    const acme = rows.find((r) => r.instrumentId === 'UNLISTED:acme')!;
    expect(acme.qty).toBe('150');
    expect(acme.invested).toBe('30500'); // 20,000 + 10,500
    expect(acme.value).toBe('33000');
    expect(acme.unrealised).toBe('2500');
    expect(acme.accounts).toHaveLength(2);
    expect(acme.weight).toBe(1); // the only priced holding
    expect(rows.find((r) => r.instrumentId !== 'UNLISTED:acme')!.weight).toBeNull();
    expect(rows[0]!.instrumentId).toBe('UNLISTED:acme'); // sorted by value
  });

  it('hides XIRR for holdings younger than 30 days', () => {
    const b = composeBook(
      positions,
      instruments,
      {
        'IN_EQUITY:INE002A01018': {
          price: '2500',
          asOf: '2024-01-10',
          source: 'manual',
          currency: 'INR',
          status: 'fresh',
        },
      },
      '2024-01-10',
    );
    expect(b.holdings[positionKey('manual', 'IN_EQUITY:INE002A01018')]!.xirrNote).toBe('TOO_SHORT');
  });
});
