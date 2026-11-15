// Dashboard analytics with values worked out by hand (2023-01-01 → 2024-01-01 is 365 days, so a
// 10% gain over it is exactly 10% a year).
import { describe, expect, it } from 'vitest';
import {
  allocation,
  BENCHMARKS,
  benchmarkComparison,
  benchmarkXirr,
  buildPositions,
  combinedXirr,
  composeBook,
  datedFlows,
  geographyOf,
  groupByInstrument,
  type HoldingView,
  type IndexPoint,
  type InstrumentMeta,
  insights,
  kindOf,
  type LedgerTxn,
  portfolioXirr,
  type PriceInfo,
  seriesRange,
  type SeriesPoint,
  withCombinedXirr,
} from '../src';

const ASOF = '2024-01-01';
const GROWN_183 = 100 * 1.1 ** (183 / 365); // 100 grown at 10% a year for 183 days
// Values are stored rounded to the paisa, so a price that is not a round number lands within 1e-5.
const PAISA = 5;

let seq = 0;
const t = (x: Partial<LedgerTxn> & Pick<LedgerTxn, 'instrumentId' | 'tradeDate'>): LedgerTxn => ({
  id: `t${++seq}`,
  accountId: 'manual',
  type: 'BUY',
  qty: '10',
  price: '100',
  seq,
  ...x,
});
const meta = (id: string, m: Partial<InstrumentMeta> = {}): InstrumentMeta => ({
  id,
  name: id.split(':')[1]!,
  assetClass: (id.split(':')[0] as InstrumentMeta['assetClass']) ?? 'IN_EQUITY',
  symbol: id.split(':')[1]!,
  ...m,
});
const price = (p: number, currency: 'INR' | 'USD' = 'INR', prevClose?: number): PriceInfo => ({
  price: String(p),
  currency,
  asOf: `${ASOF}T10:00:00.000Z`,
  source: 'test',
  status: 'fresh',
  ...(prevClose ? { prevClose: String(prevClose) } : {}),
});
function book(
  txns: LedgerTxn[],
  prices: Record<string, PriceInfo>,
  extra: Record<string, Partial<InstrumentMeta>> = {},
  fx: { rate: string } | null = null,
) {
  const { positions, errors } = buildPositions(txns);
  expect(errors).toEqual([]);
  const ids = [...new Set(txns.map((x) => x.instrumentId))];
  const instruments = Object.fromEntries(ids.map((id) => [id, meta(id, extra[id])]));
  return composeBook(
    positions,
    instruments,
    prices,
    ASOF,
    fx ? { rate: fx.rate, asOf: ASOF, source: 'test', status: 'fresh' } : null,
  ).holdings;
}

