import { type DateInput, toEpochDay } from './dates';

/**
 * A dated cash flow from the investor's point of view:
 * money paid in (buys) is negative, money received (sells, dividends, current value) is positive.
 */
export interface CashFlow {
  date: DateInput;
  amount: number;
}

export type XirrFailure =
  /** Fewer than two cash flows. */
  | 'INSUFFICIENT_FLOWS'
  /** All flows have the same sign, so no rate can make NPV zero. */
  | 'NO_SIGN_CHANGE'
  /** Money went in and nothing came back (−100%). Shown as −100% in the UI, not as a rate. */
  | 'TOTAL_LOSS'
  /** All flows fall on one day, so there is no time to annualise over. */
  | 'ZERO_DURATION'
  /** Solver did not converge (should be rare: Newton falls back to bisection). */
  | 'NO_CONVERGENCE';

export type XirrResult = { ok: true; rate: number } | { ok: false; reason: XirrFailure };

export interface XirrOptions {
  /** Starting guess for Newton–Raphson. Default 0.1 (10%). */
  guess?: number;
  /** Convergence tolerance on the rate. Default 1e-10. */
  tolerance?: number;
  /** Maximum Newton iterations before falling back to bisection. Default 100. */
  maxIterations?: number;
}

/** Day-count basis, matching spreadsheet XIRR: (dᵢ − d₀) / 365. */
export const DAYS_PER_YEAR = 365;

/**
 * Extended internal rate of return for irregular cash flows.
 *
 * Solves  Σ CFᵢ / (1 + r)^((dᵢ − d₀) / 365) = 0  for r, where d₀ is the earliest date.
 * Uses Newton–Raphson from `guess`, then falls back to bisection on a bracketed interval.
 */
export function xirr(flows: readonly CashFlow[], options: XirrOptions = {}): XirrResult {
  const { guess = 0.1, tolerance = 1e-10, maxIterations = 100 } = options;

  if (flows.length < 2) return { ok: false, reason: 'INSUFFICIENT_FLOWS' };

  for (const f of flows) {
    if (!Number.isFinite(f.amount))
      throw new RangeError(`Non-finite cash flow amount: ${f.amount}`);
  }

  const days = flows.map((f) => toEpochDay(f.date));
  const d0 = Math.min(...days);
  const t = days.map((d) => (d - d0) / DAYS_PER_YEAR);
  const a = flows.map((f) => f.amount);

  const hasNegative = a.some((x) => x < 0);
  const hasPositive = a.some((x) => x > 0);
  if (!hasNegative || !hasPositive) {
    // Money in, only zeros out → the investment was wiped out.
    if (hasNegative && a.some((x) => x === 0)) return { ok: false, reason: 'TOTAL_LOSS' };
    return { ok: false, reason: 'NO_SIGN_CHANGE' };
  }
  if (t.every((x) => x === 0)) return { ok: false, reason: 'ZERO_DURATION' };

  const npv = (r: number): number => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i]! / Math.pow(1 + r, t[i]!);
    return sum;
  };
  const dNpv = (r: number): number => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum -= (t[i]! * a[i]!) / Math.pow(1 + r, t[i]! + 1);
    return sum;
  };

  // 1) Newton–Raphson
  let r = guess;
  for (let i = 0; i < maxIterations; i++) {
    const f = npv(r);
    const df = dNpv(r);
    if (!Number.isFinite(f) || !Number.isFinite(df) || df === 0) break;
    const next = r - f / df;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - r) < tolerance) return { ok: true, rate: next };
    r = next;
  }

  // 2) Bisection fallback on (−1, hi]
  let lo = -1 + 1e-9;
  let hi = 1;
  let fLo = npv(lo);
  let fHi = npv(hi);
  while (Math.sign(fLo) === Math.sign(fHi) && hi < 1e6) {
    hi *= 2;
    fHi = npv(hi);
  }
  if (Math.sign(fLo) === Math.sign(fHi)) return { ok: false, reason: 'NO_CONVERGENCE' };

  for (let i = 0; i < 400; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (fMid === 0 || (hi - lo) / 2 < tolerance) return { ok: true, rate: mid };
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return { ok: false, reason: 'NO_CONVERGENCE' };
}
