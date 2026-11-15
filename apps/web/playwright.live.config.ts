// One run against the REAL free price sources (Yahoo unofficial, AMFI, mfapi, Frankfurter,
// CoinDCX) instead of mock data: `pnpm --filter @kosh/web e2e:live`. Run it sparingly, by hand.
import { e2eConfig } from './playwright.config';

export default e2eConfig(true);