describe('combinedXirr / portfolioXirr', () => {
  const X = 'IN_EQUITY:XXX';
  const Y = 'IN_EQUITY:YYY';
  const twoAtTenPercent = () => [
    t({ instrumentId: X, tradeDate: '2023-01-01' }),
    t({ instrumentId: Y, tradeDate: '2023-07-02' }),
  ];

  it('two holdings that each grew 10% a year give exactly 10%', () => {
    const h = book(twoAtTenPercent(), { [X]: price(110), [Y]: price(GROWN_183) });
    const r = portfolioXirr(h, ASOF);
    expect(r.reason).toBe('OK');
    expect(r.rate).toBeCloseTo(0.1, PAISA);
    expect(r).toMatchObject({
      included: 2,
      approximate: false,
      excluded: { noDates: 0, unpriced: 0 },
    });
  });

  it('leaves out holdings without purchase dates or without a price, and counts them', () => {
    const G = 'IN_EQUITY:GROWW1';
    const U = 'UNLISTED:ACME';
    const h = book(
      [
        ...twoAtTenPercent(),
        t({
          instrumentId: G,
          tradeDate: '2023-12-01',
          type: 'OPENING_BALANCE',
          dateQuality: 'unknown',
        }),
        t({ instrumentId: U, tradeDate: '2023-03-01' }),
      ],
      { [X]: price(110), [Y]: price(GROWN_183), [G]: price(500) },
    );
    const r = portfolioXirr(h, ASOF);
    expect(r.rate).toBeCloseTo(0.1, PAISA); // unchanged by the excluded holdings
    expect(r).toMatchObject({ included: 2, excluded: { noDates: 1, unpriced: 1 } });
  });

  it('marks the result approximate when a purchase date is only the first purchase', () => {
    const h = book(
      [
        t({
          instrumentId: X,
          tradeDate: '2023-01-01',
          type: 'OPENING_BALANCE',
          dateQuality: 'approximate',
        }),
      ],
      { [X]: price(110) },
    );
    expect(portfolioXirr(h, ASOF)).toMatchObject({ approximate: true, reason: 'OK' });
  });

  it('is too short within 30 days, and empty without any dated holding', () => {
    const recent = book([t({ instrumentId: X, tradeDate: '2023-12-20' })], { [X]: price(101) });
    expect(portfolioXirr(recent, ASOF)).toMatchObject({ reason: 'TOO_SHORT', rate: null });
    const undated = book(
      [
        t({
          instrumentId: X,
          tradeDate: '2023-01-01',
          type: 'OPENING_BALANCE',
          dateQuality: 'unknown',
        }),
      ],
      { [X]: price(110) },
    );
    expect(portfolioXirr(undated, ASOF)).toMatchObject({ reason: 'NO_DATA', rate: null });
    expect(portfolioXirr({}, ASOF).reason).toBe('NO_DATA');
  });

  it('counts closed positions: a round trip at 10% a year', () => {
    const h = book(
      [
        t({ instrumentId: X, tradeDate: '2023-01-01' }),
        t({ instrumentId: X, tradeDate: '2024-01-01', type: 'SELL', price: '110' }),
      ],
      {},
    );
    expect(portfolioXirr(h, ASOF).rate).toBeCloseTo(0.1, 9);
  });

  it('in the holding currency, a US stock is measured without the rupee move', () => {
    const A = 'US_EQUITY:AAA';
    const h = book(
      [t({ instrumentId: A, tradeDate: '2023-01-01', currency: 'USD', fxRate: '80' })],
      { [A]: price(110, 'USD') },
      {},
      { rate: '90' },
    );
    const list = Object.values(h);
    // dollars: 1,000 → 1,100 = 10%; rupees: 80,000 → 99,000 = 23.75%
    expect(combinedXirr(list, ASOF, { currency: 'native' }).rate).toBeCloseTo(0.1, 9);
    expect(combinedXirr(list, ASOF).rate).toBeCloseTo(0.2375, 9);
  });
});

describe('consolidation across accounts', () => {
  const X = 'IN_EQUITY:XXX';

  it('one row per stock, with each account and a combined XIRR', () => {
    const h = book(
      [
        t({ instrumentId: X, tradeDate: '2023-01-01', accountId: 'import:groww' }),
        t({ instrumentId: X, tradeDate: '2023-01-01', accountId: 'manual', qty: '5' }),
      ],
      { [X]: price(110) },
    );
    const rows = withCombinedXirr(groupByInstrument(h), h, ASOF);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r).toMatchObject({ qty: '15', invested: '1500', value: '1650', dateQuality: 'exact' });
    expect(r.accounts).toEqual([
      {
        accountId: 'import:groww',
        qty: '10',
        invested: '1000',
        value: '1100',
        avgCostCcy: '100',
        dateQuality: 'exact',
      },
      {
        accountId: 'manual',
        qty: '5',
        invested: '500',
        value: '550',
        avgCostCcy: '100',
        dateQuality: 'exact',
      },
    ]);
    expect(r.xirr.rate).toBeCloseTo(0.1, 9);
  });

  it('weighted average cost across accounts, and the least certain date wins', () => {
    const h = book(
      [
        t({ instrumentId: X, tradeDate: '2023-01-01', accountId: 'a', qty: '10', price: '100' }),
        t({
          instrumentId: X,
          tradeDate: '2023-06-01',
          accountId: 'b',
          qty: '30',
          price: '120',
          type: 'OPENING_BALANCE',
          dateQuality: 'unknown',
        }),
      ],
      { [X]: price(130) },
    );
    const [r] = withCombinedXirr(groupByInstrument(h), h, ASOF);
    // (10 × 100 + 30 × 120) / 40 = 115
    expect(r).toMatchObject({ avgCost: '115', dateQuality: 'unknown' });
    expect(r!.xirr).toMatchObject({ included: 1, excluded: { noDates: 1, unpriced: 0 } });
  });
});

