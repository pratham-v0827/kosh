import { clearMarketData } from './support/emulator';

/** After a mock run: drop the mock market data, so `pnpm dev` on the same emulator fetches real data. */
export default async function globalTeardown() {
  if (process.env.KOSH_E2E_LIVE !== '1') await clearMarketData();
}
