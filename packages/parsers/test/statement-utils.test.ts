import { describe, expect, it } from 'vitest';
import {
  cellDecimal,
  Decimal,
  fixed,
  parseDayMonthName,
  reconcileTotal,
} from '../src/statement-utils';

const text = (v: string) => ({ t: 's' as const, v });
const num = (v: number) => ({ t: 'n' as const, v });
const str = (d: ReturnType<typeof cellDecimal>) => (typeof d === 'string' ? d : d.toFixed());

describe('cellDecimal', () => {
  it('converts a binary number once, through its shortest decimal text', () => {
    expect(str(cellDecimal(num(0.1 + 0.2)))).toBe('0.30000000000000004');
    expect(str(cellDecimal(num(1234.5)))).toBe('1234.5');
    expect(str(cellDecimal(num(3.552713678800501e-15)))).toBe('0.000000000000003552713678800501');
    expect(str(cellDecimal(num(-12.5)))).toBe('-12.5');
    expect(cellDecimal(num(Number.NaN))).toBe('invalid');
    expect(cellDecimal(num(Number.POSITIVE_INFINITY))).toBe('invalid');
  });

  it('reads numbers typed as text, including Indian grouping, symbols and negatives', () => {
    expect(str(cellDecimal(text('1,23,456.50')))).toBe('123456.5');
    expect(str(cellDecimal(text('₹ 2,410.00')))).toBe('2410');
    expect(str(cellDecimal(text('$190.25')))).toBe('190.25');
    expect(str(cellDecimal(text('-12.5')))).toBe('-12.5');
    expect(str(cellDecimal(text('(1,200.75)')))).toBe('-1200.75');
    expect(str(cellDecimal(text('  42  ')))).toBe('42');
  });

  it('tells an empty cell from a damaged one', () => {
    for (const empty of ['', '   ', '-', '--', 'NA', 'n/a'])
      expect(cellDecimal(text(empty))).toBe('empty');
    expect(cellDecimal(null)).toBe('empty');
    expect(cellDecimal(undefined)).toBe('empty');
    for (const bad of ['abc', '=1+1', '1e9', '12 units', '1.2.3', '+5']) {
      expect(cellDecimal(text(bad)), bad).toBe('invalid');
    }
    expect(cellDecimal({ t: 'b', v: true })).toBe('invalid');
  });
});

describe('fixed', () => {
  it('rounds half-up to plain decimal text, without exponents or trailing zeros', () => {
    expect(fixed(new Decimal('104.3382915527'), 6)).toBe('104.338292');
    expect(fixed(new Decimal('2.345'), 2)).toBe('2.35');
    expect(fixed(new Decimal('2.344'), 2)).toBe('2.34');
    expect(fixed(new Decimal('10.00'), 2)).toBe('10');
    expect(fixed(new Decimal('1e-10'), 8)).toBe('0');
    expect(fixed(new Decimal('123456789012.12345678'), 8)).toBe('123456789012.12345678');
  });
});

describe('reconcileTotal', () => {
  const base = {
    id: 'invested' as const,
    label: 'Invested value',
    rows: 10,
    currency: 'INR' as const,
  };

  it('is exact, within rounding, or a warning', () => {
    expect(
      reconcileTotal({ ...base, fileTotal: new Decimal('1000'), rowsTotal: new Decimal('1000') }),
    ).toMatchObject({
      status: 'ok',
      difference: '0',
      detail: 'The rows add up exactly to the total in the file',
    });
    // 10 rows → ₹10 allowed
    expect(
      reconcileTotal({ ...base, fileTotal: new Decimal('1000'), rowsTotal: new Decimal('1009.5') }),
    ).toMatchObject({ status: 'ok', difference: '9.5', fileTotal: '1000', rowsTotal: '1009.5' });
    expect(
      reconcileTotal({ ...base, fileTotal: new Decimal('1000'), rowsTotal: new Decimal('1010.01') })
        .status,
    ).toBe('warning');
  });

  it('allows 0.05% on large totals, whichever is larger', () => {
    const total = new Decimal('10000000'); // 0.05% = 5000
    expect(reconcileTotal({ ...base, fileTotal: total, rowsTotal: total.plus(4999) }).status).toBe(
      'ok',
    );
    expect(reconcileTotal({ ...base, fileTotal: total, rowsTotal: total.minus(5001) }).status).toBe(
      'warning',
    );
  });

  it('says so when the file has no total', () => {
    for (const fileTotal of ['empty', 'invalid'] as const) {
      const c = reconcileTotal({ ...base, fileTotal, rowsTotal: new Decimal(5) });
      expect(c.status).toBe('not-available');
      expect(c).not.toHaveProperty('fileTotal');
    }
  });
});

describe('parseDayMonthName', () => {
  it('reads "DD Mon YYYY, hh:mm AM/PM" and keeps the date', () => {
    expect(parseDayMonthName('05 Mar 2024, 07:30 PM')).toBe('2024-03-05');
    expect(parseDayMonthName('5 mar 2024')).toBe('2024-03-05');
    expect(parseDayMonthName(' 31 DEC 2021, 11:59 PM ')).toBe('2021-12-31');
  });

  it('rejects anything else', () => {
    for (const bad of [
      '',
      '2024-03-05',
      '05 March 2024',
      '05 Xyz 2024',
      'Mar 05 2024',
      `01 Jan 2024${', 10:00 AM'.repeat(6)}`,
    ]) {
      expect(parseDayMonthName(bad), bad).toBeNull();
    }
  });
});
