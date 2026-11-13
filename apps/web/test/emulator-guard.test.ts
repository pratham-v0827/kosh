// SEC (M2 fix, now under test): with emulator variables set, the Admin SDK accepts UNSIGNED
// tokens, so emulator mode must be refused on a production deployment.
import { describe, expect, it } from 'vitest';
import { assertEmulatorModeAllowed } from '@/lib/firebase/emulator-guard';

describe('assertEmulatorModeAllowed', () => {
  it('refuses emulator variables on any Vercel deployment', () => {
    expect(() =>
      assertEmulatorModeAllowed({ VERCEL_ENV: 'preview', FIREBASE_AUTH_EMULATOR_HOST: 'x:9099' }),
    ).toThrow(/Vercel/);
    expect(() =>
      assertEmulatorModeAllowed({ VERCEL: '1', FIRESTORE_EMULATOR_HOST: 'x:8080' }),
    ).toThrow(/Vercel/);
    expect(() =>
      assertEmulatorModeAllowed({
        VERCEL_ENV: 'production',
        FIREBASE_AUTH_EMULATOR_HOST: 'x:9099',
      }),
    ).toThrow(/production/);
    expect(() =>
      assertEmulatorModeAllowed({ VERCEL_ENV: 'production', FIRESTORE_EMULATOR_HOST: 'x:8080' }),
    ).toThrow(/production/);
  });

  it('allows local development and production without emulator variables', () => {
    expect(() =>
      assertEmulatorModeAllowed({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }),
    ).not.toThrow();
    expect(() => assertEmulatorModeAllowed({ VERCEL_ENV: 'production' })).not.toThrow();
  });
});
