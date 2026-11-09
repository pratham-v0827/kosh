import type { AssetClass } from '@kosh/core';
import { amfiNavProvider, mfapiProvider } from './providers/amfi';
import { coindcxProvider } from './providers/coindcx';
import { finnhubProvider, twelveDataProvider } from './providers/us';
import type { PriceProvider } from './types';

export * from './types';
export * from './http';
export * from './staleness';
export * from './service';
export { parseNavAll, amfiNavProvider, mfapiProvider } from './providers/amfi';
export { coindcxProvider, parseTicker, price24hAgo } from './providers/coindcx';
export { finnhubProvider, twelveDataProvider } from './providers/us';
export { frankfurterFx } from './providers/frankfurter';

/**
 * Default provider chain, in preference order per asset class (docs/PLAN.md §6.1).
 * Indian equities have NO automatic source by default: NSE/BSE downloads reject automated
 * clients and Kosh does not work around bot protection. Prices for them are manual until a
 * permitted source is configured (see docs/prices.md).
 */
export const DEFAULT_PROVIDERS: PriceProvider[] = [
  amfiNavProvider,
  mfapiProvider,
  coindcxProvider,
  finnhubProvider,
  twelveDataProvider,
];

/** Which asset classes can be priced automatically with the current environment. */
export function coverage(env: Record<string, string | undefined>, providers = DEFAULT_PROVIDERS) {
  const classes: AssetClass[] = ['IN_EQUITY', 'US_EQUITY', 'MUTUAL_FUND', 'CRYPTO', 'UNLISTED'];
  return classes.map((c) => {
    const ps = providers.filter((p) => p.assetClasses.includes(c));
    const usable = ps.filter((p) => !p.requiresEnv || env[p.requiresEnv]);
    return {
      assetClass: c,
      providers: ps.map((p) => ({
        id: p.id,
        label: p.label,
        configured: !p.requiresEnv || Boolean(env[p.requiresEnv]),
      })),
      automatic: usable.length > 0,
    };
  });
}
