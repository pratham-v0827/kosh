// Daily index closes from Yahoo's chart endpoint (unofficial). The bodies below follow the shape
// of /v8/finance/chart responses, trimmed to the fields Kosh reads; the numbers are invented.
import { describe, expect, it } from 'vitest';
import { fetchIndexHistory, parseIndexHistory, type ProviderContext } from '../src';

const at = (iso: string) => Date.parse(iso) / 1000;
const chart = (meta: Record<string, unknown>, timestamps: number[], closes: (number | null)[]) =>
  JSON.stringify({
    chart: {
      result: [
        {
          meta: { regularMarketPrice: 1, regularMarketTime: timestamps.at(-1) ?? 1, ...meta },
          timestamp: timestamps,
          indicators: { quote: [{ close: closes }] },
        },
      ],
      error: null,
    },
  });

const NIFTY = chart(
  { currency: 'INR', symbol: '^NSEI', exchangeTimezoneName: 'Asia/Kolkata' },
  [
    at('2026-11-12T03:45:00Z'), // 09:15 IST, 12 Nov
    at('2026-11-13T03:45:00Z'),
    at('2026-11-13T09:59:00Z'), // a second bar for the same day: the later one wins
    at('2026-11-11T03:45:00Z'), // out of order
    at('2026-11-10T03:45:00Z'), // no close that day
  ],
  [25000.123456, 25100, 25150.5, 24900, null],
);

const SP500 = chart(
  { currency: 'USD', symbol: '^GSPC', exchangeTimezoneName: 'America/New_York' },
  // 21:00 in New York on 12 Nov is already 13 Nov in UTC and IST
  [at('2026-11-13T02:00:00Z')],
  [6800],
);

function context(
  handler: (url: string) => Response,
  env: Record<string, string> = {},
): { ctx: ProviderContext; calls: string[] } {
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return handler(String(input));
  }) as typeof fetch;
  return { ctx: { fetch: fetchFn, now: new Date('2026-11-15T05:00:00Z'), env }, calls };
}

describe('parseIndexHistory', () => {
  it('returns one close per exchange-local day, sorted, without empty days', () => {
    expect(parseIndexHistory(NIFTY, 'INR')).toEqual([
      { date: '2026-11-11', close: 24900 },
      { date: '2026-11-12', close: 25000.1235 },
      { date: '2026-11-13', close: 25150.5 },
    ]);
  });

  it('dates US closes in New York time, not UTC', () => {
    expect(parseIndexHistory(SP500, 'USD')).toEqual([{ date: '2026-11-12', close: 6800 }]);
  });

  it('rejects a currency other than the expected one', () => {
    expect(() => parseIndexHistory(SP500, 'INR')).toThrow(/currency/);
  });

  it('treats a "not found" answer as no data and a malformed body as an error', () => {
    const notFound = JSON.stringify({
      chart: { result: null, error: { code: 'Not Found', description: 'No data found' } },
    });
    expect(parseIndexHistory(notFound, 'INR')).toBeNull();
    expect(() => parseIndexHistory('<html>', 'INR')).toThrow(/JSON/);
    expect(() => parseIndexHistory('{"chart":{}}', 'INR')).toThrow(/shape/);
  });

  it('ignores impossible closes and an unknown time zone falls back to UTC', () => {
    const body = chart(
      { currency: 'INR', exchangeTimezoneName: 'Not/AZone' },
      [at('2026-11-12T20:00:00Z'), at('2026-11-13T20:00:00Z')],
      [-5, 100],
    );
    expect(parseIndexHistory(body, 'INR')).toEqual([{ date: '2026-11-13', close: 100 }]);
  });
});

describe('fetchIndexHistory', () => {
  it('asks Yahoo for daily closes of the index over the given range', async () => {
    const { ctx, calls } = context(() => new Response(NIFTY));
    const r = await fetchIndexHistory('NIFTY50', '10y', ctx);
    expect(r).toEqual({ status: 'ok', closes: parseIndexHistory(NIFTY, 'INR') });
    expect(calls).toEqual([
      'https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?range=10y&interval=1d',
    ]);
  });

  it('is off when unofficial Yahoo is switched off, and sends nothing', async () => {
    const { ctx, calls } = context(() => new Response(NIFTY), { ENABLE_UNOFFICIAL_YAHOO: 'false' });
    expect(await fetchIndexHistory('SENSEX', '1mo', ctx)).toEqual({
      status: 'unavailable',
      reason: 'disabled by configuration',
    });
    expect(calls).toEqual([]);
  });

  it('reports failures instead of throwing', async () => {
    const { ctx } = context(() => new Response('{"chart":{}}'));
    const r = await fetchIndexHistory('SP500', '1mo', ctx);
    expect(r.status).toBe('unavailable');
  });

  it('a Yahoo "not found" is reported as such', async () => {
    const body = JSON.stringify({ chart: { result: null, error: { code: 'Not Found' } } });
    const { ctx } = context(() => new Response(body, { status: 404 }));
    expect(await fetchIndexHistory('SP500', '1mo', ctx)).toEqual({ status: 'not-found' });
  });
});
