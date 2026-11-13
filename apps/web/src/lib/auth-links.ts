/** localStorage key holding the email an email-link sign-in was sent to (same-device completion). */
export const EMAIL_KEY = 'kosh.emailForSignIn';

const DEFAULT_NEXT = '/dashboard';
const PROBE_ORIGIN = 'https://kosh.invalid';

/**
 * Only allow same-site relative paths as post-sign-in destinations (prevents open redirects).
 * SEC-001: browsers strip tab/CR/LF and read "\" as "/", so "/\t/evil.example" used to pass a
 * prefix check and become "//evil.example". Reject those characters, then require the resolved
 * URL to stay on this origin.
 */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(next)) return DEFAULT_NEXT;
  try {
    const u = new URL(next, PROBE_ORIGIN);
    return u.origin === PROBE_ORIGIN ? `${u.pathname}${u.search}${u.hash}` : DEFAULT_NEXT;
  } catch {
    return DEFAULT_NEXT;
  }
}