describe('allocation', () => {
  const holdings = () =>
    book(
      [
        t({ instrumentId: 'IN_EQUITY:AAA', tradeDate: '2023-01-01', accountId: 'import:groww' }),
        t({
          instrumentId: 'IN_EQUITY:NIFTYETF',
          tradeDate: '2023-01-01',
          accountId: 'import:groww',
        }),
        t({
          instrumentId: 'US_EQUITY:BBB',
          tradeDate: '2023-01-01',
          accountId: 'import:indmoney-us',
          currency: 'USD',
          fxRate: '80',
          qty: '1',
        }),
        t({ instrumentId: 'CRYPTO:BTC', tradeDate: '2023-01-01', qty: '1' }),
        t({ instrumentId: 'UNLISTED:ACME', tradeDate: '2023-01-01' }),
      ],
      {
        'IN_EQUITY:AAA': price(150),
        'IN_EQUITY:NIFTYETF': price(110),
        'US_EQUITY:BBB': price(100, 'USD'),
        'CRYPTO:BTC': price(240),
      },
      {
        'IN_EQUITY:NIFTYETF': { instrumentType: 'ETF' },
        'IN_EQUITY:AAA': { instrumentType: 'STOCK' },
      },
      { rate: '80' },
    );

  it('by account, with value and cost shares that each add up to 1', () => {
    const slices = allocation(holdings(), 'account');
    expect(slices.map((s) => [s.key, s.value, s.invested, s.count, s.unpriced])).toEqual([
      ['import:indmoney-us', '8000', '8000', 1, 0],
      ['import:groww', '2600', '2000', 2, 0],
      ['manual', '240', '1100', 2, 1], // ACME has no price: in cost, not in value
    ]);
    const sum = (k: 'valueWeight' | 'costWeight') => slices.reduce((s, x) => s + (x[k] ?? 0), 0);
    expect(sum('valueWeight')).toBeCloseTo(1, 12);
    expect(sum('costWeight')).toBeCloseTo(1, 12);
  });

  it('by geography and by kind', () => {
    expect(allocation(holdings(), 'geography').map((s) => s.key)).toEqual(['US', 'IN', 'GLOBAL']);
    expect(allocation(holdings(), 'instrumentType').map((s) => [s.key, s.count])).toEqual([
      ['STOCK', 2],
      ['ETF', 1],
      ['CRYPTO', 1],
      ['UNLISTED', 1], // no price: last, ordered by cost
    ]);
    expect(geographyOf('MUTUAL_FUND')).toBe('IN');
    expect(kindOf({ assetClass: 'MUTUAL_FUND' })).toBe('MUTUAL_FUND');
    expect(kindOf({ assetClass: 'IN_EQUITY' })).toBe('STOCK'); // no type recorded: a share
  });

  it('by market cap covers Indian shares only; unknown ones are unclassified', () => {
    const h = holdings();
    expect(allocation(h, 'marketCap').map((s) => [s.key, s.count])).toEqual([['UNCLASSIFIED', 1]]);
    const cap = allocation(h, 'marketCap', {
      marketCap: (x) => (x.symbol === 'AAA' ? 'LARGE' : null),
    });
    expect(cap.map((s) => [s.key, s.valueWeight])).toEqual([['LARGE', 1]]);
  });

  it('by asset class, ignoring closed positions', () => {
    const h = book(
      [
        t({ instrumentId: 'IN_EQUITY:AAA', tradeDate: '2023-01-01' }),
        t({ instrumentId: 'IN_EQUITY:AAA', tradeDate: '2023-02-01', type: 'SELL', price: '120' }),
        t({ instrumentId: 'MUTUAL_FUND:123', tradeDate: '2023-01-01' }),
      ],
      { 'MUTUAL_FUND:123': price(105) },
    );
    expect(allocation(h, 'assetClass')).toEqual([
      {
        key: 'MUTUAL_FUND',
        value: '1050',
        invested: '1000',
        valueWeight: 1,
        costWeight: 1,
        count: 1,
        unpriced: 0,
      },
    ]);
    expect(allocation({}, 'assetClass')).toEqual([]);
  });
});

