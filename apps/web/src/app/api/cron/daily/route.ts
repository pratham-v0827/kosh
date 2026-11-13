import { after, type NextRequest } from 'next/server';
import { assertCronAuthorised, snapshotBudgetMs } from '@/server/cron-auth';
import { ok, route } from '@/server/http';
import { refreshTrackedInstruments, snapshotUsers } from '@/server/refresh';

// Each invocation stays well inside Vercel Hobby's 60 s function limit (see RUN_BUDGET_MS).
export const maxDuration = 60;

/**
 * GET /api/cron/daily: the end-of-day job (Vercel cron sends `Authorization: Bearer CRON_SECRET`).
 *   1. First page only: refresh prices for all tracked instruments + FX (bulk, once).
 *   2. Snapshot users in id order until the time budget is used.
 *   3. If users remain, continue in a new invocation (?cursor=…) unless ?chain=0.
 */
export const GET = route(async (req: NextRequest) => {
  assertCronAuthorised(req.headers.get('authorization'));
  const started = Date.now();
  const url = new URL(req.url);
  const cursor = url.searchParams.get('cursor');
  const chain = url.searchParams.get('chain') !== '0';

  const prices = cursor ? null : await refreshTrackedInstruments();
  // The price step and the snapshots share one time budget (SEC-006).
  const users = await snapshotUsers(cursor, snapshotBudgetMs(started, Date.now()));

  if (users.nextCursor && chain) {
    const next = new URL(url);
    next.searchParams.set('cursor', users.nextCursor);
    after(async () => {
      await fetch(next, {
        headers: { authorization: req.headers.get('authorization') ?? '' },
      }).catch((e) => console.error('[cron] continuation failed:', (e as Error).message));
    });
  }
  return ok({ prices, users });
});
