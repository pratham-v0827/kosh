import type { AssetClass } from '@kosh/core';

export type Currency = 'INR' | 'USD';

/** Something we can price. Only public identifiers: never user data. */
export interface PriceTarget {
  /** Kosh instrument id, e.g. "MUTUAL_FUND:120590", "CRYPTO:BTC", "US_EQUITY:AAPL". */
  instrumentId: string;
  assetClass: AssetClass;
  /** Provider lookup key: AMFI code or ISIN, coin symbol, ticker, ISIN/NSE symbol. */
  symbol: string;
}

export interface Quote {
  instrumentId: string;
  /** Price per unit in `currency`, decimal string. */
  price: string;
  /** Previous close / NAV / 24h-ago price, when the source provides one. */
  prevClose?: string;
  currency: Currency;
  /** When the price was valid (ISO 8601). End-of-day sources use the close of that day. */
  asOf: string;
  /** Provider id, e.g. "amfi-navall". Shown to users next to the price. */
  source: string;
  /** True when the provider is known to delay quotes. */
  delayed: boolean;
}

export interface FxRate {
  pair: 'USDINR';
  /** INR per 1 USD. */
  rate: string;
  /** Reference date (YYYY-MM-DD). */
  asOf: string;
  source: string;
}

export interface ProviderContext {
  fetch: typeof fetch;
  now: Date;
  signal?: AbortSignal;
  env: Record<string, string | undefined>;
}

export interface PriceProvider {
  id: string;
  /** Human-readable name for docs and the UI. */
  label: string;
  assetClasses: readonly AssetClass[];
  /** Environment variable that must be set (e.g. an API key), if any. */
  requiresEnv?: string;
  /** Whether this provider can serve the target (e.g. symbol format). */
  supports(target: PriceTarget): boolean;
  /** Fetch quotes. Missing symbols are simply absent from the result. Throws on transport failure. */
  fetch(targets: PriceTarget[], ctx: ProviderContext): Promise<Map<string, Quote>>;
}

export interface FxProvider {
  id: string;
  latest(ctx: ProviderContext): Promise<FxRate>;
  /** Reference rate for a date (or the closest earlier business day). */
  onDate(date: string, ctx: ProviderContext): Promise<FxRate>;
}
