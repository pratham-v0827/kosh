// ISIN → ticker lookup (Yahoo search, unofficial). Response shape captured 2026-11-14 with two
// public ISINs; the bodies below are trimmed to the fields Kosh reads.
import { describe, expect, it } from 'vitest';
import { lookupIsin, parseIsinSearch, type ProviderContext } from '../src';

const body = (quotes: unknown[]) => JSON.stringify({ explains: [], count: quotes.length, quotes });
const RELIANCE = body([
  {
    exchange: 'NSI',
    shortname: 'RELIANCE INDUSTRIES LTD',
    quoteType: 'EQUITY',
    symbol: 'RELIANCE.NS',
    longname: 'Reliance Industries Limited',
  },
  {
    exchange: 'BSE',
    shortname: 'RELIANCE INDUSTRIES LTD.',
    quoteType: 'EQUITY',
    symbol: 'RELIANCE.BO',
  },
]);

function context(
  handler: (url: string) => Response,
  env: Record<string, string> = {},
): { ctx: ProviderContext; calls: string[] } {
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return handler(String(input));
  }) as typeof fetch;
  return { ctx: { fetch: fetchFn, now: new Date('2026-11-14T05:00:00Z'), env }, calls };
}

describe('parseIsinSearch', () => {
  it('prefers the NSE listing and keeps the name', () => {
    expect(parseIsinSearch(RELIANCE)).toEqual({
      symbol: 'RELIANCE',
      exchange: 'NSE',
      name: 'Reliance Industries Limited',
    });
  });

  it('falls back to BSE, including numeric scrip codes', () => {
    expect(parseIsinSearch(body([{ symbol: '500325.BO', shortname: 'RELIANCE' }]))).toEqual({
      symbol: '500325',
      exchange: 'BSE',
      name: 'RELIANCE',
    });
  });

  it('accepts tickers with & and -', () => {
    expect(parseIsinSearch(body([{ symbol: 'M&M.NS' }]))).toEqual({
      symbol: 'M&M',
      exchange: 'NSE',
    });
    expect(parseIsinSearch(body([{ symbol: 'BAJAJ-AUTO.NS' }]))?.symbol).toBe('BAJAJ-AUTO');
  });

  it('ignores foreign listings and odd symbols', () => {
    expect(parseIsinSearch(body([{ symbol: 'RELI.L' }, { symbol: 'RIGD.IL' }, {}]))).toBeNull();
    expect(parseIsinSearch(body([{ symbol: '../x?y=.NS' }, { symbol: '.NS' }]))).toBeNull();
    expect(parseIsinSearch(body([]))).toBeNull();
    expect(parseIsinSearch('{"count":0}')).toBeNull(); // no quotes field at all
  });

  it('throws on a response that is not the expected shape', () => {
    expect(() => parseIsinSearch('<html>blocked</html>')).toThrow(/shape/);
    expect(() => parseIsinSearch('{"quotes":"nope"}')).toThrow(/shape/);
  });
});

describe('lookupIsin', () => {
  it('asks only for a well-formed ISIN, on the allow-listed host', async () => {
    const { ctx, calls } = context(() => new Response(RELIANCE));
    expect(await lookupIsin('INE002A01018', ctx)).toEqual({
      status: 'found',
      match: { symbol: 'RELIANCE', exchange: 'NSE', name: 'Reliance Industries Limited' },
    });
    expect(calls).toEqual([
      'https://query1.finance.yahoo.com/v1/finance/search?q=INE002A01018&quotesCount=6&newsCount=0&listsCount=0',
    ]);
    // anything that is not an Indian ISIN never leaves the server
    for (const bad of ['RELIANCE', 'US0378331005', 'INE002A0101', '../v7/quote?x=', '']) {
      expect(await lookupIsin(bad, ctx)).toEqual({ status: 'not-found' });
    }
    expect(calls).toHaveLength(1);
  });

  it('reports "not found" when the source knows no Indian listing', async () => {
    const { ctx } = context(() => new Response(body([{ symbol: 'XYZ.L' }])));
    expect(await lookupIsin('INE000A01000', ctx)).toEqual({ status: 'not-found' });
  });

  it('is "unavailable", not "not found", when switched off or unreachable', async () => {
    const off = context(() => new Response(RELIANCE), { ENABLE_UNOFFICIAL_YAHOO: 'false' });
    expect(await lookupIsin('INE002A01018', off.ctx)).toEqual({
      status: 'unavailable',
      reason: 'disabled by configuration',
    });
    expect(off.calls).toHaveLength(0);

    const blocked = context(() => new Response('nope', { status: 403 }));
    expect((await lookupIsin('INE002A01018', blocked.ctx)).status).toBe('unavailable');
    const garbled = context(() => new Response('<html>'));
    expect(await lookupIsin('INE002A01018', garbled.ctx)).toEqual({
      status: 'unavailable',
      reason: 'unexpected response shape',
    });
  });
});
