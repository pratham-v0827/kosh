import { requireUser } from '@/server/auth';
import { ok, route } from '@/server/http';
import { recordSignIn } from '@/server/session';

/** POST /api/v1/session: call once after sign-in. Creates the account on first sign-in. */
export const POST = route(async (req: Request) => {
  const { uid } = await requireUser(req);
  const { created } = await recordSignIn(uid);
  return ok({ uid, created }, created ? 201 : 200);
});
