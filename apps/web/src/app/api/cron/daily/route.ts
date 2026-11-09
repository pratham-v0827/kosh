import { after, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { HttpError, ok, route } from '@/server/http';
import { refreshTrackedInstruments, snapshotUsers } from '@/server/refresh';

// Each invocation stays well inside Vercel Hobby's 60 s function limit (ADR-0018).
const BUDGET_MS = 40_000;
export const maxDuration = 60;

function authorise(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new HttpError(503, 'CRON_DISABLED', 'CRON_SECRET is not configured');
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid cron secret');
  }
}

/**
 * GET /api/cron/daily: the end-of-day job (Vercel cron sends `Authorization: Bearer CRON_SECRET`).
 *   1. First page only: refresh prices for all tracked instruments + FX (bulk, once).
 *   2. Snapshot users in id order until the time budget is used.
 *   3. If users remain, continue in a new invocation (?cursor=…) unless ?chain=0.
 */
export const GET = route(async (req: NextRequest) => {
  authorise(req);
  const url = new URL(req.url);
  const cursor = url.searchParams.get('cursor');
  const chain = url.searchParams.get('chain') !== '0';

  const prices = cursor ? null : await refreshTrackedInstruments();
  const users = await snapshotUsers(cursor, BUDGET_MS);

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
