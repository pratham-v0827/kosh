import 'server-only';
import type { AssetClass } from '@kosh/core';
import { DEFAULT_PROVIDERS, type PriceTarget, refreshQuotes } from '@kosh/prices';
import { FieldPath } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { HttpError } from './http';
import {
  applyLedgerChange,
  istToday,
  REFRESH_COOLDOWN_MS,
  REFRESH_DAILY_LIMIT,
  type RefreshTrigger,
} from './ledger';
import { FirestoreQuoteCache, providerContext, refreshFx } from './market';

/** Targets for a user's open, listed holdings. Only public symbols leave the server. */
async function userTargets(uid: string): Promise<PriceTarget[]> {
  const db = adminDb();
  const [instSnap, bookSnap] = await Promise.all([
    db.collection(`users/${uid}/instruments`).get(),
    db.doc(`users/${uid}/book/current`).get(),
  ]);
  const holdings = (bookSnap.get('holdings') ?? {}) as Record<
    string,
    { instrumentId: string; qty: string }
  >;
  const open = new Set(
    Object.values(holdings)
      .filter((h) => Number(h.qty) > 0)
      .map((h) => h.instrumentId),
  );
  return instSnap.docs
    .filter((d) => open.has(d.id) && d.get('symbol') && d.get('assetClass') !== 'UNLISTED')
    .map((d) => ({
      instrumentId: d.id,
      assetClass: d.get('assetClass') as AssetClass,
      symbol: d.get('symbol') as string,
      ...(d.get('exchange') ? { exchange: d.get('exchange') as 'NSE' | 'BSE' } : {}),
    }));
}

/** Fast pre-check so a rate-limited user doesn't trigger provider calls (authoritative check is in the transaction). */
async function precheckLimits(uid: string) {
  const meta = (await adminDb().doc(`userMeta/${uid}`).get()).data();
  const last = meta?.lastManualRefreshAt?.toDate?.() as Date | undefined;
  if (last && Date.now() - last.getTime() < REFRESH_COOLDOWN_MS) {
    const retryAfter = Math.ceil((REFRESH_COOLDOWN_MS - (Date.now() - last.getTime())) / 1000);
    throw new HttpError(
      429,
      'REFRESH_COOLDOWN',
      `You can refresh again in ${Math.ceil(retryAfter / 60)} min`,
      { retryAfter },
    );
  }
  if (meta?.refreshDay === istToday() && Number(meta?.refreshesToday ?? 0) >= REFRESH_DAILY_LIMIT) {
    throw new HttpError(
      429,
      'REFRESH_DAILY_LIMIT',
      `Daily limit of ${REFRESH_DAILY_LIMIT} refreshes reached`,
      { retryAfter: 3600 },
    );
  }
}

export async function refreshUser(uid: string, trigger: RefreshTrigger) {
  if (trigger === 'manual' || trigger === 'mcp') await precheckLimits(uid);
  const now = new Date();
  const targets = await userTargets(uid);
  const prices = await refreshQuotes({
    targets,
    cache: new FirestoreQuoteCache(),
    providers: DEFAULT_PROVIDERS,
    ctx: providerContext(now),
  });
  await refreshFx(now);
  const result = await applyLedgerChange(uid, { snapshot: { trigger } });
  return {
    snapshotId: result.snapshotId,
    totals: result.totals,
    sources: prices.fetched,
    // Provider problems are shown as a hint; no user data is in these messages.
    problems: prices.errors,
    unpriced: prices.unpriced,
  };
}

/** Price every tracked instrument once for everyone (bulk sources: one download each). */
export async function refreshTrackedInstruments() {
  const db = adminDb();
  const now = new Date();
  const snap = await db.collection('trackedInstruments').get();
  const targets: PriceTarget[] = snap.docs.map((d) => ({
    instrumentId: d.id,
    assetClass: d.get('assetClass') as AssetClass,
    symbol: d.get('symbol') as string,
    ...(d.get('exchange') ? { exchange: d.get('exchange') as 'NSE' | 'BSE' } : {}),
  }));
  const r = await refreshQuotes({
    targets,
    cache: new FirestoreQuoteCache(db),
    providers: DEFAULT_PROVIDERS,
    ctx: providerContext(now),
  });
  const fx = await refreshFx(now, true);
  return {
    tracked: targets.length,
    fetched: r.fetched,
    problems: r.errors,
    unpriced: r.unpriced.length,
    fx: fx?.asOf ?? null,
  };
}

/**
 * Snapshot users in pages, in document-id order, until the time budget is used.
 * Idempotent per day: users already snapshotted by the scheduled job today are skipped.
 */
export async function snapshotUsers(cursor: string | null, budgetMs: number) {
  const db = adminDb();
  const started = Date.now();
  let last = cursor;
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  for (;;) {
    let q = db.collection('users').orderBy(FieldPath.documentId()).limit(20).select();
    if (last) q = q.startAfter(last);
    const page = await q.get();
    if (page.empty) return { processed, skipped, failed, nextCursor: null };
    const metas = await db.getAll(...page.docs.map((d) => db.doc(`userMeta/${d.id}`)));
    for (const [i, doc] of page.docs.entries()) {
      if (Date.now() - started > budgetMs) return { processed, skipped, failed, nextCursor: last };
      last = doc.id;
      if (metas[i]?.get('status') === 'blocked') {
        skipped++;
        continue;
      }
      try {
        const r = await applyLedgerChange(doc.id, { snapshot: { trigger: 'scheduled' } });
        if (r.skipped) skipped++;
        else processed++;
      } catch (e) {
        failed++;
        console.error('[cron] snapshot failed for a user:', (e as Error).message); // no user id in logs
      }
    }
    if (page.size < 20) return { processed, skipped, failed, nextCursor: null };
  }
}
