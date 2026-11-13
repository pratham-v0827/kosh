// Phase 2 bug audit: each block is a regression test for a confirmed bug (see docs/audits/phase2-bugs.md).
import { describe, expect, it } from 'vitest';
import {
  buildPositions,
  dayChange,
  formatMoney,
  formatQuantity,
  moneyDirection,
  shownDirection,
  type LedgerTxn,
  pickPrice,
  positionKey,
  positionXirr,
  type PriceInfo,
  xirr,
} from '../src';

const MINUS = '−';
const A = 'manual';
const I = 'IN_EQUITY:RELIANCE';
const t = (
  x: Omit<LedgerTxn, 'id' | 'accountId' | 'instrumentId'>,
  id = Math.random().toString(36),
): LedgerTxn => ({
  id,
  accountId: A,
  instrumentId: I,
  ...x,
});

describe('BUG-003: tiny negative amounts render as "−₹0.00"', () => {
  it('rounds to zero before choosing the sign', () => {
    expect(formatMoney(-0.004)).toBe('₹0.00');
    expect(formatMoney(-0.004, { signed: true })).toBe('₹0.00');
    expect(formatMoney(0.004, { signed: true })).toBe('₹0.00');
    expect(formatMoney(-0.006)).toBe(`${MINUS}₹0.01`);
    expect(formatMoney(-0.4, { compact: true })).toBe('₹0');
  });

  it('direction for arrows/colours uses the rounded value (no red arrow for −₹0.00)', () => {
    expect(moneyDirection(-0.004)).toBe(0);
    expect(moneyDirection('-0.006')).toBe(-1);
    expect(moneyDirection(0.005)).toBe(1);
    expect(moneyDirection(0)).toBe(0);
  });

  it('direction follows the displayed text, including compact mode', () => {
    expect(shownDirection(-0.4, formatMoney(-0.4, { compact: true }))).toBe(0);
    expect(shownDirection(-0.4, formatMoney(-0.4))).toBe(-1);
    expect(shownDirection(-0.004, formatMoney(-0.004))).toBe(0);
    expect(shownDirection(250000, formatMoney(250000, { compact: true }))).toBe(1);
    expect(shownDirection(-0.003, '−0.30%')).toBe(-1);
  });
});

describe('BUG-004: crypto quantities truncated to 4 decimals', () => {
  it('shows up to 8 decimals (satoshi precision)', () => {
    expect(formatQuantity('0.00012345')).toBe('0.00012345');
    expect(formatQuantity('1.123456789')).toBe('1.12345679');
    expect(formatQuantity('250')).toBe('250');
  });
});

describe('BUG-005: a manual price set today is ignored when a provider quote has the same date', () => {
  const quote: PriceInfo = {
    price: '100',
    currency: 'INR',
    asOf: '2026-11-09T10:00:00.000Z',
    source: 'yahoo-unofficial',
    status: 'fresh',
  };
  const manual = (asOf: string, updatedAt?: string): PriceInfo & { updatedAt?: string } => ({
    price: '95',
    currency: 'INR',
    asOf,
    source: 'manual',
    status: 'fresh',
    ...(updatedAt ? { updatedAt } : {}),
  });

  it('same day: the more recently entered one wins', () => {
    expect(pickPrice(quote, manual('2026-11-09', '2026-11-09T11:00:00.000Z'))?.source).toBe(
      'manual',
    );
    expect(pickPrice(quote, manual('2026-11-09', '2026-11-09T09:00:00.000Z'))?.source).toBe(
      'yahoo-unofficial',
    );
  });

  it('different days: the later date wins; either alone is used', () => {
    expect(pickPrice(quote, manual('2026-11-10'))?.source).toBe('manual');
    expect(pickPrice(quote, manual('2026-11-01'))?.source).toBe('yahoo-unofficial');
    expect(pickPrice(null, manual('2026-11-01'))?.source).toBe('manual');
    expect(pickPrice(quote, null)?.source).toBe('yahoo-unofficial');
    expect(pickPrice(null, null)).toBeNull();
  });
});

