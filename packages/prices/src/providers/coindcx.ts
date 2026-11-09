import Decimal from 'decimal.js';
import { getJson, isDecimal } from '../http';
import type { PriceProvider, Quote } from '../types';

/** CoinDCX public ticker (no key). INR markets match what CoinDCX users can actually sell at. */
export const COINDCX_TICKER_URL = 'https://api.coindcx.com/exchange/ticker';

interface Ticker {
  market: string;
  last_price: string;
  change_24_hour?: string;
  timestamp: number; // epoch seconds
}

export function parseTicker(rows: Ticker[]): Map<string, Ticker> {
  return new Map(
    rows.filter((r) => typeof r.market === 'string').map((r) => [r.market.toUpperCase(), r]),
  );
}

/** Price 24 hours ago, derived from the 24h % change (CoinDCX gives no explicit previous close). */
export function price24hAgo(last: string, changePct: string | undefined): string | undefined {
  if (changePct === undefined || !Number.isFinite(Number(changePct))) return undefined;
  const factor = new Decimal(1).plus(new Decimal(changePct).div(100));
  return factor.lte(0) ? undefined : new Decimal(last).div(factor).toDecimalPlaces(8).toString();
}

export const coindcxProvider: PriceProvider = {
  id: 'coindcx-ticker',
  label: 'CoinDCX public ticker (INR markets)',
  assetClasses: ['CRYPTO'],
  supports: (t) => t.assetClass === 'CRYPTO' && /^[A-Z0-9]{2,15}$/.test(t.symbol),
  async fetch(targets, ctx) {
    const tickers = parseTicker(await getJson<Ticker[]>('coindcx-ticker', COINDCX_TICKER_URL, ctx));
    const out = new Map<string, Quote>();
    for (const t of targets) {
      const tk = tickers.get(`${t.symbol}INR`);
      if (!tk || !isDecimal(tk.last_price)) continue;
      const last = new Decimal(tk.last_price).toString();
      const prev = price24hAgo(last, tk.change_24_hour);
      out.set(t.instrumentId, {
        instrumentId: t.instrumentId,
        price: last,
        ...(prev ? { prevClose: prev } : {}),
        currency: 'INR',
        asOf: new Date(tk.timestamp * 1000).toISOString(),
        source: 'coindcx-ticker',
        delayed: false,
      });
    }
    return out;
  },
};
