import 'server-only';
import type { AssetClass } from '@kosh/core';
import { fetchDailyHistory, historySourceFor } from '@kosh/prices';
import { adminDb } from '@/lib/firebase/admin';
import { CLAIM_MS, claimDailyFetch, markRetry, storeDailyCloses } from './daily-closes';
import { HttpError } from './http';
import { istToday } from './ledger';
import { providerContext } from './market';

/** pending: another request is fetching this history right now; it arrives by itself. */
export type HistoryStatus = 'fresh' | 'updated' | 'pending' | 'unsupported' | 'unavailable';

/**
 * Bring the shared daily price history of one of the user's instruments up to date (at most one
 * request to the source per instrument per day). Only instruments the user holds can be asked
 * for, and the symbol comes from the user's stored instrument, never from the request.
 */
export async function ensurePriceHistory(
  uid: string,
  instrumentId: string,
  now = new Date(),
): Promise<HistoryStatus> {
  const db = adminDb();
  const inst = await db.doc(`users/${uid}/instruments/${instrumentId}`).get();
  if (!inst.exists) throw new HttpError(404, 'NOT_FOUND', 'No such holding');
  const symbol = inst.get('symbol') as string | null;
  const source = symbol
    ? historySourceFor({
        instrumentId,
        assetClass: inst.get('assetClass') as AssetClass,
        symbol,
        ...(inst.get('exchange') ? { exchange: inst.get('exchange') as 'NSE' | 'BSE' } : {}),
      })
    : null;
  if (!source) return 'unsupported';

  const ref = db.doc(`priceHistory/${instrumentId}`);
  const today = istToday(now);
  const { range, state } = await claimDailyFetch(ref, today, now);
  // Skipped: done today, failed within the hour, or another request is fetching it right now.
  if (range === 'skip') {
    if (state?.to) return 'fresh';
    const claimed = (state?.retryAfter ?? 0) - now.getTime();
    return claimed > 0 && claimed <= CLAIM_MS ? 'pending' : 'unavailable';
  }

  const r = await fetchDailyHistory(source, range, providerContext(now));
  if (r.status !== 'ok' || r.closes.length === 0) {
    await markRetry(ref, now);
    return 'unavailable';
  }
  await storeDailyCloses(
    ref,
    r.closes,
    {
      source: source.provider === 'yahoo' ? 'yahoo-unofficial' : 'mfapi',
      currency: source.provider === 'yahoo' ? source.currency : 'INR',
    },
    state,
    today,
    now,
  );
  return 'updated';
}
