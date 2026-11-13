// SEC-006: per-symbol providers had no per-run cap, and never-priced (possibly fake) tickers were
// retried on every run. One account adding many fake tickers could stall the shared daily job.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetPriceServiceStateForTests,
  DEFAULT_ROUTES,
  MemoryQuoteCache,
  type PriceProvider,
  type PriceTarget,
  type Quote,
  refreshQuotes,
  yahooProvider,
} from '../src';

const now = new Date('2026-11-09T05:00:00Z');
const ctx = { fetch: globalThis.fetch, now, env: {} };
const target = (sym: string): PriceTarget => ({
  instrumentId: `IN_EQUITY:${sym}`,
  assetClass: 'IN_EQUITY',
  symbol: sym,
  exchange: 'NSE',
});
const quote = (t: PriceTarget): Quote => ({
  instrumentId: t.instrumentId,
  price: '10',
  currency: 'INR',
  asOf: '2026-11-06T10:00:00.000Z',
  source: 'capped',
  delayed: false,
});
const routes = { ...DEFAULT_ROUTES, 'IN_EQUITY:NSE': ['capped'] };

/** Prices only tickers starting with REAL; everything else is "not found". */
const capped = (maxPerRun: number) => {
  const calls: string[][] = [];
  const provider: PriceProvider = {
    id: 'capped',
    label: 'capped',
    assetClasses: ['IN_EQUITY'],
    maxPerRun,
    supports: () => true,
    fetch: vi.fn(async (targets: PriceTarget[]) => {
      calls.push(targets.map((t) => t.symbol));
      return new Map(
        targets.filter((t) => t.symbol.startsWith('REAL')).map((t) => [t.instrumentId, quote(t)]),
      );
    }),
  };
  return { provider, calls };
};

beforeEach(() => __resetPriceServiceStateForTests());

describe('per-run cap (maxPerRun)', () => {
  it('asks a provider for at most maxPerRun symbols per run', async () => {
    const { provider, calls } = capped(2);
    const targets = ['REAL1', 'REAL2', 'REAL3', 'REAL4', 'REAL5'].map(target);
    const r = await refreshQuotes({
      targets,
      cache: new MemoryQuoteCache(),
      providers: [provider],
      routes,
      ctx,
    });
    expect(calls).toEqual([['REAL1', 'REAL2']]);
    expect(r.unpriced).toHaveLength(3);
  });

  it('deferred symbols are not treated as failures: the next run picks them up', async () => {
    const { provider, calls } = capped(2);
    const cache = new MemoryQuoteCache();
    const targets = ['REAL1', 'REAL2', 'REAL3', 'REAL4', 'REAL5'].map(target);
    await refreshQuotes({ targets, cache, providers: [provider], routes, ctx });
    await refreshQuotes({ targets, cache, providers: [provider], routes, ctx });
    const r = await refreshQuotes({ targets, cache, providers: [provider], routes, ctx });
    expect(calls).toEqual([['REAL1', 'REAL2'], ['REAL3', 'REAL4'], ['REAL5']]);
    expect(r.unpriced).toEqual([]);
  });
});

describe('fairness: known-good tickers before never-priced ones', () => {
  it('fake tickers listed first cannot starve tickers that already have a price', async () => {
    const { provider, calls } = capped(3);
    const cache = new MemoryQuoteCache();
    const stale = (t: PriceTarget, fetchedAt: string) =>
      cache.store.set(t.instrumentId, { ...quote(t), fetchedAt });
    const fakes = Array.from({ length: 50 }, (_, i) => target(`FAKE${i}`));
    const real = ['REAL1', 'REAL2', 'REAL3'].map(target);
    stale(real[0]!, '2026-11-08T05:00:00.000Z');
    stale(real[1]!, '2026-11-07T05:00:00.000Z'); // oldest → first
    stale(real[2]!, '2026-11-08T12:00:00.000Z');

    await refreshQuotes({
      targets: [...fakes, ...real],
      cache,
      providers: [provider],
      routes,
      ctx,
    });
    expect(calls).toEqual([['REAL2', 'REAL1', 'REAL3']]);
  });
});

describe('Yahoo (unofficial)', () => {
  it('declares a per-run cap that keeps one run well inside a 60 s function', () => {
    // 400 ms spacing between calls → cap × 0.4 s must leave room for the rest of the job
    expect(yahooProvider.maxPerRun).toBeGreaterThan(0);
    expect(yahooProvider.maxPerRun! * 0.4).toBeLessThanOrEqual(20);
  });
});
