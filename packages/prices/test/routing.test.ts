import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetPriceServiceStateForTests,
  alphaVantageProvider,
  assertAllowedUrl,
  avSymbol,
  type CachedQuote,
  coverage,
  DEFAULT_PROVIDERS,
  DEFAULT_ROUTES,
  MemoryQuoteCache,
  MemoryRequestBudget,
  parseChart,
  parseGlobalQuote,
  type PriceProvider,
  type PriceTarget,
  type ProviderContext,
  type Quote,
  refreshQuotes,
  routeKey,
  yahooProvider,
  yahooSymbol,
} from '../src';

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, 'fixtures', name), 'utf8');

function fakeFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return handler(String(input));
  }) as typeof fetch;
  return { fn, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const now = new Date('2026-11-09T05:00:00Z');
const ctx = (
  f: typeof fetch,
  env: Record<string, string> = {},
  budget = new MemoryRequestBudget(),
): ProviderContext => ({
  fetch: f,
  now,
  env,
  budget,
});

beforeEach(() => __resetPriceServiceStateForTests());

const NSE: PriceTarget = {
  instrumentId: 'IN_EQUITY:RELIANCE',
  assetClass: 'IN_EQUITY',
  symbol: 'RELIANCE',
  exchange: 'NSE',
};
const BSE: PriceTarget = {
  instrumentId: 'IN_EQUITY:BSE:RELIANCE',
  assetClass: 'IN_EQUITY',
  symbol: 'RELIANCE',
  exchange: 'BSE',
};
const AAPL: PriceTarget = {
  instrumentId: 'US_EQUITY:AAPL',
  assetClass: 'US_EQUITY',
  symbol: 'AAPL',
};

describe('routing table', () => {
  it('routes NSE → Yahoo; BSE → Alpha Vantage → Yahoo; US → free keys → Yahoo', () => {
    expect(DEFAULT_ROUTES[routeKey(NSE)]).toEqual(['yahoo-unofficial']);
    expect(DEFAULT_ROUTES[routeKey(BSE)]).toEqual(['alphavantage', 'yahoo-unofficial']);
    expect(DEFAULT_ROUTES[routeKey(AAPL)]).toEqual(['finnhub', 'twelvedata', 'yahoo-unofficial']);
    expect(routeKey({ ...NSE, exchange: undefined })).toBe('IN_EQUITY:NSE'); // default NSE
  });

  it('every routed provider exists and none needs a paid key', () => {
    const ids = new Set(DEFAULT_PROVIDERS.map((p) => p.id));
    for (const list of Object.values(DEFAULT_ROUTES))
      for (const id of list) expect(ids.has(id)).toBe(true);
    // Keys, where needed, are FREE-tier keys the self-hoster creates.
    const keyed = DEFAULT_PROVIDERS.filter((p) => p.requiresEnv)
      .map((p) => p.requiresEnv)
      .sort();
    expect(keyed).toEqual(['ALPHAVANTAGE_API_KEY', 'FINNHUB_API_KEY', 'TWELVEDATA_API_KEY']);
  });

  it('coverage: Yahoo makes NSE/US automatic by default; the flag turns it off', () => {
    const on = Object.fromEntries(coverage({}).map((c) => [c.route, c.automatic]));
    expect(on).toMatchObject({
      'IN_EQUITY:NSE': true,
      'IN_EQUITY:BSE': true,
      US_EQUITY: true,
      MUTUAL_FUND: true,
      CRYPTO: true,
      UNLISTED: false,
    });
    const off = Object.fromEntries(
      coverage({ ENABLE_UNOFFICIAL_YAHOO: 'false' }).map((c) => [c.route, c.automatic]),
    );
    expect(off).toMatchObject({ 'IN_EQUITY:NSE': false, 'IN_EQUITY:BSE': false, US_EQUITY: false });
    expect(
      coverage({ ENABLE_UNOFFICIAL_YAHOO: 'false', ALPHAVANTAGE_API_KEY: 'k' }).find(
        (c) => c.route === 'IN_EQUITY:BSE',
      )?.automatic,
    ).toBe(true);
    expect(coverage({}).find((c) => c.route === 'IN_EQUITY:NSE')?.providers[0]).toMatchObject({
      unofficial: true,
    });
  });
});

describe('Yahoo (unofficial) — real responses captured 2026-11-09', () => {
  it('maps tickers safely', () => {
    expect(yahooSymbol(NSE)).toBe('RELIANCE.NS');
    expect(yahooSymbol(BSE)).toBe('RELIANCE.BO');
    expect(yahooSymbol({ ...AAPL, symbol: 'BRK.B' })).toBe('BRK-B');
    // BUG-007: ISINs are not Yahoo tickers; asking for them wastes a request every refresh
    expect(yahooSymbol({ ...NSE, symbol: 'INE002A01018' })).toBeNull();
    expect(yahooSymbol({ ...NSE, symbol: 'INFY' })).toBe('INFY.NS');
    expect(yahooSymbol({ ...NSE, symbol: '../v7/finance/quote?x=' })).toBeNull();
    expect(yahooSymbol({ ...NSE, symbol: 'A B' })).toBeNull();
    expect(
      yahooSymbol({ instrumentId: 'MUTUAL_FUND:1', assetClass: 'MUTUAL_FUND', symbol: '1' }),
    ).toBeNull();
  });

  it('parses an NSE chart: price, previous close from the daily bars, IST timestamp', () => {
    const q = parseChart(fixture('yahoo-chart-RELIANCE.NS.json'), NSE, 'INR')!;
    expect(q).toMatchObject({
      price: '1324.4',
      prevClose: '1320',
      currency: 'INR',
      source: 'yahoo-unofficial',
      delayed: true,
    });
    expect(Date.parse(q.asOf)).toBeGreaterThan(0);
  });

  it('parses a BSE chart with a single bar (falls back to Yahoo previous close)', () => {
    const q = parseChart(fixture('yahoo-chart-RELIANCE.BO.json'), BSE, 'INR')!;
    expect(Number(q.price)).toBeGreaterThan(0);
    expect(q.prevClose === undefined || Number(q.prevClose) > 0).toBe(true);
  });

  it('treats "not found" as no quote, and a changed format or wrong currency as an error', () => {
    expect(parseChart(fixture('yahoo-chart-invalid.json'), NSE, 'INR')).toBeNull();
    expect(() => parseChart('{"chart":{"result":[{"meta":{"symbol":"X"}}]}}', NSE, 'INR')).toThrow(
      /shape/,
    );
    expect(() => parseChart('<html>', NSE, 'INR')).toThrow(/JSON/);
    expect(() => parseChart(fixture('yahoo-chart-RELIANCE.NS.json'), AAPL, 'USD')).toThrow(
      /currency/,
    );
  });

  it('builds only allow-listed URLs with the symbol encoded, and respects the flag', async () => {
    const { fn, calls } = fakeFetch(() => new Response(fixture('yahoo-chart-RELIANCE.NS.json')));
    const q = await yahooProvider.fetch([NSE], ctx(fn));
    expect(q.get(NSE.instrumentId)?.price).toBe('1324.4');
    expect(calls).toEqual([
      'https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=5d&interval=1d',
    ]);
    expect(yahooProvider.isEnabled!({})).toBe(true);
    expect(yahooProvider.isEnabled!({ ENABLE_UNOFFICIAL_YAHOO: 'false' })).toBe(false);
  });

  it('retries 429/5xx with backoff, then succeeds', async () => {
    let n = 0;
    const { fn } = fakeFetch(() =>
      ++n < 3
        ? new Response('busy', { status: 503 })
        : new Response(fixture('yahoo-chart-RELIANCE.NS.json')),
    );
    const q = await yahooProvider.fetch([NSE], ctx(fn));
    expect(n).toBe(3);
    expect(q.size).toBe(1);
  }, 15_000);
});

describe('Alpha Vantage (free key, BSE only)', () => {
  const avOk = JSON.stringify({
    'Global Quote': {
      '01. symbol': 'RELIANCE.BSE',
      '05. price': '1323.9000',
      '07. latest trading day': '2026-11-06',
      '08. previous close': '1310.1500',
    },
  });

  it('only serves BSE Indian stocks', () => {
    expect(avSymbol(BSE)).toBe('RELIANCE.BSE');
    expect(avSymbol(NSE)).toBeNull();
    expect(avSymbol({ ...BSE, symbol: 'INE002A01018' })).toBeNull(); // BUG-007
    expect(avSymbol(AAPL)).toBeNull();
    expect(alphaVantageProvider.supports(NSE)).toBe(false);
  });

  it('parses a quote; HTTP-200 rate-limit / error bodies are never prices', () => {
    expect(parseGlobalQuote(avOk, BSE)).toMatchObject({
      kind: 'quote',
      quote: { price: '1323.9', prevClose: '1310.15', currency: 'INR' },
    });
    expect(
      parseGlobalQuote(
        '{"Note":"Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day."}',
        BSE,
      ).kind,
    ).toBe('limited');
    expect(
      parseGlobalQuote('{"Information":"We have detected your API key as ... rate limit"}', BSE)
        .kind,
    ).toBe('limited');
    expect(parseGlobalQuote('{"Error Message":"Invalid API call."}', BSE).kind).toBe('error');
    expect(parseGlobalQuote('{"Global Quote":{}}', BSE).kind).toBe('not-found');
    expect(
      parseGlobalQuote(
        '{"Global Quote":{"01. symbol":"X","05. price":"0.0000","07. latest trading day":"2026-11-06"}}',
        BSE,
      ).kind,
    ).toBe('not-found');
    expect(parseGlobalQuote('<html>', BSE).kind).toBe('error');
  });

  it('stops calling once the shared daily budget is used, and keeps results so far', async () => {
    const budget = new MemoryRequestBudget();
    await budget.reserve('alphavantage', 24, 25);
    const { fn, calls } = fakeFetch(() => new Response(avOk));
    const targets = [BSE, { ...BSE, instrumentId: 'IN_EQUITY:BSE:TCS', symbol: 'TCS' }];
    await expect(
      alphaVantageProvider.fetch(
        targets,
        ctx(fn, { ALPHAVANTAGE_API_KEY: 'k', ALPHAVANTAGE_MIN_INTERVAL_MS: '0' }, budget),
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/quota/),
      partial: expect.any(Map),
    });
    expect(calls).toHaveLength(1); // only the one call left in today's budget
  }, 30_000);

  it('marks the budget exhausted when the API says "rate limit", so later refreshes skip it', async () => {
    const budget = new MemoryRequestBudget();
    const { fn } = fakeFetch(() => new Response('{"Information":"rate limit"}'));
    await expect(
      alphaVantageProvider.fetch(
        [BSE],
        ctx(fn, { ALPHAVANTAGE_API_KEY: 'k', ALPHAVANTAGE_MIN_INTERVAL_MS: '0' }, budget),
      ),
    ).rejects.toThrow(/rate limit/);
    expect(await budget.reserve('alphavantage', 1, 25)).toBe(0);
  });

  it('never leaks the key in error messages', async () => {
    const { fn } = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(
      alphaVantageProvider.fetch(
        [BSE],
        ctx(fn, { ALPHAVANTAGE_API_KEY: 'SECRET123', ALPHAVANTAGE_MIN_INTERVAL_MS: '0' }),
      ),
    ).rejects.toSatisfy((e: Error) => !e.message.includes('SECRET123'));
  });
});

