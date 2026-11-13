// SEC-001: post-sign-in redirect must stay on this site. Browsers strip tab/CR/LF from URLs and
// treat "\" like "/", so "/\t/evil.example" becomes "//evil.example" (another site).
import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/auth-links';

const ORIGIN = 'https://kosh.example';
const resolves = (next: string) => new URL(safeNext(next), ORIGIN);

describe('safeNext', () => {
  it('keeps same-site paths, with query and hash', () => {
    expect(safeNext('/holdings/IN_EQUITY%3AINFY?tab=txns#top')).toBe(
      '/holdings/IN_EQUITY%3AINFY?tab=txns#top',
    );
    expect(safeNext('/settings')).toBe('/settings');
  });

  it.each([
    '//evil.example',
    '/\\evil.example',
    '/\\/evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r\n/evil.example',
    '\\/evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    ' /x',
    '',
  ])('rejects %j', (next) => {
    expect(resolves(next).origin).toBe(ORIGIN);
    expect(safeNext(next)).toBe('/dashboard');
  });

  it('defaults when missing', () => {
    expect(safeNext(null)).toBe('/dashboard');
  });
});
