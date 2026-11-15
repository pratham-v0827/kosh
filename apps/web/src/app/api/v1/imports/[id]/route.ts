import { requireUser } from '@/server/auth';
import { ok, route } from '@/server/http';
import { removeImport } from '@/server/imports';
import { docIdParam } from '@/server/params';

/**
 * DELETE /api/v1/imports/:id: discard a draft, or undo a confirmed import (its transactions are
 * voided and kept for history; the book is recomputed).
 */
export const DELETE = route(async (req: Request, ctx: RouteContext<'/api/v1/imports/[id]'>) => {
  const { uid } = await requireUser(req);
  const id = docIdParam((await ctx.params).id);
  return ok(await removeImport(uid, id));
});
