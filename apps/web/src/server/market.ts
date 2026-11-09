import 'server-only';
import type { AssetClass, FxInfo, PriceInfo } from '@kosh/core';
import {
  type CachedQuote,
  freshness,
  frankfurterFx,
  fxFreshness,
  type ProviderContext,
  type QuoteCache,
} from '@kosh/prices';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';

/**
 * Global market data shared by all users (public data only):
 *   prices/{instrumentId}        latest cached quote
 *   fx/USDINR                    latest reference rate (+ previous, for day change)
 *   fxHistory/USDINR_{date}      rate used for trades on that date
 *   trackedInstruments/{id}      instruments the daily job should price (no user ids)
 */

export const providerContext = (now = new Date()): ProviderContext => ({
  fetch: globalThis.fetch.bind(globalThis),
  now,
  env: process.env,
});

export class FirestoreQuoteCache implements QuoteCache {
  constructor(private readonly db: Firestore = adminDb()) {}

  async getMany(ids: string[]) {
    const out = new Map<string, CachedQuote>();
    if (ids.length === 0) return out;
    const snaps = await this.db.getAll(...ids.map((id) => this.db.doc(`prices/${id}`)));
    for (const s of snaps) if (s.exists) out.set(s.id, s.data() as CachedQuote);
    return out;
  }

  async putMany(quotes: CachedQuote[]) {
    for (let i = 0; i < quotes.length; i += 400) {
      const batch = this.db.batch();
      for (const q of quotes.slice(i, i + 400))
        batch.set(this.db.doc(`prices/${q.instrumentId}`), q);
      await batch.commit();
    }
  }
}

interface FxDoc {
  rate: string;
  prevRate?: string;
  asOf: string;
  source: string;
  fetchedAt: string;
}

const FX_TTL_MS = 6 * 60 * 60 * 1000;

/** Latest USD→INR. Refreshes the cache when older than 6 h; falls back to the cached rate. */
export async function refreshFx(now = new Date(), force = false): Promise<FxInfo | null> {
  const db = adminDb();
  const ref = db.doc('fx/USDINR');
  const snap = await ref.get();
  const cached = snap.exists ? (snap.data() as FxDoc) : null;
  if (cached && !force && now.getTime() - Date.parse(cached.fetchedAt) < FX_TTL_MS) {
    return toFxInfo(cached, now);
  }
  try {
    const r = await frankfurterFx.latest(providerContext(now));
    const prevRate = cached && cached.asOf < r.asOf ? cached.rate : cached?.prevRate;
    const doc: FxDoc = {
      rate: r.rate,
      ...(prevRate ? { prevRate } : {}),
      asOf: r.asOf,
      source: r.source,
      fetchedAt: now.toISOString(),
    };
    await ref.set(doc);
    await db
      .doc(`fxHistory/USDINR_${r.asOf}`)
      .set({ rate: r.rate, asOf: r.asOf, source: r.source });
    return toFxInfo(doc, now);
  } catch (e) {
    console.warn('[fx] refresh failed:', (e as Error).message);
    return cached ? toFxInfo(cached, now) : null;
  }
}

export function toFxInfo(d: FxDoc, now: Date): FxInfo {
  return {
    rate: d.rate,
    ...(d.prevRate ? { prevRate: d.prevRate } : {}),
    asOf: d.asOf,
    source: d.source,
    status: fxFreshness(d.asOf, now),
  };
}

/** USD→INR reference rate for a trade date (closest earlier ECB business day), cached. */
export async function fxOnDate(date: string): Promise<string | null> {
  const db = adminDb();
  const ref = db.doc(`fxHistory/USDINR_${date}`);
  const snap = await ref.get();
  if (snap.exists) return snap.get('rate') as string;
  try {
    const r = await frankfurterFx.onDate(date, providerContext());
    await ref.set({ rate: r.rate, asOf: r.asOf, source: r.source });
    return r.rate;
  } catch (e) {
    console.warn('[fx] historical lookup failed:', (e as Error).message);
    return null;
  }
}

/** Read cached quotes + FX inside a Firestore transaction (reads must precede writes). */
export async function readMarket(tx: Transaction, instrumentIds: string[], now: Date) {
  const db = adminDb();
  const refs = instrumentIds.map((id) => db.doc(`prices/${id}`));
  const [fxSnap, ...snaps] = await tx.getAll(db.doc('fx/USDINR'), ...refs);
  const quotes = new Map<string, CachedQuote>();
  for (const s of snaps) if (s?.exists) quotes.set(s.id, s.data() as CachedQuote);
  const fx = fxSnap?.exists ? toFxInfo(fxSnap.data() as FxDoc, now) : null;
  return { quotes, fx };
}

export function quoteToPriceInfo(q: CachedQuote, assetClass: AssetClass, now: Date): PriceInfo {
  return {
    price: q.price,
    ...(q.prevClose ? { prevClose: q.prevClose } : {}),
    currency: q.currency,
    asOf: q.asOf,
    source: q.source,
    status: freshness(assetClass, q.source, q.asOf, now),
  };
}

export function manualToPriceInfo(
  p: { price: string; asOf: string; prevPrice?: string },
  assetClass: AssetClass,
  currency: 'INR' | 'USD',
  now: Date,
): PriceInfo {
  return {
    price: p.price,
    currency,
    asOf: p.asOf,
    source: 'manual',
    status: freshness(assetClass, 'manual', p.asOf, now),
  };
}
