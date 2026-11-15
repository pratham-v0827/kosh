import { AUTH_HOST, clearMarketData, FIRESTORE_HOST, resetE2EUser } from './support/emulator';

/** Both emulators answer (Auth can start a moment after Firestore, e.g. on a fresh CI runner). */
async function waitForEmulators(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  for (const host of [FIRESTORE_HOST, AUTH_HOST]) {
    for (;;) {
      const up = await fetch(`http://${host}/`).then(
        () => true,
        () => false,
      );
      if (up) break;
      if (Date.now() > deadline) throw new Error(`Emulator at ${host} did not start`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/**
 * Before every run: a fresh pratham_test in the Auth emulator (never in a real project), and, for
 * mock runs, no market data left over from `pnpm dev` (real prices would mix with the mock ones).
 */
export default async function globalSetup() {
  await waitForEmulators();
  if (process.env.KOSH_E2E_LIVE !== '1') await clearMarketData();
  await resetE2EUser();
}
