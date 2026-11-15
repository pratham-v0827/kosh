import DecimalJs from 'decimal.js';
import type { Cell } from './sheets/types';
import type { ReconciliationCheck } from './types';
import { canonicalDecimal, parseDecimal } from './values';

/** Decimal arithmetic for statement parsing: 40 significant digits, half-up rounding. */
export const Decimal = DecimalJs.clone({ precision: 40, rounding: DecimalJs.ROUND_HALF_UP });
export type Decimal = InstanceType<typeof Decimal>;

/**
 * A spreadsheet cell as a decimal.
 *
 * Spreadsheets store numbers as binary doubles, so each one is converted exactly once, here, via
 * its shortest exact decimal text (what `String(n)` gives). No arithmetic is done on the double.
 * Text cells are accepted when they hold a plain number, with separators, a currency symbol, a
 * leading minus or accounting brackets: "1,23,456.50", "₹ 2,410", "-12.5", "(12.50)".
 */
export function cellDecimal(cell: Cell | undefined): Decimal | 'empty' | 'invalid' {
  if (!cell) return 'empty';
  if (cell.t === 'n') return Number.isFinite(cell.v) ? new Decimal(cell.v) : 'invalid';
  if (cell.t !== 's') return 'invalid';
  let s = cell.v.trim();
  if (
    s === '' ||
    s === '-' ||
    s === '--' ||
    s.toLowerCase() === 'na' ||
    s.toLowerCase() === 'n/a'
  ) {
    return 'empty';
  }
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  } else if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  const plain = parseDecimal(s);
  if (plain === null) return 'invalid';
  const d = new Decimal(plain);
  return negative ? d.negated() : d;
}

/** Decimal → plain canonical string rounded half-up to `places` ("1.2e-7" style never appears). */
export const fixed = (d: Decimal, places: number): string =>
  canonicalDecimal(d.toDecimalPlaces(places).toFixed());

/** Compare a total from the file with the sum of its rows. */
export function reconcileTotal(o: {
  id: ReconciliationCheck['id'];
  label: string;
  fileTotal: Decimal | 'empty' | 'invalid';
  rowsTotal: Decimal;
  rows: number;
  currency: 'INR' | 'USD';
}): ReconciliationCheck {
  if (o.fileTotal === 'empty' || o.fileTotal === 'invalid') {
    return {
      id: o.id,
      label: o.label,
      status: 'not-available',
      detail: 'The file has no total to compare with',
    };
  }
  const difference = o.rowsTotal.minus(o.fileTotal).abs();
  // Allow 1 unit of currency per row or 0.05% of the total, whichever is larger: statements
  // round each row, so their totals are rarely exact.
  const tolerance = Decimal.max(new Decimal(o.rows), o.fileTotal.abs().times('0.0005'));
  const ok = difference.lte(tolerance);
  return {
    id: o.id,
    label: o.label,
    status: ok ? 'ok' : 'warning',
    detail: difference.isZero()
      ? 'The rows add up exactly to the total in the file'
      : ok
        ? 'The rows add up to the total in the file, within rounding'
        : 'The rows do not add up to the total in the file',
    currency: o.currency,
    fileTotal: fixed(o.fileTotal, 2),
    rowsTotal: fixed(o.rowsTotal, 2),
    difference: fixed(difference, 2),
  };
}

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

/** "05 Mar 2024, 07:30 PM" (or "5 Mar 2024") → "2024-03-05". Null when it is not such a date. */
export function parseDayMonthName(text: string): string | null {
  const s = text.trim();
  if (s.length > 40) return null;
  const m = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})(?:\b|,)/.exec(s);
  if (!m) return null;
  const month = MONTHS[m[2]!.toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${m[1]!.padStart(2, '0')}`;
}
