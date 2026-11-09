import { ManualPriceInput } from '@kosh/contracts';
import { requireUser } from '@/server/auth';
import { ok, readJson, route } from '@/server/http';
import { applyLedgerChange } from '@/server/ledger';

/**
 * PUT /api/v1/instruments/:instrumentId/price: set a manual (indicative) price in the holding's
 * own currency. If a provider later has a newer price, the newer one is used.
 */
export const PUT = route(
  async (req: Request, ctx: RouteContext<'/api/v1/instruments/[instrumentId]/price'>) => {
    const { uid } = await requireUser(req);
    const { instrumentId } = await ctx.params;
    const input = await readJson(req, ManualPriceInput);
    const id = decodeURIComponent(instrumentId);
    const result = await applyLedgerChange(uid, {
      manualPrices: { [id]: { price: input.price, asOf: input.asOf } },
    });
    return ok({ bookVersion: result.bookVersion });
  },
);
