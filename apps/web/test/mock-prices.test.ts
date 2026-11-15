// End-to-end runs use invented market data. That switch must never work outside the emulators.
import { describe, expect, it } from 'vitest';
import { mockPricesEnabled } from '@/lib/firebase/emulator-guard';

describe('mockPricesEnabled (KOSH_MOCK_PRICES)', () => {
  it('is off unless asked for', () => {
    expect(mockPricesEnabled({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).toBe(false);
    expect(mockPricesEnabled({ KOSH_MOCK_PRICES: 'false' })).toBe(false);
  });

  it('works with the local emulators', () => {
    expect(
      mockPricesEnabled({ KOSH_MOCK_PRICES: 'true', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }),
    ).toBe(true);
  });

  it('refuses without the emulators or on any Vercel deployment', () => {
    expect(() => mockPricesEnabled({ KOSH_MOCK_PRICES: 'true' })).toThrow(/emulator/);
    expect(() =>
      mockPricesEnabled({
        KOSH_MOCK_PRICES: 'true',
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
        VERCEL_ENV: 'preview',
      }),
    ).toThrow(/emulator/);
  });
});
