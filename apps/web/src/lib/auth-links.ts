/** localStorage key holding the email an email-link sign-in was sent to (same-device completion). */
export const EMAIL_KEY = 'kosh.emailForSignIn';

/** Only allow same-site relative paths as post-sign-in destinations (prevents open redirects). */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')
    ? next
    : '/dashboard';
}
