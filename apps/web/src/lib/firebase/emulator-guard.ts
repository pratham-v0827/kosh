/**
 * With FIREBASE_AUTH_EMULATOR_HOST set, the Admin SDK accepts UNSIGNED emulator tokens. That must
 * never happen on a real deployment, so emulator mode is refused on every Vercel deployment
 * (production and preview): the emulators cannot run there, so the variables are a mistake.
 */
export function assertEmulatorModeAllowed(env: Record<string, string | undefined> = process.env) {
  if (
    (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST) &&
    (env.VERCEL === '1' || Boolean(env.VERCEL_ENV))
  ) {
    throw new Error(
      'Emulator variables are set on a Vercel deployment (production or preview). Remove FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST.',
    );
  }
}

/**
 * KOSH_MOCK_PRICES=true replaces every market-data request with invented, deterministic data (for
 * end-to-end tests and recordings). Allowed only with the local emulators, never on Vercel, so real
 * users can never be shown made-up prices.
 */
export function mockPricesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.KOSH_MOCK_PRICES !== 'true') return false;
  if (!env.FIRESTORE_EMULATOR_HOST || env.VERCEL === '1' || Boolean(env.VERCEL_ENV)) {
    throw new Error('KOSH_MOCK_PRICES=true only works with the local Firebase emulators');
  }
  return true;
}
