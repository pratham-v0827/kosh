import type { AssetClass } from '@kosh/core';
import { ProviderError } from './http';
import { DEFAULT_ROUTES, type RouteKey, routeKey } from './routing';
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
    case 'IN_EQUITY':
      return 15 * 60;
    default:
      return 6 * 60 * 60; // end-of-day sources
  }
}

/** After every provider failed for a symbol, don't ask again for this long (per instance). */
export const FAILURE_BACKOFF_MS = 10 * 60_000;

export interface RefreshQuotesOptions {
  targets: PriceTarget[];
  cache: QuoteCache;
  /** Provider registry. Order inside a route comes from `routes`. */
  providers: PriceProvider[];
  routes?: Readonly<Record<RouteKey, readonly string[]>>;
  ctx: ProviderContext;
  ttlSeconds?: (assetClass: AssetClass) => number;
  /** Ignore the cache TTL and failure back-off (still falls back to cached quotes). */
  force?: boolean;
}

export interface RefreshQuotesResult {
  /** Best available quote per instrument (fresh, else cached). */
  quotes: Map<string, CachedQuote>;
  /** Number of quotes obtained from each provider in this run. */
  fetched: Record<string, number>;
  /** Providers that failed, are disabled or are not configured. No secrets in messages. */
  errors: { provider: string; message: string }[];
  /** Targets with no quote at all. */
  unpriced: string[];
}

// Per-instance coordination: concurrent refreshes share in-flight lookups, and symbols that just
// failed everywhere are not hammered again.
const inflight = new Map<string, Promise<CachedQuote | null>>();
const failedAt = new Map<string, number>();

export function __resetPriceServiceStateForTests() {
  inflight.clear();
  failedAt.clear();
}

/**
 * Cache-first refresh with per-route fallback chains. Each instrument is fetched at most once per
 * call, and at most once across concurrent calls in the same server instance. Only `symbol`
 * values are sent to providers. When a source gives no previous close (e.g. AMFI), the previously
 * cached price for an older date becomes the previous close, so day change still works.
 */
export async function refreshQuotes(o: RefreshQuotesOptions): Promise<RefreshQuotesResult> {
  const ttl = o.ttlSeconds ?? defaultTtlSeconds;
  const routes = o.routes ?? DEFAULT_ROUTES;
  const registry = new Map(o.providers.map((p) => [p.id, p]));
  const now = o.ctx.now.getTime();
  const unique = [...new Map(o.targets.map((t) => [t.instrumentId, t])).values()];
  const cached = await o.cache.getMany(unique.map((t) => t.instrumentId));

  const due = unique.filter((t) => {
    if (!o.force && now - (failedAt.get(t.instrumentId) ?? 0) < FAILURE_BACKOFF_MS) return false;
    const c = cached.get(t.instrumentId);
    return o.force || !c || now - Date.parse(c.fetchedAt) > ttl(t.assetClass) * 1000;
  });

  // Join lookups another refresh already started; own the rest.
  const joined: Promise<CachedQuote | null>[] = [];
  const mine: PriceTarget[] = [];
  const settle = new Map<string, (q: CachedQuote | null) => void>();
  for (const t of due) {
    const existing = inflight.get(t.instrumentId);
    if (existing) {
      joined.push(existing);
      continue;
    }
    mine.push(t);
    inflight.set(t.instrumentId, new Promise((resolve) => settle.set(t.instrumentId, resolve)));
  }

  // SEC-006 fairness: instruments that already have a price go first (oldest first); never-priced
  // ones (new, or fake tickers) go last, so they cannot starve the rest when a provider is capped.
  const age = (t: PriceTarget) => {
    const c = cached.get(t.instrumentId);
    return c ? Date.parse(c.fetchedAt) : Number.POSITIVE_INFINITY;
  };
  mine.sort((a, b) => age(a) - age(b));
  /** Not attempted because of a provider's per-run cap: not a failure, just "next run". */
  const deferred = new Set<string>();

  const fresh: CachedQuote[] = [];
  const fetched: Record<string, number> = {};
  const errors: RefreshQuotesResult['errors'] = [];
  const reported = new Set<string>();
  const report = (provider: string, message: string) => {
    const k = `${provider}|${message}`;
    if (!reported.has(k)) {
      reported.add(k);
      errors.push({ provider, message });
    }
  };
  const fetchedAt = new Date(now).toISOString();

  const accept = (got: Map<string, Quote>, providerId: string) => {
    for (const q of got.values()) {
      const prev = cached.get(q.instrumentId);
      let prevClose = q.prevClose;
      if (!prevClose && prev) {
        if (prev.asOf.slice(0, 10) < q.asOf.slice(0, 10)) prevClose = prev.price;
        else if (prev.asOf.slice(0, 10) === q.asOf.slice(0, 10)) prevClose = prev.prevClose;
      }
      fresh.push({ ...q, ...(prevClose ? { prevClose } : {}), fetchedAt });
    }
    fetched[providerId] = (fetched[providerId] ?? 0) + got.size;
  };

  try {
    const groups = new Map<RouteKey, PriceTarget[]>();
    for (const t of mine) {
      const k = routeKey(t);
      groups.set(k, [...(groups.get(k) ?? []), t]);
    }
    for (const [key, group] of groups) {
      let remaining = group;
      for (const id of routes[key] ?? []) {
        if (remaining.length === 0) break;
        const p = registry.get(id);
        if (!p) continue;
        const candidates = remaining.filter(
          (t) => p.assetClasses.includes(t.assetClass) && p.supports(t),
        );
        if (candidates.length === 0) continue;
        if (p.isEnabled && !p.isEnabled(o.ctx.env)) {
          report(p.id, 'disabled by configuration');
          continue;
        }
        if (p.requiresEnv && !o.ctx.env[p.requiresEnv]) {
          report(p.id, `not configured (${p.requiresEnv})`);
          continue;
        }
        const attempt = p.maxPerRun ? candidates.slice(0, p.maxPerRun) : candidates;
        for (const t of candidates.slice(attempt.length)) deferred.add(t.instrumentId);
        let got: Map<string, Quote>;
        try {
          got = await p.fetch(attempt, o.ctx);
        } catch (e) {
          report(p.id, e instanceof Error ? e.message : String(e));
          got = e instanceof ProviderError && e.partial ? e.partial : new Map();
        }
        accept(got, p.id);
        remaining = remaining.filter((t) => !got.has(t.instrumentId));
      }
      for (const t of remaining)
        if (!deferred.has(t.instrumentId)) failedAt.set(t.instrumentId, now);
    }
    if (fresh.length) await o.cache.putMany(fresh);
  } finally {
    const byId = new Map(fresh.map((q) => [q.instrumentId, q]));
    for (const t of mine) {
      settle.get(t.instrumentId)?.(byId.get(t.instrumentId) ?? null);
      inflight.delete(t.instrumentId);
    }
  }

  const quotes = new Map(cached);
  for (const q of fresh) quotes.set(q.instrumentId, q);
  for (const q of await Promise.all(joined)) if (q) quotes.set(q.instrumentId, q);
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

/** In-memory request budget for tests and scripts. */
export class MemoryRequestBudget {
  readonly used = new Map<string, number>();
  async reserve(provider: string, n: number, limit: number) {
    const u = this.used.get(provider) ?? 0;
    const granted = Math.max(0, Math.min(n, limit - u));
    this.used.set(provider, u + granted);
    return granted;
  }
  async exhaust(provider: string, limit: number) {
    this.used.set(provider, limit);
  }
}
