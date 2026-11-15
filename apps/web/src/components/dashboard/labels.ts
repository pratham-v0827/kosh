import { ASSET_CLASS_LABELS } from '@kosh/contracts';
import type { AllocationBy, AssetClass, BenchmarkId } from '@kosh/core';

export const BENCHMARK_LABEL: Record<BenchmarkId, string> = {
  NIFTY50: 'Nifty 50',
  SENSEX: 'Sensex',
  SP500: 'S&P 500',
};

/** Human names for the keys the analytics functions return. */
export function accountLabel(accountId: string): string {
  switch (accountId) {
    case 'manual':
      return 'Added by hand';
    case 'import:groww':
      return 'Groww';
    case 'import:indmoney-us':
      return 'INDmoney (US)';
    case 'import:kosh':
      return 'Kosh CSV import';
    default:
      return accountId.startsWith('import:') ? accountId.slice('import:'.length) : accountId;
  }
}

const GEOGRAPHY: Record<string, string> = {
  IN: 'India',
  US: 'United States',
  GLOBAL: 'Global (crypto)',
};
const KIND: Record<string, string> = {
  STOCK: 'Stocks',
  ETF: 'ETFs',
  MUTUAL_FUND: 'Mutual funds',
  CRYPTO: 'Crypto',
  UNLISTED: 'Unlisted shares',
};
const MARKET_CAP: Record<string, string> = {
  LARGE: 'Large cap',
  MID: 'Mid cap',
  SMALL: 'Small cap',
  UNCLASSIFIED: 'Not classified',
};

export function sliceLabel(by: AllocationBy, key: string): string {
  switch (by) {
    case 'assetClass':
      return ASSET_CLASS_LABELS[key as AssetClass] ?? key;
    case 'account':
      return accountLabel(key);
    case 'geography':
      return GEOGRAPHY[key] ?? key;
    case 'instrumentType':
      return KIND[key] ?? key;
    case 'marketCap':
      return MARKET_CAP[key] ?? key;
  }
}

/** Price sources as shown to users (the same wording as the price badges). */
export function sourceLabel(source: string): string {
  switch (source) {
    case 'yahoo-unofficial':
      return 'Yahoo Finance (unofficial)';
    case 'alphavantage':
      return 'Alpha Vantage';
    case 'amfi-navall':
    case 'mfapi':
      return 'AMFI NAV';
    case 'coindcx-ticker':
      return 'CoinDCX';
    case 'finnhub':
      return 'Finnhub';
    case 'twelvedata':
      return 'Twelve Data';
    case 'manual':
      return 'Your price';
    default:
      return source;
  }
}
