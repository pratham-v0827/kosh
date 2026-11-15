// Daily price history for a holding's chart: Yahoo (unofficial) for listed shares, mfapi.in for
// mutual-fund NAVs. Response bodies follow each source's shape; the numbers are invented.
import { describe, expect, it } from 'vitest';
import {
  fetchDailyHistory,
  historySourceFor,
  parseIndianDate,
  parseMfHistory,
  type ProviderContext,
} from '../src';

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

const MF = JSON.stringify({
  meta: { scheme_code: 120590, scheme_name: 'Example Fund - Direct Growth' },
  data: [
    { date: '14-11-2026', nav: '116.70210' },
    { date: '13-11-2026', nav: '116.5' },
    { date: '31-02-2026', nav: '1' }, // impossible date: skipped
    { date: '12-11-2026', nav: 'N.A.' }, // no NAV that day: skipped
    { date: '11-11-2026', nav: '116.1' },
  ],
  status: 'SUCCESS',
});

describe('historySourceFor', () => {
  it('uses Yahoo for listed shares and mfapi for funds; nothing for crypto or unlisted', () => {
    expect(
      historySourceFor({
        instrumentId: 'IN_EQUITY:BSE:TCS',
        assetClass: 'IN_EQUITY',
        symbol: 'TCS',
        exchange: 'BSE',
      }),
    ).toEqual({ provider: 'yahoo', symbol: 'TCS.BO', currency: 'INR' });
    expect(
      historySourceFor({
        instrumentId: 'US_EQUITY:BRK.B',
        assetClass: 'US_EQUITY',
        symbol: 'BRK.B',
      }),
    ).toEqual({ provider: 'yahoo', symbol: 'BRK-B', currency: 'USD' });
    expect(
      historySourceFor({
        instrumentId: 'MUTUAL_FUND:120590',
        assetClass: 'MUTUAL_FUND',
        symbol: '120590',
      }),
    ).toEqual({ provider: 'mfapi', code: '120590' });
    expect(
      historySourceFor({ instrumentId: 'CRYPTO:BTC', assetClass: 'CRYPTO', symbol: 'BTC' }),
    ).toBeNull();
    expect(
      historySourceFor({
        instrumentId: 'MUTUAL_FUND:x',
        assetClass: 'MUTUAL_FUND',
        symbol: '../x',
      }),
    ).toBeNull();
  });
});

describe('parseIndianDate (BUG-017)', () => {
  it('accepts real dates in both forms', () => {
    expect(parseIndianDate('06-Nov-2026')).toBe('2026-11-06');
    expect(parseIndianDate('29-02-2024')).toBe('2024-02-29');
  });

  it('refuses impossible dates instead of passing them on', () => {
    for (const s of [
      '31-02-2026',
      '29-02-2026',
      '00-11-2026',
      '15-13-2026',
      '15-00-2026',
      '32-Jan-2026',
    ]) {
      expect(parseIndianDate(s), s).toBeNull();
    }
  });
});

describe('parseMfHistory', () => {
  it('returns valid NAVs oldest first, with ISO dates', () => {
    expect(parseMfHistory(MF)).toEqual([
      { date: '2026-11-11', close: 116.1 },
      { date: '2026-11-13', close: 116.5 },
      { date: '2026-11-14', close: 116.7021 },
    ]);
  });

  it('an unknown scheme is no data; a malformed body is an error', () => {
    expect(parseMfHistory(JSON.stringify({ meta: {}, data: [], status: 'ERROR' }))).toBeNull();
    expect(() => parseMfHistory('<html>')).toThrow(/JSON/);
  });
});

describe('fetchDailyHistory', () => {
  it('asks mfapi for the whole NAV history of the scheme', async () => {
    const { ctx, calls } = context(() => new Response(MF));
    const r = await fetchDailyHistory({ provider: 'mfapi', code: '120590' }, '10y', ctx);
    expect(r.status).toBe('ok');
    expect(calls).toEqual(['https://api.mfapi.in/mf/120590']);
  });

  it('asks Yahoo for daily closes of the symbol, and respects the switch', async () => {
    const body = JSON.stringify({
      chart: {
        result: [
          {
            meta: { currency: 'INR', exchangeTimezoneName: 'Asia/Kolkata' },
            timestamp: [Date.parse('2026-11-13T03:45:00Z') / 1000],
            indicators: { quote: [{ close: [2400.5] }] },
          },
        ],
        error: null,
      },
    });
    const { ctx, calls } = context(() => new Response(body));
    const src = { provider: 'yahoo', symbol: 'TCS.NS', currency: 'INR' } as const;
    expect(await fetchDailyHistory(src, '1mo', ctx)).toEqual({
      status: 'ok',
      closes: [{ date: '2026-11-13', close: 2400.5 }],
    });
    expect(calls).toEqual([
      'https://query1.finance.yahoo.com/v8/finance/chart/TCS.NS?range=1mo&interval=1d',
    ]);

    const off = context(() => new Response(body), { ENABLE_UNOFFICIAL_YAHOO: 'false' });
    expect((await fetchDailyHistory(src, '1mo', off.ctx)).status).toBe('unavailable');
    expect(off.calls).toEqual([]);
  });

  it('reports failures instead of throwing', async () => {
    const { ctx } = context(() => new Response('oops', { status: 500 }));
    const r = await fetchDailyHistory({ provider: 'mfapi', code: '120590' }, '10y', ctx);
    expect(r.status).toBe('unavailable');
  });
});
