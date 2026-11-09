import { type DateInput, daysBetween } from './dates';
import { DAYS_PER_YEAR } from './xirr';

/**
 * Compound annual growth rate between two values with NO intermediate cash flows:
 *   (endValue / startValue)^(365 / days) − 1
 *
 * Returns null when it is not meaningful (non-positive start value, negative end value,
 * or end date not after start date). With intermediate flows, use XIRR instead.
 */
export function cagr(
  startValue: number,
  endValue: number,
  startDate: DateInput,
  endDate: DateInput,
): number | null {
  const days = daysBetween(startDate, endDate);
  if (!(startValue > 0) || endValue < 0 || days <= 0) return null;
  return Math.pow(endValue / startValue, DAYS_PER_YEAR / days) - 1;
}