describe('insights', () => {
  it('top movers, concentration and holding period, all descriptive', () => {
    const h = book(
      [
        t({ instrumentId: 'IN_EQUITY:UP', tradeDate: '2022-06-01' }), // held > 1 year
        t({ instrumentId: 'IN_EQUITY:DOWN', tradeDate: '2023-10-01' }), // < 1 year
        t({ instrumentId: 'IN_EQUITY:FLAT', tradeDate: '2023-10-01' }),
        t({
          instrumentId: 'IN_EQUITY:NODATE',
          tradeDate: '2023-10-01',
          type: 'OPENING_BALANCE',
          dateQuality: 'unknown',
        }),
      ],
      {
        'IN_EQUITY:UP': price(150, 'INR', 140),
        'IN_EQUITY:DOWN': price(90, 'INR', 100),
        'IN_EQUITY:FLAT': price(100, 'INR', 100),
        'IN_EQUITY:NODATE': price(100),
      },
    );
    const rows = groupByInstrument(h);
    const i = insights(rows, h, ASOF, { threshold: 0.3 });
    expect(i.gainers.map((r) => r.symbol)).toEqual(['UP']);
    expect(i.losers.map((r) => r.symbol)).toEqual(['DOWN']);
    expect(i.concentrated.map((r) => r.symbol)).toEqual(['UP']); // 1,500 of 4,400 = 34%
    expect(i.holdingPeriod).toEqual({ longTerm: '1500', shortTerm: '1900', unknown: '1000' });
    expect(insights(rows, h, ASOF).threshold).toBe(0.1);
  });

  it('splits a holding bought in two lots across the one-year line', () => {
    const h = book(
      [
        t({ instrumentId: 'IN_EQUITY:AAA', tradeDate: '2022-12-01', qty: '30' }),
        t({ instrumentId: 'IN_EQUITY:AAA', tradeDate: '2023-12-01', qty: '10' }),
      ],
      { 'IN_EQUITY:AAA': price(100) },
    );
    expect(insights(groupByInstrument(h), h, ASOF).holdingPeriod).toEqual({
      longTerm: '3000',
      shortTerm: '1000',
      unknown: '0',
    });
  });
});

describe('benchmarkXirr (the same money in the index)', () => {
  const index: IndexPoint[] = [
    { date: '2022-12-30', close: 100 }, // last trading day before 2023-01-01
    { date: '2023-07-03', close: 105 },
    { date: '2024-01-01', close: 110 },
  ];

  it('one purchase: the index return over the same period', () => {
    const r = benchmarkXirr([{ d: '2023-01-01', a: -1000 }], index, ASOF);
    expect(r.ok && r.rate).toBeCloseTo(0.1, 9); // 100 → 110 over exactly a year
  });

  it('a sale moves money out of the index on the same day', () => {
    // buy 10 units at 100; on 2023-07-03 sell 5 units' worth at 105 (= 525); 5 left at 110
    const flows = [
      { d: '2023-01-01', a: -1000 },
      { d: '2023-07-03', a: 525 },
    ];
    const r = benchmarkXirr(flows, index, ASOF);
    expect(r.ok).toBe(true);
    // the index is 10% up over the year, so the money-weighted return is close to 10%
    expect(r.ok && r.rate).toBeGreaterThan(0.09);
    expect(r.ok && r.rate).toBeLessThan(0.11);
  });

  it('needs index data on or before every flow', () => {
    expect(benchmarkXirr([{ d: '2022-01-01', a: -1000 }], index, ASOF)).toEqual({
      ok: false,
      reason: 'NO_INDEX_DATA',
    });
    expect(benchmarkXirr([], index, ASOF)).toEqual({ ok: false, reason: 'NO_FLOWS' });
    expect(benchmarkXirr([{ d: '2023-01-01', a: -1 }], [], ASOF)).toEqual({
      ok: false,
      reason: 'NO_INDEX_DATA',
    });
  });

  it('datedFlows merges by day, skips undated holdings, and can use the holding currency', () => {
    const h = book(
      [
        t({ instrumentId: 'IN_EQUITY:AAA', tradeDate: '2023-01-01' }),
        t({ instrumentId: 'IN_EQUITY:BBB', tradeDate: '2023-01-01', qty: '5' }),
        t({
          instrumentId: 'IN_EQUITY:CCC',
          tradeDate: '2023-03-01',
          type: 'OPENING_BALANCE',
          dateQuality: 'unknown',
        }),
        t({
          instrumentId: 'US_EQUITY:USA',
          tradeDate: '2023-02-01',
          currency: 'USD',
          fxRate: '80',
          qty: '1',
        }),
      ],
      {},
    );
    const list: HoldingView[] = Object.values(h);
    expect(datedFlows(list)).toEqual([
      { d: '2023-01-01', a: -1500 },
      { d: '2023-02-01', a: -8000 },
    ]);
    expect(
      datedFlows(
        list.filter((x) => x.currency === 'USD'),
        'native',
      ),
    ).toEqual([{ d: '2023-02-01', a: -100 }]);
  });
});

