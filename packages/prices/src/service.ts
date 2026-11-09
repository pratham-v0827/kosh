import type { AssetClass } from '@kosh/core';
import type { PriceProvider, PriceTarget, ProviderContext, Quote } from './types';

export interface CachedQuote extends Quote {
  /** When Kosh fetched it (ISO). Drives the cache TTL, not staleness. */
  fetchedAt: string;
}

/** Global, per-instrument quote cache (Firestore `prices/*` in production, a Map in tests). */
export interface QuoteCache {
  getMany(instrumentIds: string[]): Promise<Map<string, CachedQuote>>;
  putMany(quotes: CachedQuote[]): Promise<void>;
}

/** How long a cached quote is reused before asking providers again. */
export function defaultTtlSeconds(assetClass: AssetClass): number {
  switch (assetClass) {
    case 'CRYPTO':
      return 5 * 60;
    case 'US_EQUITY':
      return 15 * 60;
    default:
      return 6 * 60 * 60; // end-of-day sources
  }
}

export interface RefreshQuotesOptions {
  targets: PriceTarget[];
  cache: QuoteCache;
  /** In preference order: the first provider that returns a quote wins (primary → fallback). */
  providers: PriceProvider[];
  ctx: ProviderContext;
  ttlSeconds?: (assetClass: AssetClass) => number;
  /** Ignore the cache TTL (still falls back to cached quotes if every provider fails). */
  force?: boolean;
}

export interface RefreshQuotesResult {
  /** Best available quote per instrument (fresh, else cached). */
  quotes: Map<string, CachedQuote>;
  /** Number of quotes obtained from each provider in this run. */
  fetched: Record<string, number>;
  /** Providers that failed or are not configured. */
  errors: { provider: string; message: string }[];
  /** Targets with no quote at all. */
  unpriced: string[];
}

/**
 * Cache-first refresh with a provider fallback chain. Only `target.symbol` values are sent to
 * providers. When a source gives no previous close (e.g. AMFI), the previously cached price for an
 * older date becomes the previous close, so day change still works.
 */
export async function refreshQuotes(o: RefreshQuotesOptions): Promise<RefreshQuotesResult> {
  const ttl = o.ttlSeconds ?? defaultTtlSeconds;
  const now = o.ctx.now.getTime();
  const unique = [...new Map(o.targets.map((t) => [t.instrumentId, t])).values()];
  const cached = await o.cache.getMany(unique.map((t) => t.instrumentId));

  let remaining = unique.filter((t) => {
    const c = cached.get(t.instrumentId);
    return o.force || !c || now - Date.parse(c.fetchedAt) > ttl(t.assetClass) * 1000;
  });

  const fresh: CachedQuote[] = [];
  const fetched: Record<string, number> = {};
  const errors: RefreshQuotesResult['errors'] = [];
  const fetchedAt = new Date(now).toISOString();

  for (const p of o.providers) {
    const candidates = remaining.filter(
      (t) => p.assetClasses.includes(t.assetClass) && p.supports(t),
    );
    if (candidates.length === 0) continue;
    if (p.requiresEnv && !o.ctx.env[p.requiresEnv]) {
      errors.push({ provider: p.id, message: `not configured (${p.requiresEnv})` });
      continue;
    }
    let got: Map<string, Quote>;
    try {
      got = await p.fetch(candidates, o.ctx);
    } catch (e) {
      errors.push({ provider: p.id, message: e instanceof Error ? e.message : String(e) });
      continue;
    }
    for (const q of got.values()) {
      const prev = cached.get(q.instrumentId);
      let prevClose = q.prevClose;
      if (!prevClose && prev) {
        if (prev.asOf.slice(0, 10) < q.asOf.slice(0, 10)) prevClose = prev.price;
        else if (prev.asOf.slice(0, 10) === q.asOf.slice(0, 10)) prevClose = prev.prevClose;
      }
      fresh.push({ ...q, ...(prevClose ? { prevClose } : {}), fetchedAt });
    }
    fetched[p.id] = got.size;
    remaining = remaining.filter((t) => !got.has(t.instrumentId));
  }

  if (fresh.length) await o.cache.putMany(fresh);
  const quotes = new Map(cached);
  for (const q of fresh) quotes.set(q.instrumentId, q);
  return {
    quotes,
    fetched,
    errors,
    unpriced: unique.filter((t) => !quotes.has(t.instrumentId)).map((t) => t.instrumentId),
  };
}

/** In-memory cache for tests and scripts. */
export class MemoryQuoteCache implements QuoteCache {
  readonly store = new Map<string, CachedQuote>();
  async getMany(ids: string[]) {
    return new Map(
      ids.flatMap((id) => (this.store.has(id) ? [[id, this.store.get(id)!] as const] : [])),
    );
  }
  async putMany(quotes: CachedQuote[]) {
    for (const q of quotes) this.store.set(q.instrumentId, q);
  }
}
