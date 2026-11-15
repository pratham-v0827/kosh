import { describe, expect, it } from 'vitest';
import { allocation, type HoldingView, MARKET_CAP_LIST, marketCapOf } from '../src';

type Probe = Pick<HoldingView, 'instrumentId' | 'assetClass' | 'symbol' | 'isin'>;
const share = (instrumentId: string, o: Partial<Probe> = {}): Probe => ({
  instrumentId,
  assetClass: 'IN_EQUITY',
  symbol: instrumentId.split(':').at(-1)!,
  ...o,
});

describe('marketCapOf (AMFI list, six months ended 30 June 2026)', () => {
  it('ranks 1–100 are large cap, 101–250 mid cap, the rest small cap', () => {
    expect(marketCapOf(share('IN_EQUITY:RELIANCE'))).toBe('LARGE'); // rank 1
    expect(marketCapOf(share('IN_EQUITY:GAIL'))).toBe('LARGE'); // rank 100
    expect(marketCapOf(share('IN_EQUITY:BOSCHLTD'))).toBe('MID'); // rank 101
    expect(marketCapOf(share('IN_EQUITY:GODREJIND'))).toBe('MID'); // rank 250
    expect(marketCapOf(share('IN_EQUITY:NAVINFLUOR'))).toBe('SMALL'); // rank 251
    expect(marketCapOf(share('IN_EQUITY:SOMEUNKNOWN'))).toBe('SMALL');
  });

  it('matches by ISIN first, so a renamed ticker still finds its company', () => {
    expect(marketCapOf(share('IN_EQUITY:OLDNAME', { isin: 'INE002A01018' }))).toBe('LARGE');
    expect(marketCapOf(share('IN_EQUITY:INE323A01026', { symbol: 'INE323A01026' }))).toBe('MID');
  });

  it('matches a BSE listing by its BSE symbol, and falls back to the other exchange', () => {
    expect(marketCapOf(share('IN_EQUITY:BSE:TCS'))).toBe('LARGE');
    // AMFI gives MCX no NSE symbol and BSE Ltd no BSE symbol.
    expect(marketCapOf(share('IN_EQUITY:MCX'))).toBe('MID');
    expect(marketCapOf(share('IN_EQUITY:BSE:BSE'))).not.toBe('SMALL');
  });

  it('only classifies Indian shares', () => {
    expect(marketCapOf(share('US_EQUITY:AAPL', { assetClass: 'US_EQUITY' }))).toBeNull();
    expect(marketCapOf(share('MUTUAL_FUND:120503', { assetClass: 'MUTUAL_FUND' }))).toBeNull();
  });

  it('says which list it uses', () => {
    expect(MARKET_CAP_LIST).toEqual({ asOf: '2026-06-30', listed: 5427 });
  });

  it('feeds the market-cap allocation view', () => {
    const h = (id: string, value: string): HoldingView =>
      ({
        instrumentId: id,
        accountId: 'manual',
        assetClass: 'IN_EQUITY',
        symbol: id.split(':').at(-1)!,
        name: id,
        qty: '1',
        openCost: value,
        value,
        price: null,
      }) as unknown as HoldingView;
    const slices = allocation(
      {
        a: h('IN_EQUITY:RELIANCE', '300'),
        b: h('IN_EQUITY:BOSCHLTD', '100'),
        c: h('IN_EQUITY:NAVINFLUOR', '100'),
      },
      'marketCap',
      { marketCap: marketCapOf },
    );
    expect(slices.map((s) => [s.key, s.valueWeight])).toEqual([
      ['LARGE', 0.6],
      ['MID', 0.2],
      ['SMALL', 0.2],
    ]);
  });
});
