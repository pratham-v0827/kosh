import { describe, expect, it } from 'vitest';
import { formatMoney, formatPercent, formatQuantity } from '../src';

const MINUS = '−';

describe('formatMoney (docs/PLAN.md §6.5)', () => {
  it('uses lakh/crore grouping in Indian style', () => {
    expect(formatMoney(4218560.5)).toBe('₹42,18,560.50');
    expect(formatMoney('123456789')).toBe('₹12,34,56,789.00');
  });

  it('compacts to L and Cr', () => {
    expect(formatMoney(4218560.5, { compact: true })).toBe('₹42.19 L');
    expect(formatMoney(123456789, { compact: true })).toBe('₹12.35 Cr');
    expect(formatMoney(12480, { compact: true })).toBe('₹12,480');
  });

  it('uses thousands grouping in international style', () => {
    expect(formatMoney(4218560.5, { style: 'international' })).toBe('₹4,218,560.50');
    expect(formatMoney(4218560.5, { style: 'international', compact: true })).toBe('₹4.22M');
  });

  it('signs gains and uses a true minus for losses', () => {
    expect(formatMoney(604210, { signed: true })).toBe('+₹6,04,210.00');
    expect(formatMoney(-12480, { signed: true })).toBe(`${MINUS}₹12,480.00`);
    expect(formatMoney(-12480)).toBe(`${MINUS}₹12,480.00`);
    expect(formatMoney(0, { signed: true })).toBe('₹0.00');
  });

  it('formats USD amounts with US grouping', () => {
    expect(formatMoney(228.1, { currency: 'USD' })).toBe('$228.10');
    expect(formatMoney(1234567, { currency: 'USD', style: 'indian' })).toBe('$1,234,567.00');
    expect(formatMoney(-2.5, { currency: 'USD', signed: true })).toBe(`${MINUS}$2.50`);
  });

  it('rejects non-numeric input', () => {
    expect(() => formatMoney('abc')).toThrow(RangeError);
  });
});

describe('formatPercent', () => {
  it('formats ratios as percentages', () => {
    expect(formatPercent(0.1667)).toBe('16.67%');
    expect(formatPercent(0.1667, { signed: true })).toBe('+16.67%');
    expect(formatPercent(-0.003, { signed: true })).toBe(`${MINUS}0.30%`);
    expect(formatPercent(0.00001, { signed: true })).toBe('0.00%');
  });
});

describe('formatQuantity', () => {
  it('keeps up to 4 decimals and groups per style', () => {
    expect(formatQuantity('123456.125')).toBe('1,23,456.125');
    expect(formatQuantity('123456.125', 'international')).toBe('123,456.125');
    expect(formatQuantity('0.00012345')).toBe('0.0001');
  });
});