describe('groupByInstrument: one share bought on NSE and on BSE (BUG-016)', () => {
  // The same company bought on two exchanges is one holding, not two identical-looking rows.
  const NSE = 'IN_EQUITY:TCS';
  const BSE = 'IN_EQUITY:BSE:TCS';
  const h = book(
    [
      t({ instrumentId: BSE, tradeDate: '2023-01-01', qty: '5', price: '3000' }),
      t({ instrumentId: NSE, tradeDate: '2023-06-01', accountId: 'import:kosh', qty: '5' }),
      t({ instrumentId: 'IN_EQUITY:BSE:OTHER', tradeDate: '2023-01-01' }),
    ],
    { [NSE]: price(3300), [BSE]: price(3310), 'IN_EQUITY:BSE:OTHER': price(100) },
    { [BSE]: { symbol: 'TCS', name: 'TCS' }, 'IN_EQUITY:BSE:OTHER': { symbol: 'OTHER' } },
  );

  it('merges the listings into one row, keyed and priced by the NSE listing', () => {
    const rows = groupByInstrument(h);
    const tcs = rows.filter((r) => r.symbol === 'TCS');
    expect(tcs).toHaveLength(1);
    const r = tcs[0]!;
    expect(r.instrumentId).toBe(NSE);
    expect(r.instrumentIds).toEqual([NSE, BSE]);
    expect(r.qty).toBe('10');
    expect(r.invested).toBe('15500'); // 5 × 3000 + 5 × 100
    expect(r.value).toBe('33050'); // each listing at its own price: 5 × 3300 + 5 × 3310
    expect(r.price?.price).toBe('3300');
    expect(r.accounts.map((a) => a.accountId).sort()).toEqual(['import:kosh', 'manual']);
  });

  it('a share held only on BSE keeps its own id', () => {
    const other = groupByInstrument(h).find((r) => r.symbol === 'OTHER')!;
    expect(other.instrumentId).toBe('IN_EQUITY:BSE:OTHER');
    expect(other.instrumentIds).toEqual(['IN_EQUITY:BSE:OTHER']);
  });
});

