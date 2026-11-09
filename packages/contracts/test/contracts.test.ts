import { describe, expect, it } from 'vitest';
import {
  fieldErrors,
  ManualHoldingInput,
  SettingsSchema,
  TransactionInput,
  DEFAULT_SETTINGS,
} from '../src';

describe('ManualHoldingInput', () => {
  const valid = {
    instrument: { name: 'Acme Pre-IPO', assetClass: 'UNLISTED', symbol: '' },
    qty: '100',
    price: '245.5',
    tradeDate: '2024-05-01',
    currentPrice: '310',
  };

  it('accepts a valid unlisted holding and normalises an empty symbol', () => {
    const r = ManualHoldingInput.parse(valid);
    expect(r.instrument.symbol).toBeUndefined();
  });

  it('upper-cases symbols', () => {
    const r = ManualHoldingInput.parse({
      ...valid,
      instrument: { ...valid.instrument, symbol: 'ine002a01018' },
    });
    expect(r.instrument.symbol).toBe('INE002A01018');
  });

  it('rejects zero qty, negative/garbage prices, bad and future dates', () => {
    const r = ManualHoldingInput.safeParse({
      ...valid,
      qty: '0',
      price: '-1',
      tradeDate: '2999-01-01',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const e = fieldErrors(r.error);
      expect(Object.keys(e).sort()).toEqual(['price', 'qty', 'tradeDate']);
    }
    expect(ManualHoldingInput.safeParse({ ...valid, tradeDate: '2024-02-30' }).success).toBe(false);
    expect(ManualHoldingInput.safeParse({ ...valid, price: '1e5' }).success).toBe(false);
  });

  it('rejects an unknown asset class', () => {
    expect(
      ManualHoldingInput.safeParse({
        ...valid,
        instrument: { ...valid.instrument, assetClass: 'GOLD' },
      }).success,
    ).toBe(false);
  });
});

describe('TransactionInput', () => {
  it('requires fields by type', () => {
    expect(
      TransactionInput.safeParse({
        type: 'SELL',
        instrumentId: 'x',
        tradeDate: '2024-01-01',
        qty: '1',
        price: '2',
      }).success,
    ).toBe(true);
    expect(
      TransactionInput.safeParse({
        type: 'SELL',
        instrumentId: 'x',
        tradeDate: '2024-01-01',
        amount: '1',
      }).success,
    ).toBe(false);
    expect(
      TransactionInput.safeParse({
        type: 'SPLIT',
        instrumentId: 'x',
        tradeDate: '2024-01-01',
        ratio: { from: 1, to: 2 },
      }).success,
    ).toBe(true);
    expect(
      TransactionInput.safeParse({
        type: 'SPLIT',
        instrumentId: 'x',
        tradeDate: '2024-01-01',
        ratio: { from: 1.5, to: 2 },
      }).success,
    ).toBe(false);
  });
});

describe('SettingsSchema', () => {
  it('accepts the defaults and rejects extra currencies', () => {
    expect(SettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, baseCurrency: 'USD' }).success).toBe(
      false,
    );
  });
});

describe('InstrumentInput symbol and exchange (M2.1)', () => {
  const base = { name: 'Reliance', assetClass: 'IN_EQUITY' as const };

  it('accepts NSE/BSE tickers and US class tickers', () => {
    expect(ManualHoldingInputInstrument({ ...base, symbol: 'reliance', exchange: 'BSE' })).toBe(
      true,
    );
    expect(ManualHoldingInputInstrument({ ...base, symbol: 'M&M' })).toBe(true);
    expect(
      ManualHoldingInputInstrument({ name: 'Berkshire', assetClass: 'US_EQUITY', symbol: 'BRK.B' }),
    ).toBe(true);
  });

  it('rejects characters that could alter ids or URLs, and over-long symbols', () => {
    for (const symbol of [
      'IN:EVIL',
      'A/B',
      '../x',
      'A B',
      'A?x=1',
      '%2F',
      'A'.repeat(21),
      '-LEADING',
    ]) {
      expect(ManualHoldingInputInstrument({ ...base, symbol }), symbol).toBe(false);
    }
  });

  it('allows an exchange only for Indian stocks', () => {
    expect(
      ManualHoldingInputInstrument({
        name: 'Apple',
        assetClass: 'US_EQUITY',
        symbol: 'AAPL',
        exchange: 'NSE',
      }),
    ).toBe(false);
  });
});

import { InstrumentInput } from '../src';
function ManualHoldingInputInstrument(v: unknown) {
  return InstrumentInput.safeParse(v).success;
}

// Phase 2 bug audit regressions (docs/audits/phase2-bugs.md)
import { afterEach, vi } from 'vitest';
import { IsoDate, PositiveDecimalString, DecimalString } from '../src';

describe('BUG-002: a trade date one day in the future (IST) was accepted', () => {
  afterEach(() => vi.useRealTimers());

  it('rejects tomorrow (IST) in the Indian morning', () => {
    vi.useFakeTimers({ now: new Date('2026-11-09T05:00:00Z') }); // 10:30 IST, 9 Nov
    expect(IsoDate.safeParse('2026-11-09').success).toBe(true);
    expect(IsoDate.safeParse('2026-11-10').success).toBe(false);
  });

  it('accepts IST "today" late in the UTC evening', () => {
    vi.useFakeTimers({ now: new Date('2026-11-09T20:00:00Z') }); // 01:30 IST, 10 Nov
    expect(IsoDate.safeParse('2026-11-10').success).toBe(true);
    expect(IsoDate.safeParse('2026-11-11').success).toBe(false);
  });
});

describe('BUG-006: no upper bound or decimal-place limit on amounts', () => {
  it('rejects absurd magnitudes and excessive decimals, keeps realistic values', () => {
    expect(PositiveDecimalString.safeParse('1000000000000').success).toBe(true); // 1e12
    expect(PositiveDecimalString.safeParse('1000000000000.01').success).toBe(false);
    expect(DecimalString.safeParse('99999999999999999999999999999').success).toBe(false);
    expect(PositiveDecimalString.safeParse('0.0000000001').success).toBe(true); // 10 dp
    expect(PositiveDecimalString.safeParse('0.00000000001').success).toBe(false); // 11 dp
    expect(PositiveDecimalString.safeParse('0.00012345').success).toBe(true); // satoshis
  });
});
