import { clearMarketData, resetE2EUser } from './support/emulator';

/**
 * Before every run: a fresh pratham_test in the Auth emulator (never in a real project), and, for
 * mock runs, no market data left over from `pnpm dev` (real prices would mix with the mock ones).
 */
export default async function globalSetup() {
  if (process.env.KOSH_E2E_LIVE !== '1') await clearMarketData();
  await resetE2EUser();
}
