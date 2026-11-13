import Decimal from 'decimal.js';
import { z } from 'zod';
import { createThrottle, getText, ProviderError } from '../http';
import { INDIAN_ISIN, type PriceProvider, type PriceTarget, type Quote } from '../types';

/**
 * Yahoo Finance — UNOFFICIAL. This is Yahoo's own website endpoint, not a public API: there is
 * no documentation, no SLA, and its terms of service may not permit this use. It can change or
 * stop without notice. Self-hosters decide whether to keep it on (ENABLE_UNOFFICIAL_YAHOO=false
 * turns it off). Verified 2026-11-09: /v8/finance/chart answers an honest, identified client
 * without cookies or a "crumb". Kosh never fakes a browser or works around bot protection.
 *
 * Request hygiene: one request per symbol, serialised with a minimum gap, short timeout,
 * two retries with backoff for 429/5xx, and results cached by the refresh service.
 */

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const throttle = createThrottle(400);

// Validate only what we use; Yahoo adds and renames fields over time.
const ChartResponse = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({
            currency: z.string().nullable().optional(),
            symbol: z.string(),
            regularMarketPrice: z.number().positive(),
            regularMarketTime: z.number().int().positive(),
            chartPreviousClose: z.number().positive().optional(),
            previousClose: z.number().positive().optional(),
          }),
          timestamp: z.array(z.number().int()).optional(),
          indicators: z
            .object({
              quote: z.array(z.object({ close: z.array(z.number().nullable()).optional() })),
            })
            .optional(),
        }),
      )
      .nullable(),
    error: z.object({ code: z.string(), description: z.string().optional() }).nullable().optional(),
  }),
});

/** Yahoo symbol for a Kosh target: RELIANCE → RELIANCE.NS / RELIANCE.BO; US tickers unchanged. */
export function yahooSymbol(t: PriceTarget): string | null {
  if (t.assetClass === 'US_EQUITY')
    return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t.symbol) ? t.symbol.replace('.', '-') : null;
  if (t.assetClass === 'IN_EQUITY') {
    if (!/^[A-Z0-9&\-]{1,20}$/.test(t.symbol)) return null; // odd strings are not tickers
    if (INDIAN_ISIN.test(t.symbol)) return null; // BUG-007: ISINs passed the charset check above
    return `${t.symbol}.${t.exchange === 'BSE' ? 'BO' : 'NS'}`;
  }
  return null;
}

const istDate = (ms: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(ms);

/** Parse one chart response. Returns null for "not found"; throws on a malformed body. */
export function parseChart(
  body: string,
  t: PriceTarget,
  expectedCurrency: 'INR' | 'USD',
): Quote | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new ProviderError('yahoo-unofficial', 'invalid JSON');
  }
  const parsed = ChartResponse.safeParse(json);
  if (!parsed.success)
    throw new ProviderError('yahoo-unofficial', 'unexpected response shape (format changed?)');
  const { result, error } = parsed.data.chart;
  if (error || !result || result.length === 0) return null;
  const r = result[0]!;
  const m = r.meta;
  if (m.currency && m.currency.toUpperCase() !== expectedCurrency) {
    throw new ProviderError('yahoo-unofficial', `unexpected currency ${m.currency}`);
  }

  // Previous close = last daily close before the quote's trading day; else Yahoo's own field.
  const quoteDay = istDate(m.regularMarketTime * 1000);
  const closes = r.indicators?.quote[0]?.close ?? [];
  let prev: number | undefined;
  (r.timestamp ?? []).forEach((ts, i) => {
    const c = closes[i];
    if (typeof c === 'number' && c > 0 && istDate(ts * 1000) < quoteDay) prev = c;
  });
  prev ??= m.previousClose ?? m.chartPreviousClose;

  const clean = (n: number) => new Decimal(n).toDecimalPlaces(4).toString();
  return {
    instrumentId: t.instrumentId,
    price: clean(m.regularMarketPrice),
    ...(prev ? { prevClose: clean(prev) } : {}),
    currency: expectedCurrency,
    asOf: new Date(m.regularMarketTime * 1000).toISOString(),
    source: 'yahoo-unofficial',
    delayed: true,
  };
}

export const yahooProvider: PriceProvider = {
  id: 'yahoo-unofficial',
  label: 'Yahoo Finance (unofficial)',
  unofficial: true,
  // 400 ms between calls → at most ~16 s per run, leaving room inside a 60 s function.
  maxPerRun: 40,
  assetClasses: ['IN_EQUITY', 'US_EQUITY'],
  isEnabled: (env) => (env.ENABLE_UNOFFICIAL_YAHOO ?? 'true').toLowerCase() !== 'false',
  supports: (t) => yahooSymbol(t) !== null,
  async fetch(targets, ctx) {
    const out = new Map<string, Quote>();
    let failures = 0;
    for (const t of targets) {
      const sym = yahooSymbol(t)!;
      const url = `${BASE}${encodeURIComponent(sym)}?range=5d&interval=1d`;
      try {
        const body = await throttle(() =>
          getText('yahoo-unofficial', url, ctx, {
            timeoutMs: 8000,
            retries: 2,
            acceptStatus: [404],
          }),
        );
        const q = parseChart(body, t, t.assetClass === 'US_EQUITY' ? 'USD' : 'INR');
        if (q) out.set(t.instrumentId, q);
      } catch (e) {
        failures++;
        // Stop early if Yahoo is clearly down or limiting us; keep what we have.
        if (failures >= 3) {
          throw new ProviderError('yahoo-unofficial', (e as Error).message, undefined, out);
        }
      }
    }
    if (failures > 0 && out.size === 0)
      throw new ProviderError('yahoo-unofficial', 'all requests failed');
    return out;
  },
};
