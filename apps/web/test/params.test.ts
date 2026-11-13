// SEC-009: ids taken from the URL are validated before they reach Firestore paths.
import { describe, expect, it } from 'vitest';
import { docIdParam, instrumentIdParam } from '@/server/params';

const status = (fn: () => unknown) => {
  try {
    fn();
    return 200;
  } catch (e) {
    return (e as { status?: number }).status ?? 500;
  }
};

describe('instrumentIdParam', () => {
  it('accepts real instrument ids, encoded or not', () => {
    expect(instrumentIdParam('US_EQUITY%3ABRK.B')).toBe('US_EQUITY:BRK.B');
    expect(instrumentIdParam('IN_EQUITY:BSE:RELIANCE')).toBe('IN_EQUITY:BSE:RELIANCE');
    expect(instrumentIdParam('IN_EQUITY:M&M')).toBe('IN_EQUITY:M&M');
    expect(instrumentIdParam('UNLISTED:acme-technologies-pre-ipo')).toBe(
      'UNLISTED:acme-technologies-pre-ipo',
    );
    expect(instrumentIdParam('MUTUAL_FUND:120590')).toBe('MUTUAL_FUND:120590');
  });

  it.each([
    '%zz',
    '%E0%A4%A',
    'a/b',
    'UNLISTED:a/b',
    'UNLISTED:..',
    '..',
    'x'.repeat(200),
    '',
    'US_EQUITY:',
    'UNLISTED:a b',
    '__proto__',
  ])('rejects %j with 404, never 500', (raw) => {
    expect(status(() => instrumentIdParam(raw))).toBe(404);
  });
});

describe('docIdParam', () => {
  it('accepts Firestore auto ids', () => {
    expect(docIdParam('Zk3xQ9aB7cD1eF2gH4iJ')).toBe('Zk3xQ9aB7cD1eF2gH4iJ');
  });
  it.each(['a/b', '..', '%2e%2e', 'a b', '', 'x'.repeat(100), '__name__'])(
    'rejects %j with 404',
    (raw) => {
      expect(status(() => docIdParam(raw))).toBe(404);
    },
  );
});
