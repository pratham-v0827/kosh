// SEC-011: there was no Content-Security-Policy.
import { describe, expect, it } from 'vitest';
import { buildCsp, securityHeaders } from '../security-headers';

const prod = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'my-kosh.firebaseapp.com',
};
const directive = (csp: string, name: string) =>
  csp
    .split('; ')
    .find((d) => d.startsWith(`${name} `))
    ?.split(' ')
    .slice(1) ?? [];

describe('Content-Security-Policy (production)', () => {
  const csp = buildCsp(prod);

  it('locks down the dangerous directives', () => {
    expect(directive(csp, 'default-src')).toEqual(["'self'"]);
    expect(directive(csp, 'object-src')).toEqual(["'none'"]);
    expect(directive(csp, 'base-uri')).toEqual(["'self'"]);
    expect(directive(csp, 'form-action')).toEqual(["'self'"]);
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"]);
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('never allows eval, wildcards, plain http or local hosts in production', () => {
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/(^|\s)\*(\s|;|$)/);
    expect(csp).not.toContain('http://');
    expect(csp).not.toContain('localhost');
    expect(csp).not.toContain('ws:');
  });

  it('allows only this site and the Firebase/Google sign-in endpoints', () => {
    expect(directive(csp, 'script-src')).toEqual([
      "'self'",
      "'unsafe-inline'",
      'https://apis.google.com',
    ]);
    expect(directive(csp, 'connect-src')).toEqual([
      "'self'",
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com',
      'https://firestore.googleapis.com',
    ]);
    expect(directive(csp, 'frame-src')).toEqual(['https://my-kosh.firebaseapp.com']);
  });

  it('contains no price-provider host (those are called by the server only)', () => {
    expect(csp).not.toMatch(/yahoo|alphavantage|amfi|coindcx|frankfurter|finnhub|twelvedata/i);
  });

  it('ignores an auth domain that is not a plain hostname (header injection)', () => {
    const bad = buildCsp({
      ...prod,
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "x.com; script-src * 'unsafe-eval'",
    });
    expect(directive(bad, 'frame-src')).toEqual(["'none'"]);
    expect(bad).not.toContain("'unsafe-eval'");
  });
});

describe('Content-Security-Policy (local development)', () => {
  it('adds the emulators and hot reload only in development', () => {
    const csp = buildCsp({ NODE_ENV: 'development', NEXT_PUBLIC_USE_EMULATORS: 'true' });
    expect(directive(csp, 'connect-src')).toContain('http://127.0.0.1:8080');
    expect(directive(csp, 'connect-src')).toContain('ws:');
    expect(directive(csp, 'frame-src')).toContain('http://127.0.0.1:9099');
    expect(directive(csp, 'script-src')).toContain("'unsafe-eval'");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
});

describe('securityHeaders', () => {
  it('sets the full baseline', () => {
    const h = Object.fromEntries(securityHeaders(prod).map((x) => [x.key, x.value]));
    expect(h['Content-Security-Policy']).toBe(buildCsp(prod));
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Strict-Transport-Security']).toContain('max-age=63072000; includeSubDomains');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin-allow-popups');
    expect(h['Permissions-Policy']).toContain('camera=(), microphone=(), geolocation=()');
  });
});
