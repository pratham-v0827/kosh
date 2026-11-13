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
