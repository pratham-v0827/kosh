import { formatMoney, type MoneyOptions, type NumberStyle } from '@kosh/core';
import type { ViewPrefs } from './view-prefs';

const MINUS = '−';
export const MASK = '••••';

/**
 * Format an amount for this device's view. Amounts are rupees unless `options.currency` says
 * otherwise. In the dollar view, rupee amounts are converted at `usdInr` (rupees per dollar);
 * without a rate they stay in rupees. Privacy mode keeps only the currency and the sign.
 */
export function displayMoney(
  value: number | string,
  options: Omit<MoneyOptions, 'style'>,
  view: ViewPrefs,
  usdInr: string | null,
  style: NumberStyle,
): string {
  const own = options.currency ?? 'INR';
  const convert = view.currency === 'USD' && own === 'INR' && usdInr !== null && Number(usdInr) > 0;
  const currency = convert ? 'USD' : own;
  if (view.hidden) {
    const n = Number(value);
    const sign = !options.signed || !n ? '' : n > 0 ? '+' : MINUS;
    return `${sign}${currency === 'USD' ? '$' : '₹'}${MASK}`;
  }
  const amount = convert ? Number(value) / Number(usdInr) : value; // display only: rounded to cents
  return formatMoney(amount, { ...options, currency, style });
}
