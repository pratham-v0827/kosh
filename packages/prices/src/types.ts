import type { AssetClass } from '@kosh/core';

export type Currency = 'INR' | 'USD';

/** Listing venue for equities. Indian stocks default to NSE. */
export type Exchange = 'NSE' | 'BSE' | 'US';

/** Something we can price. Only public identifiers: never user data. */
export interface PriceTarget {
  /** Kosh instrument id, e.g. "MUTUAL_FUND:120590", "CRYPTO:BTC", "IN_EQUITY:BSE:RELIANCE". */
  instrumentId: string;
  assetClass: AssetClass;
  /** Provider lookup key: AMFI code or ISIN, coin symbol, ticker. */
  symbol: string;
  /** For equities: where it is listed (drives provider routing). */
  exchange?: Exchange;
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

/**
 * Shared daily request allowance for quota-limited providers (e.g. Alpha Vantage's free tier).
 * Implementations must be atomic across server instances (Firestore transaction in production).
 */
export interface RequestBudget {
  /** Reserve up to `n` calls for today; returns how many were granted (0…n). */
  reserve(provider: string, n: number, dailyLimit: number): Promise<number>;
  /** Mark today's allowance as used up (e.g. the provider said "rate limit reached"). */
  exhaust(provider: string, dailyLimit: number): Promise<void>;
}

export interface ProviderContext {
  fetch: typeof fetch;
  now: Date;
  signal?: AbortSignal;
  env: Record<string, string | undefined>;
  budget?: RequestBudget;
}

export interface PriceProvider {
  id: string;
  /** Human-readable name for docs and the UI. */
  label: string;
  /** Unofficial / reverse-engineered sources are labelled as such everywhere. */
  unofficial?: boolean;
  assetClasses: readonly AssetClass[];
  /** Environment variable that must be set (e.g. a FREE API key), if any. */
  requiresEnv?: string;
  /** Feature flag check (e.g. ENABLE_UNOFFICIAL_YAHOO). Default: enabled. */
  isEnabled?(env: Record<string, string | undefined>): boolean;
  /** Whether this provider can serve the target (e.g. symbol format, exchange). */
  supports(target: PriceTarget): boolean;
  /**
   * Fetch quotes. Missing symbols are simply absent from the result. Throws on transport failure;
   * may throw a ProviderError carrying `partial` results when it stops part-way (e.g. quota).
   */
  fetch(targets: PriceTarget[], ctx: ProviderContext): Promise<Map<string, Quote>>;
}

export interface FxProvider {
  id: string;
  latest(ctx: ProviderContext): Promise<FxRate>;
  /** Reference rate for a date (or the closest earlier business day). */
  onDate(date: string, ctx: ProviderContext): Promise<FxRate>;
}
