import { coverage } from '@kosh/prices';
import { connection } from 'next/server';
import { requireUser } from '@/server/auth';
import { ok, route } from '@/server/http';

/** GET /api/v1/prices/coverage: which asset types this instance can price automatically (booleans only, no keys). */
export const GET = route(async (req: Request) => {
  await connection(); // per-user and env-dependent: never prerender
  await requireUser(req);
  return ok({ coverage: coverage(process.env) });
});