describe('BUG-006: money arithmetic silently rounded at 20 significant digits', () => {
  it('keeps large qty × price exact', () => {
    const p = buildPositions([
      t({ type: 'BUY', tradeDate: '2024-01-01', qty: '123456789012.123456', price: '98765.4321' }),
    ]).positions[positionKey(A, I)]!;
    // exact: 12193263112460905.2703853376 (BigInt check)
    expect(p.openCost).toBe('12193263112460905.2704');
  });
});

describe('BUG-009: day change for a lot bought after the quote date', () => {
  it('a lot bought after the latest quote contributes no day change', () => {
    const p = buildPositions([t({ type: 'BUY', tradeDate: '2026-11-09', qty: '10', price: '101' })])
      .positions[positionKey(A, I)]!;
    // quote is Friday's close; the purchase is Monday: nothing has moved since the buy
    expect(
      dayChange(p, { price: '105', prevClose: '100', asOf: '2026-11-06T10:00:00.000Z' }),
    ).toEqual({ change: '0', pct: 0 });
  });

  it('lots bought before or on the quote date still count', () => {
    const p = buildPositions([
      t({ type: 'BUY', tradeDate: '2026-10-01', qty: '10', price: '90' }),
      t({ type: 'BUY', tradeDate: '2026-11-06', qty: '10', price: '101' }),
      t({ type: 'BUY', tradeDate: '2026-11-09', qty: '10', price: '104' }),
    ]).positions[positionKey(A, I)]!;
    // 10 × (105−100) + 10 × (105−101) + 0 = 90
    expect(
      dayChange(p, { price: '105', prevClose: '100', asOf: '2026-11-06T10:00:00.000Z' })?.change,
    ).toBe('90');
  });
});

describe('Returns maths — explicit known values requested by the audit', () => {
  it('partial sell: XIRR matches an independent bisection (0.2787085013)', () => {
    const p = buildPositions([
      t({ type: 'BUY', tradeDate: '2023-01-01', qty: '10', price: '100' }),
      t({ type: 'SELL', tradeDate: '2023-07-02', qty: '5', price: '120' }),
    ]).positions[positionKey(A, I)]!;
    expect(p.realised).toBe('100'); // 5 × (120 − 100)
    const r = positionXirr(p, '600', '2024-01-01');
    expect(r.ok && r.rate).toBeCloseTo(0.2787085013, 8);
  });

  it('same-day flows and a zero flow are handled (15%)', () => {
    const r = xirr([
      { date: '2024-03-01', amount: -500 },
      { date: '2024-03-01', amount: -500 },
      { date: '2024-09-01', amount: 0 },
      { date: '2025-03-01', amount: 1150 },
    ]);
    expect(r.ok && r.rate).toBeCloseTo(0.15, 9);
  });

  it('a single transaction is not a rate; a holding bought today has no XIRR', () => {
    expect(xirr([{ date: '2024-01-01', amount: -100 }])).toEqual({
      ok: false,
      reason: 'INSUFFICIENT_FLOWS',
    });
    const p = buildPositions([t({ type: 'BUY', tradeDate: '2026-11-09', qty: '1', price: '100' })])
      .positions[positionKey(A, I)]!;
    expect(positionXirr(p, '100', '2026-11-09')).toEqual({ ok: false, reason: 'ZERO_DURATION' });
  });

  it('negative-only and all-zero flows are rejected, not solved', () => {
    expect(
      xirr([
        { date: '2024-01-01', amount: 0 },
        { date: '2025-01-01', amount: 0 },
      ]),
    ).toEqual({ ok: false, reason: 'NO_SIGN_CHANGE' });
    expect(
      xirr([
        { date: '2024-01-01', amount: -1 },
        { date: '2025-01-01', amount: -1 },
      ]),
    ).toEqual({ ok: false, reason: 'NO_SIGN_CHANGE' });
  });
});
