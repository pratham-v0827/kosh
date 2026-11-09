// BUG-001: a temporary network error while loading the app signed the user out.
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/lib/api';
import { sessionEndReason } from '@/lib/auth-errors';

const fb = (code: string) => Object.assign(new Error(code), { code });

describe('sessionEndReason', () => {
  it('ends the session for dead or blocked accounts', () => {
    expect(sessionEndReason(fb('auth/user-token-expired'))).toBe('expired');
    expect(sessionEndReason(fb('auth/user-not-found'))).toBe('expired');
    expect(sessionEndReason(fb('auth/invalid-user-token'))).toBe('expired');
    expect(sessionEndReason(fb('auth/user-disabled'))).toBe('blocked');
    expect(sessionEndReason(new ApiRequestError(401, 'UNAUTHENTICATED', 'x'))).toBe('expired');
    expect(sessionEndReason(new ApiRequestError(403, 'BLOCKED', 'x'))).toBe('blocked');
  });

  it('keeps the session for temporary problems (offline, rate limits, server errors)', () => {
    expect(sessionEndReason(fb('auth/network-request-failed'))).toBeNull();
    expect(sessionEndReason(fb('auth/too-many-requests'))).toBeNull();
    expect(sessionEndReason(fb('auth/internal-error'))).toBeNull();
    expect(sessionEndReason(new ApiRequestError(500, 'INTERNAL', 'x'))).toBeNull();
    expect(sessionEndReason(new TypeError('Failed to fetch'))).toBeNull();
  });
});
