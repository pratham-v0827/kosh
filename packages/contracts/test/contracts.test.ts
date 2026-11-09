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
