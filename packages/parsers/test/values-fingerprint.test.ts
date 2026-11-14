import { describe, expect, it } from 'vitest';
import {
  canonicalDecimal,
  fingerprint,
  fingerprintAll,
  type FingerprintFields,
  parseDate,
  parseDecimal,
  parseRatio,
} from '../src';

describe('parseDate', () => {
  it('reads ISO and day-first dates', () => {
    expect(parseDate('2025-03-14')).toBe('2025-03-14');
    expect(parseDate('14-03-2025')).toBe('2025-03-14');
    expect(parseDate('14/03/2025')).toBe('2025-03-14');
    expect(parseDate('3/4/2025')).toBe('2025-04-03'); // always day first: 3 April
    expect(parseDate(' 14.03.2025 ')).toBe('2025-03-14');
  });

  it('rejects impossible or unknown dates', () => {
    expect(parseDate('2025-02-30')).toBeNull();
    expect(parseDate('31-04-2025')).toBeNull();
    expect(parseDate('03/14/2025')).toBeNull(); // month-first is not accepted
    expect(parseDate('14 Mar 2025')).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});

describe('parseDecimal', () => {
  it('reads statement numbers and returns a canonical decimal', () => {
    expect(parseDecimal('1,23,456.50')).toBe('123456.5');
    expect(parseDecimal('₹ 2,410.00')).toBe('2410');
    expect(parseDecimal('$190.25')).toBe('190.25');
    expect(parseDecimal('0.00012345')).toBe('0.00012345');
    expect(parseDecimal('0010')).toBe('10');
  });

  it('rejects negatives, exponents, formulas and text', () => {
    for (const bad of ['-5', '1e9', '=1+1', '+5', '12abc', '', '1.2.3', '(100)']) {
      expect(parseDecimal(bad)).toBeNull();
    }
  });

  it('canonicalDecimal makes equal amounts identical', () => {
    expect(canonicalDecimal('10.00')).toBe('10');
    expect(canonicalDecimal('010.50')).toBe('10.5');
    expect(canonicalDecimal('0.0')).toBe('0');
  });
});

describe('parseRatio', () => {
  it('reads 1:5 and 1/5, rejects the rest', () => {
    expect(parseRatio('1:5')).toEqual({ from: 1, to: 5 });
    expect(parseRatio(' 2 / 1 ')).toEqual({ from: 2, to: 1 });
    expect(parseRatio('1-5')).toBeNull();
    expect(parseRatio('a:b')).toBeNull();
  });
});

describe('fingerprint (de-duplication key)', () => {
  const base: FingerprintFields = {
    source: 'kosh',
    accountId: 'import:kosh',
    instrumentId: 'IN_EQUITY:RELIANCE',
    type: 'BUY',
    tradeDate: '2024-04-01',
    qty: '10',
    price: '2900.5',
    brokerRef: 'ORD-1001',
  };

  it('is stable and ignores number formatting', () => {
    expect(fingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint({ ...base, qty: '10.00', price: '2900.50' })).toBe(fingerprint(base));
  });

  it('changes with every identifying field', () => {
    const variants: Partial<FingerprintFields>[] = [
      { source: 'zerodha' },
      { accountId: 'import:zerodha' },
      { instrumentId: 'IN_EQUITY:INFY' },
      { type: 'SELL' },
      { tradeDate: '2024-04-02' },
      { qty: '11' },
      { price: '2900.6' },
      { brokerRef: 'ORD-1002' },
      { amount: '5' },
      { ratio: { from: 1, to: 2 } },
    ];
    const all = new Set(variants.map((v) => fingerprint({ ...base, ...v })));
    expect(all.size).toBe(variants.length);
    expect(all.has(fingerprint(base))).toBe(false);
  });

  it('keeps genuine repeats in one file, and matches itself on re-import', () => {
    const sip = { ...base, brokerRef: undefined };
    const file = [sip, sip, { ...sip, qty: '5' }, sip];
    const first = fingerprintAll(file);
    expect(new Set(first).size).toBe(4); // three identical rows stay three rows
    expect(fingerprintAll(file)).toEqual(first); // the same file again → the same keys
    expect(first[0]).toBe(fingerprint(sip)); // first occurrence equals a single-row import
  });
});