describe('outbound URL allow-list (SSRF guard)', () => {
  it('accepts only https on known hosts', () => {
    expect(() =>
      assertAllowedUrl('x', 'https://query1.finance.yahoo.com/v8/finance/chart/A'),
    ).not.toThrow();
    for (const bad of [
      'http://query1.finance.yahoo.com/x',
      'https://evil.example/x',
      'https://query1.finance.yahoo.com.evil.example/x',
      'https://user:pw@api.coindcx.com/x',
      'https://api.coindcx.com:8443/x',
      'file:///etc/passwd',
      'not a url',
    ]) {
      expect(() => assertAllowedUrl('x', bad), bad).toThrow();
    }
  });
});

describe('refreshQuotes — routing, fallback, de-duplication', () => {
  const quote = (
    t: PriceTarget,
    price: string,
    source: string,
    asOf = '2026-11-06T10:00:00.000Z',
  ): Quote => ({
    instrumentId: t.instrumentId,
    price,
    currency: 'INR',
    asOf,
    source,
    delayed: false,
  });
  const MF: PriceTarget = { instrumentId: 'MUTUAL_FUND:1', assetClass: 'MUTUAL_FUND', symbol: '1' };
  const fake = (
    id: string,
    impl: PriceProvider['fetch'],
    extra: Partial<PriceProvider> = {},
  ): PriceProvider => ({
    id,
    label: id,
    assetClasses: ['MUTUAL_FUND', 'IN_EQUITY'],
    supports: () => true,
    fetch: vi.fn(impl),
    ...extra,
  });
  const routes = {
    ...DEFAULT_ROUTES,
    MUTUAL_FUND: ['primary', 'fallback'],
    'IN_EQUITY:BSE': ['primary', 'fallback'],
  };
  const c = ctx(fakeFetch(() => new Response('')).fn);

  it('uses the fallback when the primary fails, and keeps partial results', async () => {
    const primary = fake('primary', async () => {
      throw new Error('down');
    });
    const fallback = fake(
      'fallback',
      async () => new Map([[MF.instrumentId, quote(MF, '10', 'fallback')]]),
    );
    const r = await refreshQuotes({
      targets: [MF],
      cache: new MemoryQuoteCache(),
      providers: [primary, fallback],
      routes,
      ctx: c,
    });
    expect(r.quotes.get(MF.instrumentId)?.source).toBe('fallback');
    expect(r.errors).toEqual([{ provider: 'primary', message: 'down' }]);
  });

  it('asks each provider once for duplicate targets in one refresh', async () => {
    const p = fake(
      'primary',
      async (ts) => new Map(ts.map((t) => [t.instrumentId, quote(t, '10', 'primary')])),
    );
    await refreshQuotes({
      targets: [MF, MF, { ...MF }],
      cache: new MemoryQuoteCache(),
      providers: [p],
      routes,
      ctx: c,
    });
    expect(p.fetch).toHaveBeenCalledTimes(1);
    expect((p.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toHaveLength(1);
  });

  it('shares one in-flight lookup between concurrent refreshes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const p = fake('primary', async (ts) => {
      await gate;
      return new Map(ts.map((t) => [t.instrumentId, quote(t, '10', 'primary')]));
    });
    const cache = new MemoryQuoteCache();
    const a = refreshQuotes({ targets: [MF], cache, providers: [p], routes, ctx: c });
    const b = refreshQuotes({ targets: [MF], cache, providers: [p], routes, ctx: c });
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(p.fetch).toHaveBeenCalledTimes(1);
    expect(ra.quotes.get(MF.instrumentId)?.price).toBe('10');
    expect(rb.quotes.get(MF.instrumentId)?.price).toBe('10');
  });

  it('backs off a symbol that failed everywhere (no hammering), unless forced', async () => {
    const p = fake('primary', async () => new Map());
    const cache = new MemoryQuoteCache();
    await refreshQuotes({
      targets: [MF],
      cache,
      providers: [p],
      routes: { ...routes, MUTUAL_FUND: ['primary'] },
      ctx: c,
    });
    await refreshQuotes({
      targets: [MF],
      cache,
      providers: [p],
      routes: { ...routes, MUTUAL_FUND: ['primary'] },
      ctx: c,
    });
    expect(p.fetch).toHaveBeenCalledTimes(1);
    await refreshQuotes({
      targets: [MF],
      cache,
      providers: [p],
      routes: { ...routes, MUTUAL_FUND: ['primary'] },
      ctx: c,
      force: true,
    });
    expect(p.fetch).toHaveBeenCalledTimes(2);
  });

  it('within TTL uses the cache; when every provider fails keeps the last known quote', async () => {
    const cache = new MemoryQuoteCache();
    const fresh: CachedQuote = {
      ...quote(MF, '9', 'primary'),
      fetchedAt: new Date(now.getTime() - 60_000).toISOString(),
    };
    await cache.putMany([fresh]);
    const p = fake('primary', async () => {
      throw new Error('down');
    });
    const r1 = await refreshQuotes({ targets: [MF], cache, providers: [p], routes, ctx: c });
    expect(p.fetch).not.toHaveBeenCalled();
    const r2 = await refreshQuotes({
      targets: [MF],
      cache,
      providers: [p],
      routes,
      ctx: c,
      force: true,
    });
    expect(r1.quotes.get(MF.instrumentId)?.price).toBe('9');
    expect(r2.quotes.get(MF.instrumentId)?.price).toBe('9');
  });

  it('uses the older cached price as previous close when the source has none', async () => {
    const cache = new MemoryQuoteCache();
    await cache.putMany([
      { ...quote(MF, '9', 'p', '2026-11-05T10:00:00.000Z'), fetchedAt: '2026-11-05T18:00:00.000Z' },
    ]);
    const p = fake('primary', async () => new Map([[MF.instrumentId, quote(MF, '10', 'primary')]]));
    const r = await refreshQuotes({ targets: [MF], cache, providers: [p], routes, ctx: c });
    expect(r.quotes.get(MF.instrumentId)).toMatchObject({ price: '10', prevClose: '9' });
  });

  it('reports disabled and unconfigured providers without calling them', async () => {
    const keyed = fake('primary', async () => new Map(), { requiresEnv: 'SOME_KEY' });
    const off = fake('fallback', async () => new Map(), { isEnabled: () => false });
    const r = await refreshQuotes({
      targets: [BSE],
      cache: new MemoryQuoteCache(),
      providers: [keyed, off],
      routes,
      ctx: c,
    });
    expect(keyed.fetch).not.toHaveBeenCalled();
    expect(off.fetch).not.toHaveBeenCalled();
    expect(r.errors.map((e) => e.message)).toEqual([
      'not configured (SOME_KEY)',
      'disabled by configuration',
    ]);
    expect(r.unpriced).toEqual([BSE.instrumentId]);
  });

  it('end to end: BSE uses Alpha Vantage within budget, then falls back to Yahoo', async () => {
    const budget = new MemoryRequestBudget();
    await budget.exhaust('alphavantage', 25); // today's free quota already used
    // Match on the parsed hostname, never on a substring of the URL.
    const host = (u: string) => new URL(u).hostname;
    const { fn, calls } = fakeFetch((url) =>
      host(url) === 'query1.finance.yahoo.com'
        ? new Response(fixture('yahoo-chart-RELIANCE.BO.json'))
        : json({}),
    );
    const r = await refreshQuotes({
      targets: [BSE],
      cache: new MemoryQuoteCache(),
      providers: DEFAULT_PROVIDERS,
      ctx: ctx(fn, { ALPHAVANTAGE_API_KEY: 'k', ALPHAVANTAGE_MIN_INTERVAL_MS: '0' }, budget),
    });
    expect(r.quotes.get(BSE.instrumentId)?.source).toBe('yahoo-unofficial');
    expect(calls.some((u) => host(u) === 'www.alphavantage.co')).toBe(false);
    expect(r.errors).toEqual([
      { provider: 'alphavantage', message: 'alphavantage: daily free quota used up' },
    ]);
  });
});
