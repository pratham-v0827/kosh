// Privacy mode masks every amount; the US-dollar view converts rupee amounts at the book's rate and
// leaves amounts that are already in dollars alone.
import { describe, expect, it } from 'vitest';
import { displayMoney } from '@/lib/display-money';

const INR = { hidden: false, currency: 'INR' } as const;
const USD = { hidden: false, currency: 'USD' } as const;
const HIDDEN = { hidden: true, currency: 'INR' } as const;

describe('displayMoney', () => {
  it('shows rupees as before by default', () => {
    expect(displayMoney(123456.7, {}, INR, '90', 'indian')).toBe('₹1,23,456.70');
  });

  it('converts rupee amounts to dollars at the rate', () => {
    expect(displayMoney(9000, {}, USD, '90', 'indian')).toBe('$100.00');
    expect(displayMoney(-450, { signed: true }, USD, '90', 'indian')).toBe('−$5.00');
  });

  it('leaves amounts already in dollars unchanged', () => {
    expect(displayMoney(228.1, { currency: 'USD' }, USD, '90', 'indian')).toBe('$228.10');
  });

  it('without a rate, keeps rupees rather than guessing', () => {
    expect(displayMoney(9000, {}, USD, null, 'indian')).toBe('₹9,000.00');
  });

  it('privacy mode hides the digits but keeps the currency and sign', () => {
    expect(displayMoney(123456.7, {}, HIDDEN, '90', 'indian')).toBe('₹••••');
    expect(displayMoney(-5, { signed: true }, HIDDEN, '90', 'indian')).toBe('−₹••••');
    expect(displayMoney(5, { signed: true }, HIDDEN, '90', 'indian')).toBe('+₹••••');
    expect(displayMoney(0, { signed: true }, HIDDEN, '90', 'indian')).toBe('₹••••');
    expect(displayMoney(10, { currency: 'USD' }, HIDDEN, '90', 'indian')).toBe('$••••');
    expect(displayMoney(9000, {}, { hidden: true, currency: 'USD' }, '90', 'indian')).toBe('$••••');
  });
});
