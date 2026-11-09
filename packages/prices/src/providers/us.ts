import { getJson, ProviderError } from '../http';
import type { PriceProvider, PriceTarget, Quote } from '../types';

/**
 * US equities. Both need a free API key from the provider (the user signs up themselves).
 * Response formats follow the providers' public documentation; verify against a live key.
 * Free tiers may delay quotes and may be limited to personal use (unverified).
 */

const supportsUs = (t: PriceTarget) =>
  t.assetClass === 'US_EQUITY' && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t.symbol);

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Finnhub /quote: { c: current, pc: previous close, t: epoch seconds }. Free tier ~60 calls/min. */
export const finnhubProvider: PriceProvider = {
  id: 'finnhub',
  label: 'Finnhub (free API key)',
  assetClasses: ['US_EQUITY'],
  requiresEnv: 'FINNHUB_API_KEY',
  supports: supportsUs,
  async fetch(targets, ctx) {
    const key = ctx.env.FINNHUB_API_KEY;
    if (!key) throw new ProviderError('finnhub', 'FINNHUB_API_KEY not set');
    const out = new Map<string, Quote>();
    for (const [i, t] of targets.entries()) {
      if (i > 0) await pause(1100); // stay under ~60/min
      const q = await getJson<{ c?: number; pc?: number; t?: number }>(
        'finnhub',
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(t.symbol)}&token=${encodeURIComponent(key)}`,
        ctx,
      );
      if (!q.c || q.c <= 0 || !q.t) continue; // unknown symbols return zeros
      out.set(t.instrumentId, {
        instrumentId: t.instrumentId,
        price: String(q.c),
        ...(q.pc && q.pc > 0 ? { prevClose: String(q.pc) } : {}),
        currency: 'USD',
        asOf: new Date(q.t * 1000).toISOString(),
        source: 'finnhub',
        delayed: true,
      });
    }
    return out;
  },
};

/** Twelve Data /quote: { close, previous_close, timestamp }. Free tier ~8 calls/min, 800/day. */
export const twelveDataProvider: PriceProvider = {
  id: 'twelvedata',
  label: 'Twelve Data (free API key)',
  assetClasses: ['US_EQUITY'],
  requiresEnv: 'TWELVEDATA_API_KEY',
  supports: supportsUs,
  async fetch(targets, ctx) {
    const key = ctx.env.TWELVEDATA_API_KEY;
    if (!key) throw new ProviderError('twelvedata', 'TWELVEDATA_API_KEY not set');
    const out = new Map<string, Quote>();
    for (const [i, t] of targets.entries()) {
      if (i > 0) await pause(8000); // ~8/min
      const q = await getJson<{
        close?: string;
        previous_close?: string;
        timestamp?: number;
        status?: string;
      }>(
        'twelvedata',
        `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(t.symbol)}&apikey=${encodeURIComponent(key)}`,
        ctx,
      );
      if (q.status === 'error' || !q.close || Number(q.close) <= 0 || !q.timestamp) continue;
      out.set(t.instrumentId, {
        instrumentId: t.instrumentId,
        price: q.close,
        ...(q.previous_close && Number(q.previous_close) > 0
          ? { prevClose: q.previous_close }
          : {}),
        currency: 'USD',
        asOf: new Date(q.timestamp * 1000).toISOString(),
        source: 'twelvedata',
        delayed: true,
      });
    }
    return out;
  },
};
