import { requireUser } from '@/server/auth';
import { HttpError, ok, route } from '@/server/http';
import { activeTxnIdsFor, applyLedgerChange } from '@/server/ledger';

/** DELETE /api/v1/holdings/:instrumentId: void every manual transaction for this holding. */
export const DELETE = route(
  async (req: Request, ctx: RouteContext<'/api/v1/holdings/[instrumentId]'>) => {
    const { uid } = await requireUser(req);
    const { instrumentId } = await ctx.params;
    const ids = await activeTxnIdsFor(uid, decodeURIComponent(instrumentId));
    if (ids.length === 0) throw new HttpError(404, 'NOT_FOUND', 'Holding not found');
    const result = await applyLedgerChange(uid, {
      retire: ids.map((id) => ({ id, status: 'void' as const })),
    });
    return ok({ removed: ids.length, bookVersion: result.bookVersion });
  },
);
