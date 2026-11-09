/**
 * Number formatting for display. Indian style uses lakh/crore grouping (₹42,18,560.50, ₹42.19 L);
 * international uses thousands grouping (₹4,218,560.50, ₹4.22M). Negative numbers use a true
 * minus sign (U+2212) and gains can be shown with an explicit "+".
 */

export type NumberStyle = 'indian' | 'international';

export interface MoneyOptions {
  style?: NumberStyle;
  /** Short form: ₹42.19 L / ₹12.35 Cr (Indian) or ₹4.22M (international). */
  compact?: boolean;
  /** Prefix positive values with "+". */
  signed?: boolean;
  /** Fraction digits for the full form (default 2). */
  decimals?: number;
  /** Currency of the amount (default INR). USD always uses international grouping. */
  currency?: 'INR' | 'USD';
}

const MINUS = '−';
const LAKH = 1e5;
const CRORE = 1e7;

const localeFor = (style: NumberStyle) => (style === 'indian' ? 'en-IN' : 'en-US');

function toNumber(value: number | string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new RangeError(`Not a finite number: ${value}`);
  return n;
}

/** True when the formatted body shows zero (e.g. "₹0.00" for −0.004): then no sign is shown. */
const showsZero = (body: string) => Number(body.replace(/[^0-9.]/g, '')) === 0;

function withSign(n: number, body: string, signed: boolean) {
  if (showsZero(body)) return body; // BUG-003: never "−₹0.00"
  if (n < 0) return `${MINUS}${body}`;
  if (signed && n > 0) return `+${body}`;
  return body;
}

/** −1 / 0 / 1 after rounding to `decimals` — use for gain/loss arrows and colours. */
export function moneyDirection(value: number | string, decimals = 2): -1 | 0 | 1 {
  const r = Math.round(toNumber(value) * 10 ** decimals);
  return r > 0 ? 1 : r < 0 ? -1 : 0;
}

/**
 * −1 / 0 / 1 for a value as it is DISPLAYED: 0 when the formatted text shows only zeros
 * (e.g. "₹0" in compact mode for −0.4), so the arrow and colour always match the digits.
 */
export function shownDirection(value: number | string, formatted: string): -1 | 0 | 1 {
  if (showsZero(formatted)) return 0;
  const n = toNumber(value);
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

export function formatMoney(value: number | string, options: MoneyOptions = {}): string {
  const {
    style = 'indian',
    compact = false,
    signed = false,
    decimals = 2,
    currency = 'INR',
  } = options;
  const n = toNumber(value);
  const abs = Math.abs(n);
  let body: string;

  if (currency === 'USD') {
    body = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      ...(compact && abs >= 1000
        ? { notation: 'compact' as const, maximumFractionDigits: 2 }
        : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
    }).format(abs);
    return withSign(n, body, signed);
  }

  if (compact && style === 'indian' && abs >= LAKH) {
    const [unit, size] = abs >= CRORE ? ['Cr', CRORE] : ['L', LAKH];
    body = `₹${(abs / size).toFixed(2)} ${unit}`;
  } else if (compact && style === 'international' && abs >= 1000) {
    body = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'INR',
      notation: 'compact',
      maximumFractionDigits: 2,
    }).format(abs);
  } else {
    body = new Intl.NumberFormat(localeFor(style), {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: compact ? 0 : decimals,
      maximumFractionDigits: compact ? 0 : decimals,
    }).format(abs);
  }
  return withSign(n, body, signed);
}

/** 0.1667 → "16.67%"; signed → "+16.67%". */
export function formatPercent(
  ratio: number,
  options: { signed?: boolean; decimals?: number } = {},
): string {
  const { signed = false, decimals = 2 } = options;
  const n = toNumber(ratio);
  const body = `${Math.abs(n * 100).toFixed(decimals)}%`;
  return withSign(Number((n * 100).toFixed(decimals)), body, signed);
}

/** Quantities: up to 8 decimals (satoshis), trailing zeros dropped, grouped per style. */
export function formatQuantity(value: number | string, style: NumberStyle = 'indian'): string {
  const n = toNumber(value);
  return new Intl.NumberFormat(localeFor(style), { maximumFractionDigits: 8 }).format(n);
}
