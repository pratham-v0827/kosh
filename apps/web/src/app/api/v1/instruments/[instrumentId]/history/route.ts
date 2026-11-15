import { requireUser } from '@/server/auth';
import { ok, route } from '@/server/http';
import { instrumentIdParam } from '@/server/params';
import { ensurePriceHistory } from '@/server/price-history';

/**
 * POST /api/v1/instruments/:instrumentId/history: make sure the daily price history of one of
 * your holdings is current (the holding page then reads it from `priceHistory/{id}`). Cheap after
 * the first call of the day. 404 for instruments you do not hold.
 */
export const POST = route(
  async (req: Request, ctx: RouteContext<'/api/v1/instruments/[instrumentId]/history'>) => {
    const { uid } = await requireUser(req);
    const id = instrumentIdParam((await ctx.params).instrumentId);
    return ok({ status: await ensurePriceHistory(uid, id) });
  },
);