describe('benchmarkComparison (each market against its own index)', () => {
  const nifty: IndexPoint[] = [
    { date: '2022-12-30', close: 100 },
    { date: '2024-01-01', close: 110 },
  ];
  // 4000 on the last close before 2023-02-01, 4400 now: +10% over 334 days
  const sp: IndexPoint[] = [
    { date: '2023-01-31', close: 4000 },
    { date: '2024-01-01', close: 4400 },
  ];
  const TEN_PCT_334 = 1.1 ** (365 / 334) - 1;

  it('Indian holdings vs Nifty 50 and Sensex in rupees; US holdings vs the S&P 500 in dollars', () => {
    const h = book(
      [
        t({ instrumentId: 'IN_EQUITY:AAA', tradeDate: '2023-01-01' }), // 1000 → 1210
        t({
          instrumentId: 'US_EQUITY:USA',
          tradeDate: '2023-02-01',
          currency: 'USD',
          fxRate: '80',
          qty: '1',
        }), // $100 → $110
        t({ instrumentId: 'CRYPTO:BTC', tradeDate: '2023-01-01' }), // no index to compare with
        t({
          instrumentId: 'IN_EQUITY:CCC',
          tradeDate: '2023-03-01',
          type: 'OPENING_BALANCE',
          dateQuality: 'unknown',
        }),
        t({ instrumentId: 'IN_EQUITY:DDD', tradeDate: '2023-01-01' }), // no price: left out
      ],
      {
        'IN_EQUITY:AAA': price(121),
        'US_EQUITY:USA': price(110, 'USD'),
        'CRYPTO:BTC': price(1),
        'IN_EQUITY:CCC': price(100),
      },
      {},
      { rate: '90' },
    );
    const c = benchmarkComparison(h, ASOF, { NIFTY50: nifty, SP500: sp });
    expect(c.map((g) => [g.market, g.currency])).toEqual([
      ['IN', 'INR'],
      ['US', 'USD'],
    ]);

    const [india, us] = c;
    expect(india!.portfolio.rate).toBeCloseTo(0.21, PAISA);
    expect(india!.portfolio.excluded).toEqual({ noDates: 1, unpriced: 1 });
    // Only AAA's 1000 is invested in the index (DDD is left out on both sides): 100 → 110.
    expect(india!.benchmarks).toEqual([
      { id: 'NIFTY50', result: { ok: true, rate: expect.closeTo(0.1, 9) } },
      { id: 'SENSEX', result: { ok: false, reason: 'NO_INDEX_DATA' } },
    ]);

    expect(us!.portfolio.rate).toBeCloseTo(TEN_PCT_334, PAISA);
    expect(us!.benchmarks).toEqual([
      { id: 'SP500', result: { ok: true, rate: expect.closeTo(TEN_PCT_334, 9) } },
    ]);
  });

  it('a market with no holdings is left out', () => {
    const h = book([t({ instrumentId: 'IN_EQUITY:AAA', tradeDate: '2023-01-01' })], {
      'IN_EQUITY:AAA': price(110),
    });
    expect(benchmarkComparison(h, ASOF, {}).map((g) => g.market)).toEqual(['IN']);
  });

  it('every benchmark names its Yahoo symbol and currency', () => {
    expect(BENCHMARKS).toEqual({
      NIFTY50: { symbol: '^NSEI', currency: 'INR', market: 'IN' },
      SENSEX: { symbol: '^BSESN', currency: 'INR', market: 'IN' },
      SP500: { symbol: '^GSPC', currency: 'USD', market: 'US' },
    });
  });
});

describe('seriesRange', () => {
  const day = (n: number) =>
    new Date(Date.UTC(2023, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);
  // daily from 2023-01-01 to 2024-01-01: value grows by 1 a day, 500 deposited on day 300
  const points: SeriesPoint[] = Array.from({ length: 366 }, (_, n) => ({
    date: day(n),
    value: 1000 + n + (n >= 300 ? 500 : 0),
    invested: 1000 + (n >= 300 ? 500 : 0),
  }));

  it('keeps the point before the range so the chart starts on time', () => {
    const v = seriesRange(points, '1M', ASOF);
    expect(v.points[0]!.date).toBe('2023-12-01'); // the day before the 30-day window
    expect(v.points.at(-1)!.date).toBe(ASOF);
    expect(v.points).toHaveLength(32);
  });

  it('gain leaves out new deposits', () => {
    const v = seriesRange(points, '1Y', ASOF);
    // value 1000 → 1865 includes a 500 deposit: the gain is 365
    expect(v.gain).toBe(365);
    expect(v.gainPct).toBeCloseTo(0.365, 12);
    expect(seriesRange(points, 'ALL', ASOF).points).toHaveLength(366);
  });

  it('a range with a single point has no gain', () => {
    expect(seriesRange(points.slice(-1), '1W', ASOF)).toMatchObject({ gain: null, gainPct: null });
    expect(seriesRange([], 'ALL', ASOF)).toEqual({ points: [], gain: null, gainPct: null });
    const old = seriesRange(points.slice(0, 10), '1W', ASOF);
    expect(old.points).toHaveLength(1); // nothing recent: only the latest known point
  });
});
