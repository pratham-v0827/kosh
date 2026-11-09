import { requireUser } from '@/server/auth';
import { ok, route } from '@/server/http';
import { refreshUser } from '@/server/refresh';

/**
 * POST /api/v1/refresh: fetch the latest prices for the user's holdings and record an immutable
 * snapshot. Limited to one every 5 minutes and 30 a day (429 with retryAfter seconds).
 */
export const POST = route(async (req: Request) => {
  const { uid } = await requireUser(req);
  return ok(await refreshUser(uid, 'manual'));
});
