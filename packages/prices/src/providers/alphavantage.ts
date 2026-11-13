import Decimal from 'decimal.js';
import { z } from 'zod';
import { createThrottle, getText, istCloseIso, ProviderError } from '../http';
import { INDIAN_ISIN, type PriceProvider, type PriceTarget, type Quote } from '../types';

/**
 * Alpha Vantage, FREE key, used ONLY for BSE-listed Indian stocks.
 * Free tier (checked 2026-11-09, third-party sources; confirm at alphavantage.co/premium):
 * ~25 requests/day and ~5/minute. Errors and rate limits come back as HTTP 200 with a
 * "Note" / "Information" / "Error Message" body — those are failures, never prices.
 * BSE symbol format "<TICKER>.BSE" (e.g. RELIANCE.BSE) is community-reported; unverified
 * against official docs. The key is server-only.
 */

const BASE = 'https://www.alphavantage.co/query';
export const AV_DEFAULT_DAILY_LIMIT = 25;
/** Keep each refresh quick: at most this many AV calls per refresh; the rest fall back to Yahoo. */
export const AV_MAX_CALLS_PER_RUN = 3;
// ≤ 5/minute by default; ALPHAVANTAGE_MIN_INTERVAL_MS overrides (tests use 0).
const throttles = new Map<number, ReturnType<typeof createThrottle>>();
const throttleFor = (ms: number) => {
  if (!throttles.has(ms)) throttles.set(ms, createThrottle(ms));
  return throttles.get(ms)!;
};

const GlobalQuote = z.object({
  'Global Quote': z
    .object({
      '01. symbol': z.string(),
      '05. price': z.string(),
      '07. latest trading day': z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      '08. previous close': z.string().optional(),
    })
    .partial({ '08. previous close': true })
    .or(z.object({}).strict()), // {} = unknown symbol
});

const LimitBody = z
  .object({ Note: z.string() })
  .or(z.object({ Information: z.string() }))
  .or(z.object({ 'Error Message': z.string() }));

export type AvOutcome =
  | { kind: 'quote'; quote: Quote }
  | { kind: 'not-found' }
  | { kind: 'limited'; message: string }
  | { kind: 'error'; message: string };

export function avSymbol(t: PriceTarget): string | null {
  return t.assetClass === 'IN_EQUITY' &&
    t.exchange === 'BSE' &&
    /^[A-Z0-9&-]{1,20}$/.test(t.symbol) &&
    !INDIAN_ISIN.test(t.symbol) // BUG-007: never spend the daily budget on an ISIN
    ? `${t.symbol}.BSE`
    : null;
}

const positive = (s: string | undefined) =>
  s && Number(s) > 0 ? new Decimal(s).toString() : undefined;

/** Classify one Alpha Vantage response body. */
export function parseGlobalQuote(body: string, t: PriceTarget): AvOutcome {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { kind: 'error', message: 'invalid JSON' };
  }
  const limited = LimitBody.safeParse(json);
  if (limited.success) {
    const d = limited.data as Record<string, string>;
    const msg = d.Note ?? d.Information ?? d['Error Message'] ?? '';
    // "Error Message" = bad call/symbol; Note/Information = quota or key problems.
    return 'Error Message' in d
      ? { kind: 'error', message: msg.slice(0, 160) }
      : { kind: 'limited', message: msg.slice(0, 160) };
  }
  const parsed = GlobalQuote.safeParse(json);
  if (!parsed.success)
    return { kind: 'error', message: 'unexpected response shape (format changed?)' };
  const g = parsed.data['Global Quote'] as Record<string, string | undefined>;
  const price = positive(g['05. price']);
  const day = g['07. latest trading day'];
  if (!price || !day) return { kind: 'not-found' };
  const prev = positive(g['08. previous close']);
  return {
    kind: 'quote',
    quote: {
      instrumentId: t.instrumentId,
      price,
      ...(prev ? { prevClose: prev } : {}),
      currency: 'INR',
      asOf: istCloseIso(day),
      source: 'alphavantage',
      delayed: true,
    },
  };
}

export const alphaVantageProvider: PriceProvider = {
  id: 'alphavantage',
  label: 'Alpha Vantage (free key, BSE only)',
  assetClasses: ['IN_EQUITY'],
  requiresEnv: 'ALPHAVANTAGE_API_KEY',
  supports: (t) => avSymbol(t) !== null,
  async fetch(targets, ctx) {
    const key = ctx.env.ALPHAVANTAGE_API_KEY;
    if (!key) throw new ProviderError('alphavantage', 'ALPHAVANTAGE_API_KEY not set');
    const limit = Math.max(
      0,
      Number(ctx.env.ALPHAVANTAGE_DAILY_LIMIT ?? AV_DEFAULT_DAILY_LIMIT) || 0,
    );
    const wanted = targets.slice(0, AV_MAX_CALLS_PER_RUN);
    // No budget store → refuse rather than risk blowing the shared quota.
    if (!ctx.budget) throw new ProviderError('alphavantage', 'no request budget configured');
    const granted = await ctx.budget.reserve('alphavantage', wanted.length, limit);
    const out = new Map<string, Quote>();
    if (granted === 0)
      throw new ProviderError('alphavantage', 'daily free quota used up', 429, out);

    for (const t of wanted.slice(0, granted)) {
      const url = `${BASE}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(avSymbol(t)!)}&apikey=${encodeURIComponent(key)}`;
      let body: string;
      try {
        const interval = Math.max(0, Number(ctx.env.ALPHAVANTAGE_MIN_INTERVAL_MS ?? 12_500) || 0);
        body = await throttleFor(interval)(() =>
          getText('alphavantage', url, ctx, { timeoutMs: 10_000 }),
        );
      } catch (e) {
        throw new ProviderError(
          'alphavantage',
          (e as Error).message.replace(key, '***'),
          undefined,
          out,
        );
      }
      const r = parseGlobalQuote(body, t);
      if (r.kind === 'quote') out.set(t.instrumentId, r.quote);
      else if (r.kind === 'limited') {
        await ctx.budget.exhaust('alphavantage', limit);
        throw new ProviderError('alphavantage', 'rate limit reached', 429, out);
      } else if (r.kind === 'error') {
        // A bad key affects every call: stop. A bad symbol affects only this one: skip it.
        if (/api ?key/i.test(r.message))
          throw new ProviderError('alphavantage', 'API key rejected', 401, out);
      }
    }
    if (granted < wanted.length)
      throw new ProviderError('alphavantage', 'daily free quota used up', 429, out);
    return out;
  },
};
