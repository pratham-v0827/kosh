import type { PriceTarget } from './types';

/**
 * THE single place that decides which providers price what, in which order.
 * Earlier providers win; later ones are fallbacks. Edit here to change routing.
 *
 *   NSE stocks      → Yahoo (unofficial)
 *   BSE stocks      → Alpha Vantage (free key, small daily budget) → Yahoo (unofficial)
 *   US stocks       → Finnhub (free key) → Twelve Data (free key) → Yahoo (unofficial)
 *   Mutual funds    → AMFI NAV file → mfapi.in
 *   Crypto          → CoinDCX public ticker
 *   Unlisted shares → none (manual, indicative)
 */
export type RouteKey =
  'IN_EQUITY:NSE' | 'IN_EQUITY:BSE' | 'US_EQUITY' | 'MUTUAL_FUND' | 'CRYPTO' | 'UNLISTED';

export const DEFAULT_ROUTES: Readonly<Record<RouteKey, readonly string[]>> = {
  'IN_EQUITY:NSE': ['yahoo-unofficial'],
  'IN_EQUITY:BSE': ['alphavantage', 'yahoo-unofficial'],
  US_EQUITY: ['finnhub', 'twelvedata', 'yahoo-unofficial'],
  MUTUAL_FUND: ['amfi-navall', 'mfapi'],
  CRYPTO: ['coindcx-ticker'],
  UNLISTED: [],
};

export function routeKey(t: PriceTarget): RouteKey {
  if (t.assetClass === 'IN_EQUITY') return t.exchange === 'BSE' ? 'IN_EQUITY:BSE' : 'IN_EQUITY:NSE';
  return t.assetClass;
}
