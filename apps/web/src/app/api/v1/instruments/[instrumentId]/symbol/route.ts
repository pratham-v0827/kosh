import { InstrumentSymbolInput } from '@kosh/contracts';
import { after } from 'next/server';
import { requireUser } from '@/server/auth';
import { ok, readJson, route } from '@/server/http';
import { instrumentIdParam } from '@/server/params';
import { refreshUser } from '@/server/refresh';
import { mapInstrumentSymbol } from '@/server/statement-imports';

/**
 * PUT /api/v1/instruments/:instrumentId/symbol: give a holding that was imported under its ISIN
 * an exchange ticker. The holding moves to the ticker's identity, so it can be priced and shows
 * together with the same stock held elsewhere.
 */
export const PUT = route(
  async (req: Request, ctx: RouteContext<'/api/v1/instruments/[instrumentId]/symbol'>) => {
    const { uid } = await requireUser(req);
    const id = instrumentIdParam((await ctx.params).instrumentId);
    const input = await readJson(req, InstrumentSymbolInput);
    const result = await mapInstrumentSymbol(uid, id, input);
    after(async () => {
      try {
        await refreshUser(uid, 'import'); // fetch a price for the newly mapped ticker
      } catch (e) {
        console.warn('[import] refresh after mapping failed:', (e as Error).message);
      }
    });
    return ok(result);
  },
);
