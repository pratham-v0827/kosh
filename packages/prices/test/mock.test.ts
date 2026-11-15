// The mock market data used by end-to-end tests must be read correctly by the REAL providers.
import { describe, expect, it } from 'vitest';
import {
  amfiNavProvider,
  coindcxProvider,
  createMockFetch,
  fetchDailyHistory,
  fetchIndexHistory,
  frankfurterFx,
  lookupIsin,
  mfapiProvider,
  type PriceTarget,
  type ProviderContext,
  yahooProvider,
} from '../src';

const now = new Date('2026-11-13T10:00:00Z'); // a Friday
const ctx: ProviderContext = { fetch: createMockFetch(() => now), now, env: {} };
const target = (
  t: Partial<PriceTarget> & Pick<PriceTarget, 'assetClass' | 'symbol'>,
): PriceTarget => ({ instrumentId: `${t.assetClass}:${t.symbol}`, ...t }) as PriceTarget;

describe('mock market data, read by the real providers', () => {
  it('Yahoo quotes: fixed prices for Indian (NSE and BSE) and US shares, with a previous close', async () => {
    const q = await yahooProvider.fetch(
      [
        target({ assetClass: 'IN_EQUITY', symbol: 'ITC' }),
        target({
          assetClass: 'IN_EQUITY',
          symbol: 'ITC',
          exchange: 'BSE',
          instrumentId: 'IN_EQUITY:BSE:ITC',
        }),
        target({ assetClass: 'US_EQUITY', symbol: 'BF.B' }),
      ],
      ctx,
    );
    expect(q.get('IN_EQUITY:ITC')).toMatchObject({ price: '438.6', currency: 'INR' });
    expect(q.get('IN_EQUITY:BSE:ITC')?.price).toBe('438.6');
    expect(q.get('US_EQUITY:BF.B')).toMatchObject({ price: '41.2', currency: 'USD' });
    expect(Number(q.get('IN_EQUITY:ITC')?.prevClose)).toBeGreaterThan(0);
  });

  it('an unknown ZZ ticker is not found', async () => {
    const q = await yahooProvider.fetch(
      [target({ assetClass: 'IN_EQUITY', symbol: 'ZZNONE' })],
      ctx,
    );
    expect(q.size).toBe(0);
  });

  it('index and price histories end today at the fixed price, one close per weekday', async () => {
    const nifty = await fetchIndexHistory('NIFTY50', '1y', ctx);
    expect(nifty.status).toBe('ok');
    if (nifty.status !== 'ok') return;
    expect(nifty.closes.at(-1)).toEqual({ date: '2026-11-13', close: 24512.35 });
    expect(nifty.closes.length).toBeGreaterThan(250);
    expect(
      nifty.closes.every((c) => ![0, 6].includes(new Date(`${c.date}T00:00:00Z`).getUTCDay())),
    ).toBe(true);
    const tenYears = await fetchIndexHistory('SP500', '10y', ctx);
    expect(tenYears.status === 'ok' && tenYears.closes[0]!.date < '2016-11-20').toBe(true);
    const fund = await fetchDailyHistory({ provider: 'mfapi', code: '120590' }, '10y', ctx);
    expect(fund.status === 'ok' && fund.closes.at(-1)).toEqual({
      date: '2026-11-13',
      close: 102.3456,
    });
  });

  it('ISIN search knows the fixture holdings only', async () => {
    expect(await lookupIsin('INE154A01025', ctx)).toEqual({
      status: 'found',
      match: { symbol: 'ITC', exchange: 'NSE', name: 'ITC Limited' },
    });
    expect(await lookupIsin('INE999Z99991', ctx)).toEqual({ status: 'not-found' });
  });

  it('fund NAVs from AMFI and mfapi, crypto from CoinDCX, USD→INR from Frankfurter', async () => {
    const mf = target({ assetClass: 'MUTUAL_FUND', symbol: '120590' });
    expect((await amfiNavProvider.fetch([mf], ctx)).get(mf.instrumentId)?.price).toBe('102.3456');
    expect((await mfapiProvider.fetch([mf], ctx)).get(mf.instrumentId)?.price).toBe('102.3456');
    const btc = target({ assetClass: 'CRYPTO', symbol: 'BTC' });
    expect((await coindcxProvider.fetch([btc], ctx)).get(btc.instrumentId)?.price).toBe('7512340');
    expect(await frankfurterFx.latest(ctx)).toMatchObject({ rate: '88.25', asOf: '2026-11-13' });
    // A Sunday asks for the Friday before, as the real service answers.
    expect(await frankfurterFx.onDate('2026-11-08', ctx)).toMatchObject({ asOf: '2026-11-06' });
  });

  it('answers 404 for anything that is not market data', async () => {
    expect((await ctx.fetch('https://example.com/')).status).toBe(404);
  });
});
