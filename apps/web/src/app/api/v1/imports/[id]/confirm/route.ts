import { ImportConfirmInput } from '@kosh/contracts';
import { after } from 'next/server';
import { requireUser } from '@/server/auth';
import { ok, readJson, route } from '@/server/http';
import { confirmImport } from '@/server/imports';
import { docIdParam } from '@/server/params';
import { refreshUser } from '@/server/refresh';

/**
 * POST /api/v1/imports/:id/confirm: add the draft's new rows to the ledger. Rows already there
 * (same fingerprint) are skipped, so confirming the same statement twice adds nothing.
 */
export const POST = route(
  async (req: Request, ctx: RouteContext<'/api/v1/imports/[id]/confirm'>) => {
    const { uid } = await requireUser(req);
    const id = docIdParam((await ctx.params).id);
    const input = await readJson(req, ImportConfirmInput);
    const result = await confirmImport(uid, id, input.skipLines);
    // Price the new holdings and record a snapshot after the response; the book already shows
    // the imported rows with cached prices.
    after(async () => {
      try {
        await refreshUser(uid, 'import');
      } catch (e) {
        console.warn('[import] post-import refresh failed:', (e as Error).message);
      }
    });
    return ok(result);
  },
);
