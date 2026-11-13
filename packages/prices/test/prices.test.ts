import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  amfiNavProvider,
  coindcxProvider,
  finnhubProvider,
  frankfurterFx,
  freshness,
  parseNavAll,
  type PriceTarget,
  type ProviderContext,
  weekdaysBetween,
} from '../src';

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, 'fixtures', name), 'utf8');

/** Fake fetch serving fixtures by URL prefix. Records requested URLs. */
function fakeFetch(routes: Record<string, string | (() => Response)>) {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) return new Response('not found', { status: 404 });
    const r = routes[key]!;
    return typeof r === 'function' ? r() : new Response(r, { status: 200 });
  }) as typeof fetch;
  return { fn, calls };
}

const ctx = (
  f: typeof fetch,
  now = new Date('2026-11-09T05:00:00Z'),
  env: Record<string, string> = {},
): ProviderContext => ({
  fetch: f,
  now,
  env,
});

describe('AMFI NAV file (format verified 2026-11-09)', () => {
  const rows = parseNavAll(fixture('amfi-navall-2026-11-06.txt'));

  it('parses scheme rows by code and by ISIN', () => {
    expect(rows.get('120590')).toMatchObject({ nav: '116.7394', date: '2026-11-06' });
    expect(rows.get('INF109K018C5')?.code).toBe('120590');
    expect(rows.get('INF109K017C7')?.code).toBe('120589'); // reinvestment ISIN
  });

  it('skips section headers and N.A. NAVs', () => {
    expect(rows.get('999999')).toBeUndefined();
    expect([...rows.values()].every((r) => Number(r.nav) > 0)).toBe(true);
  });

  it('fails loudly if the header changes', () => {
    expect(() => parseNavAll('Code;NAV\n1;2')).toThrow(/header/);
  });

  it('provider maps targets to quotes', async () => {
    const { fn } = fakeFetch({
      'https://portal.amfiindia.com/': fixture('amfi-navall-2026-11-06.txt'),
    });
    const q = await amfiNavProvider.fetch(
      [{ instrumentId: 'MUTUAL_FUND:120590', assetClass: 'MUTUAL_FUND', symbol: '120590' }],
      ctx(fn),
    );
    expect(q.get('MUTUAL_FUND:120590')).toMatchObject({
      price: '116.7394',
      currency: 'INR',
      asOf: '2026-11-06T10:00:00.000Z',
      source: 'amfi-navall',
    });
  });
});

describe('CoinDCX ticker', () => {
  it('uses the INR market and derives the 24h-ago price', async () => {
    const { fn } = fakeFetch({ 'https://api.coindcx.com/': fixture('coindcx-ticker.json') });
    const q = await coindcxProvider.fetch(
      [
        { instrumentId: 'CRYPTO:BTC', assetClass: 'CRYPTO', symbol: 'BTC' },
        { instrumentId: 'CRYPTO:NOPE', assetClass: 'CRYPTO', symbol: 'NOPE' },
      ],
      ctx(fn),
    );
    const btc = q.get('CRYPTO:BTC')!;
    expect(btc.currency).toBe('INR');
    expect(Number(btc.price)).toBeGreaterThan(1_000_000); // INR, not USDT
    expect(Number(btc.prevClose)).toBeGreaterThan(Number(btc.price)); // fixture: −2.23% in 24h
    expect(q.has('CRYPTO:NOPE')).toBe(false);
  });
});

describe('Finnhub (documented format)', () => {
  const target: PriceTarget = {
    instrumentId: 'US_EQUITY:AAPL',
    assetClass: 'US_EQUITY',
    symbol: 'AAPL',
  };

  it('requires an API key', async () => {
    await expect(finnhubProvider.fetch([target], ctx(fakeFetch({}).fn))).rejects.toThrow(
      /FINNHUB_API_KEY/,
    );
  });

  it('parses a quote and skips unknown symbols (zeros)', async () => {
    const { fn, calls } = fakeFetch({
      'https://finnhub.io/api/v1/quote?symbol=AAPL': JSON.stringify({
        c: 228.1,
        pc: 225.4,
        t: 1794168000,
      }),
      'https://finnhub.io/api/v1/quote?symbol=ZZZZ': JSON.stringify({ c: 0, pc: 0, t: 0 }),
    });
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 2000 });
    const q = await finnhubProvider.fetch(
      [target, { ...target, instrumentId: 'US_EQUITY:ZZZZ', symbol: 'ZZZZ' }],
      ctx(fn, undefined, { FINNHUB_API_KEY: 'test-key' }),
    );
    vi.useRealTimers();
    expect(q.get('US_EQUITY:AAPL')).toMatchObject({
      price: '228.1',
      prevClose: '225.4',
      currency: 'USD',
      delayed: true,
    });
    expect(q.has('US_EQUITY:ZZZZ')).toBe(false);
    expect(calls.every((u) => !u.includes('uid') && !u.includes('@'))).toBe(true); // symbols only
  });
});

describe('Frankfurter FX', () => {
  it('parses USD→INR', async () => {
    const { fn } = fakeFetch({
      'https://api.frankfurter.dev/': fixture('frankfurter-latest.json'),
    });
    const fx = await frankfurterFx.latest(ctx(fn));
    expect(fx).toMatchObject({ pair: 'USDINR', source: 'frankfurter-ecb' });
    expect(Number(fx.rate)).toBeGreaterThan(50);
  });
});

describe('staleness', () => {
  it('counts weekdays only', () => {
    expect(weekdaysBetween('2026-11-06', '2026-11-09')).toBe(1); // Fri → Mon
    expect(weekdaysBetween('2026-11-06', '2026-11-10')).toBe(2);
  });

  it('equity close from Friday is fresh on Monday, stale on Tuesday', () => {
    const fri = '2026-11-06T10:00:00.000Z';
    expect(freshness('IN_EQUITY', 'x', fri, new Date('2026-11-09T05:00:00Z'))).toBe('fresh');
    expect(freshness('IN_EQUITY', 'x', fri, new Date('2026-11-10T05:00:00Z'))).toBe('stale');
  });

  it('MF NAV tolerates two weekdays', () => {
    const fri = '2026-11-06T10:00:00.000Z';
    expect(freshness('MUTUAL_FUND', 'amfi', fri, new Date('2026-11-10T12:00:00Z'))).toBe('fresh');
    expect(freshness('MUTUAL_FUND', 'amfi', fri, new Date('2026-11-11T12:00:00Z'))).toBe('stale');
  });

  it('crypto is stale after an hour; manual prices after 30 days', () => {
    const now = new Date('2026-11-09T05:00:00Z');
    expect(freshness('CRYPTO', 'x', '2026-11-09T04:30:00Z', now)).toBe('fresh');
    expect(freshness('CRYPTO', 'x', '2026-11-09T03:30:00Z', now)).toBe('stale');
    expect(freshness('UNLISTED', 'manual', '2026-10-15', now)).toBe('fresh');
    expect(freshness('UNLISTED', 'manual', '2026-10-01', now)).toBe('stale');
  });
});
