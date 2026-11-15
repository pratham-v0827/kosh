import { after } from 'next/server';
import { requireUser } from '@/server/auth';
import { ok, route } from '@/server/http';
import { refreshIndices } from '@/server/indices';
import { refreshUser } from '@/server/refresh';

/**
 * POST /api/v1/refresh: fetch the latest prices for the user's holdings and record an immutable
 * snapshot. Limited to one every 5 minutes and 30 a day (429 with retryAfter seconds).
 * Benchmark indices are brought up to date after the response (at most once a day, shared).
 */
export const POST = route(async (req: Request) => {
  const { uid } = await requireUser(req);
  const result = await refreshUser(uid, 'manual');
  after(async () => {
    const r = await refreshIndices();
    for (const [id, status] of Object.entries(r)) {
      if (status.startsWith('failed') || status.startsWith('unavailable'))
        console.warn(`[indices] ${id}: ${status}`);
    }
  });
  return ok(result);
});
