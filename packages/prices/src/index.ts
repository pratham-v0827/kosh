import { amfiNavProvider, mfapiProvider } from './providers/amfi';
import { alphaVantageProvider } from './providers/alphavantage';
import { coindcxProvider } from './providers/coindcx';
import { finnhubProvider, twelveDataProvider } from './providers/us';
import { yahooProvider } from './providers/yahoo';
import { DEFAULT_ROUTES, type RouteKey } from './routing';
import type { PriceProvider } from './types';

export * from './types';
export * from './http';
export * from './staleness';
export * from './service';
export * from './routing';
export { parseNavAll, amfiNavProvider, mfapiProvider } from './providers/amfi';
export { coindcxProvider, parseTicker, price24hAgo } from './providers/coindcx';
export { finnhubProvider, twelveDataProvider } from './providers/us';
export { frankfurterFx } from './providers/frankfurter';
export { yahooProvider, parseChart, yahooSymbol } from './providers/yahoo';
export {
  alphaVantageProvider,
  parseGlobalQuote,
  avSymbol,
  AV_DEFAULT_DAILY_LIMIT,
  AV_MAX_CALLS_PER_RUN,
} from './providers/alphavantage';

/**
 * Every provider Kosh knows. All are free: no key, or a FREE key the self-hoster creates.
 * Which provider is used for what, and in which order, lives in routing.ts.
 */
export const DEFAULT_PROVIDERS: PriceProvider[] = [
  amfiNavProvider,
  mfapiProvider,
  coindcxProvider,
  alphaVantageProvider,
  finnhubProvider,
  twelveDataProvider,
  yahooProvider,
];

const ROUTE_LABELS: Record<RouteKey, string> = {
  'IN_EQUITY:NSE': 'Indian stocks (NSE)',
  'IN_EQUITY:BSE': 'Indian stocks (BSE)',
  US_EQUITY: 'US stocks',
  MUTUAL_FUND: 'Mutual funds',
  CRYPTO: 'Crypto',
  UNLISTED: 'Unlisted shares',
};

/** Per route: which providers are usable with the current environment (booleans only, no keys). */
export function coverage(env: Record<string, string | undefined>, providers = DEFAULT_PROVIDERS) {
  const registry = new Map(providers.map((p) => [p.id, p]));
  return (Object.keys(DEFAULT_ROUTES) as RouteKey[]).map((route) => {
    const ps = DEFAULT_ROUTES[route].flatMap((id) => (registry.has(id) ? [registry.get(id)!] : []));
    const rows = ps.map((p) => ({
      id: p.id,
      label: p.label,
      unofficial: Boolean(p.unofficial),
      configured:
        (!p.requiresEnv || Boolean(env[p.requiresEnv])) && (!p.isEnabled || p.isEnabled(env)),
    }));
    return {
      route,
      label: ROUTE_LABELS[route],
      providers: rows,
      automatic: rows.some((r) => r.configured),
    };
  });
}
