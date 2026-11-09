import { describe, expect, it } from 'vitest';
import { type CashFlow, cagr, xirr } from '../src';

function rateOf(flows: CashFlow[]): number {
  const r = xirr(flows);
  if (!r.ok) throw new Error(`expected a rate, got ${r.reason}`);
  return r.rate;
}

describe('xirr', () => {
  it('matches the Microsoft Excel XIRR documentation example (0.373362535)', () => {
    const flows: CashFlow[] = [
      { date: '2008-01-01', amount: -10000 },
      { date: '2008-03-01', amount: 2750 },
      { date: '2008-10-30', amount: 4250 },
      { date: '2009-02-15', amount: 3250 },
      { date: '2009-04-01', amount: 2750 },
    ];
    expect(rateOf(flows)).toBeCloseTo(0.373362535, 6);
  });

  it('returns exactly 10% for −1000 → +1100 over 365 days', () => {
    expect(
      rateOf([
        { date: '2023-01-01', amount: -1000 },
        { date: '2024-01-01', amount: 1100 },
      ]),
    ).toBeCloseTo(0.1, 9);
  });

  it('handles a losing investment (negative rate)', () => {
    expect(
      rateOf([
        { date: '2023-01-01', amount: -1000 },
        { date: '2024-01-01', amount: 800 },
      ]),
    ).toBeCloseTo(-0.2, 9);
  });

  it('is independent of input order', () => {
    const flows: CashFlow[] = [
      { date: '2009-04-01', amount: 2750 },
      { date: '2008-01-01', amount: -10000 },
      { date: '2009-02-15', amount: 3250 },
      { date: '2008-10-30', amount: 4250 },
      { date: '2008-03-01', amount: 2750 },
    ];
    expect(rateOf(flows)).toBeCloseTo(0.373362535, 6);
  });

  it('accepts Date objects as well as ISO strings', () => {
    expect(
      rateOf([
        { date: new Date(Date.UTC(2023, 0, 1)), amount: -1000 },
        { date: new Date(Date.UTC(2024, 0, 1)), amount: 1100 },
      ]),
    ).toBeCloseTo(0.1, 9);
  });

  it('recovers known rates from generated cash flows (round trip)', () => {
    for (const rate of [-0.5, -0.05, 0, 0.07, 0.15, 0.8, 3]) {
      // Monthly SIP of 5,000 for 3 years, terminal value chosen so NPV at `rate` is zero.
      const flows: CashFlow[] = [];
      let npvOfBuys = 0;
      for (let m = 0; m < 36; m++) {
        const date = new Date(Date.UTC(2021, m, 5));
        flows.push({ date, amount: -5000 });
        const t = (Date.UTC(2021, m, 5) - Date.UTC(2021, 0, 5)) / 86_400_000 / 365;
        npvOfBuys += 5000 / Math.pow(1 + rate, t);
      }
      const endT = (Date.UTC(2024, 0, 5) - Date.UTC(2021, 0, 5)) / 86_400_000 / 365;
      flows.push({ date: '2024-01-05', amount: npvOfBuys * Math.pow(1 + rate, endT) });
      expect(rateOf(flows)).toBeCloseTo(rate, 7);
    }
  });

  it('falls back to bisection when the Newton guess is poor', () => {
    const r = xirr(
      [
        { date: '2023-01-01', amount: -1000 },
        { date: '2023-02-01', amount: 3000 },
      ],
      { guess: -0.99 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(Math.pow(1 + r.rate, 31 / 365)).toBeCloseTo(3, 6);
  });

  it('reports INSUFFICIENT_FLOWS for fewer than two flows', () => {
    expect(xirr([])).toEqual({ ok: false, reason: 'INSUFFICIENT_FLOWS' });
    expect(xirr([{ date: '2024-01-01', amount: -100 }])).toEqual({
      ok: false,
      reason: 'INSUFFICIENT_FLOWS',
    });
  });

  it('reports NO_SIGN_CHANGE when every flow has the same sign', () => {
    expect(
      xirr([
        { date: '2024-01-01', amount: -100 },
        { date: '2024-06-01', amount: -50 },
      ]),
    ).toEqual({ ok: false, reason: 'NO_SIGN_CHANGE' });
  });

  it('reports TOTAL_LOSS when nothing came back', () => {
    expect(
      xirr([
        { date: '2023-01-01', amount: -1000 },
        { date: '2024-01-01', amount: 0 },
      ]),
    ).toEqual({ ok: false, reason: 'TOTAL_LOSS' });
  });

  it('reports ZERO_DURATION when all flows are on the same day', () => {
    expect(
      xirr([
        { date: '2024-01-01', amount: -100 },
        { date: '2024-01-01', amount: 110 },
      ]),
    ).toEqual({ ok: false, reason: 'ZERO_DURATION' });
  });

  it('rejects invalid dates and amounts', () => {
    expect(() =>
      xirr([
        { date: '2024-02-30', amount: -1 },
        { date: '2024-03-01', amount: 2 },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      xirr([
        { date: '2024-01-01', amount: Number.NaN },
        { date: '2024-03-01', amount: 2 },
      ]),
    ).toThrow(RangeError);
  });
});

describe('cagr', () => {
  it('returns 10% for 100 → 110 over 365 days', () => {
    expect(cagr(100, 110, '2023-01-01', '2024-01-01')).toBeCloseTo(0.1, 12);
  });

  it('returns 10% for 100 → 121 over 730 days', () => {
    expect(cagr(100, 121, '2022-01-01', '2024-01-01')).toBeCloseTo(0.1, 12);
  });

  it('agrees with XIRR when there are no intermediate flows', () => {
    const c = cagr(1000, 1500, '2020-03-15', '2024-09-01');
    const x = rateOf([
      { date: '2020-03-15', amount: -1000 },
      { date: '2024-09-01', amount: 1500 },
    ]);
    expect(c).not.toBeNull();
    expect(x).toBeCloseTo(c!, 9);
  });

  it('returns null when not meaningful', () => {
    expect(cagr(0, 100, '2023-01-01', '2024-01-01')).toBeNull();
    expect(cagr(100, -1, '2023-01-01', '2024-01-01')).toBeNull();
    expect(cagr(100, 110, '2024-01-01', '2024-01-01')).toBeNull();
  });
});
