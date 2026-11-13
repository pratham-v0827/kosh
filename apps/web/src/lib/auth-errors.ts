import { ApiRequestError } from '@/lib/api';

/** Firebase Auth errors that mean the cached sign-in can never work again. */
const DEAD_SESSION_CODES = new Set([
  'auth/user-token-expired',
  'auth/user-not-found',
  'auth/invalid-user-token',
  // BUG-012: the refresh token is unknown or revoked (seen after an account-store reset)
  'auth/invalid-refresh-token',
  'auth/user-token-revoked',
]);

/**
 * Should this error end the user's session?
 *  - 'expired': the account was deleted or the token revoked → sign out, ask to sign in again.
 *  - 'blocked': the account is disabled (Firebase) or blocked by an admin (API 403).
 *  - null: temporary (offline, rate limited, server error) → keep the session and show the error.
 *
 * BUG-001: every `auth/*` code used to sign the user out, including auth/network-request-failed.
 */
export function sessionEndReason(e: unknown): 'expired' | 'blocked' | null {
  if (e instanceof ApiRequestError) {
    if (e.status === 401) return 'expired';
    if (e.status === 403) return 'blocked';
    return null;
  }
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return null;
  if (code === 'auth/user-disabled') return 'blocked';
  return DEAD_SESSION_CODES.has(code) ? 'expired' : null;
}
