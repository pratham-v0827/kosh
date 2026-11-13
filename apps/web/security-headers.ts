/**
 * HTTP security headers for every response (SEC-011). Imported by next.config.ts.
 *
 * Content-Security-Policy notes:
 * - Kosh's pages are prerendered (static shell + client data). Next.js cannot attach per-request
 *   nonces to prerendered pages, so `script-src` needs 'unsafe-inline' for the framework's own
 *   inline bootstrap scripts (documented Next.js limitation). Everything else is locked down:
 *   scripts and connections only to this site and the Firebase/Google endpoints sign-in needs,
 *   no plugins, no framing, no foreign form targets, no <base> hijacking.
 * - Price providers are called by the SERVER only, so no provider host appears here.
 */
export interface HeaderEnv {
  NODE_ENV?: string;
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
  NEXT_PUBLIC_USE_EMULATORS?: string;
}

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

const EMULATOR_AUTH = ['http://127.0.0.1:9099', 'http://localhost:9099'];
const EMULATOR_FIRESTORE = ['http://127.0.0.1:8080', 'http://localhost:8080'];

export function buildCsp(env: HeaderEnv): string {
  const dev = env.NODE_ENV !== 'production';
  const emulators = env.NEXT_PUBLIC_USE_EMULATORS === 'true';
  // Only a plain hostname may enter the policy (a stray ";" or space would rewrite it).
  const authDomain = HOSTNAME.test(env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '')
    ? `https://${env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}`
    : null;

  const directives: Record<string, (string | null)[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      "'unsafe-inline'",
      dev ? "'unsafe-eval'" : null,
      'https://apis.google.com',
    ],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': [
      "'self'",
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com',
      'https://firestore.googleapis.com',
      ...(emulators ? [...EMULATOR_AUTH, ...EMULATOR_FIRESTORE] : []),
      dev ? 'ws:' : null,
    ],
    // Google sign-in runs in a helper frame served from the Firebase auth domain.
    'frame-src': [
      ...(authDomain ? [authDomain] : []),
      ...(emulators ? EMULATOR_AUTH : []),
      ...(!authDomain && !emulators ? ["'none'"] : []),
    ],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  const parts = Object.entries(directives).map(
    ([k, v]) => `${k} ${v.filter((x): x is string => x !== null).join(' ')}`,
  );
  // Not with the local emulators: they are plain http and must not be rewritten to https.
  if (!dev && !emulators) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

export function securityHeaders(env: HeaderEnv): { key: string; value: string }[] {
  return [
    { key: 'Content-Security-Policy', value: buildCsp(env) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    {
      key: 'Permissions-Policy',
      value:
        'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), browsing-topics=()',
    },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    // "allow-popups" keeps Google sign-in (a popup) working while isolating this window.
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
  ];
}
