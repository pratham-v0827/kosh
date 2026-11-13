import 'server-only';
import { adminAuth } from '@/lib/firebase/admin';
import { HttpError } from './http';

export interface AuthedUser {
  uid: string;
}

/**
 * Verify the Firebase ID token sent as `Authorization: Bearer <token>`.
 * checkRevoked=true also rejects disabled (blocked) users and revoked sessions.
 */
export async function requireUser(req: Request): Promise<AuthedUser> {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header);
  if (!match) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in');

  try {
    const decoded = await adminAuth().verifyIdToken(match[1]!, true);
    if (decoded.blocked === true) throw new HttpError(403, 'BLOCKED', 'This account is blocked');
    return { uid: decoded.uid };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const code = (e as { code?: string }).code;
    if (code === 'auth/user-disabled') {
      throw new HttpError(403, 'BLOCKED', 'This account is blocked');
    }
    throw new HttpError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again');
  }
}
