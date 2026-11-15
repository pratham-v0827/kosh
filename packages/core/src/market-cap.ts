import type { MarketCap } from './analytics';
import type { HoldingView } from './book';
import { AMFI_MARKET_CAP } from './data/amfi-market-cap';

/**
 * Market-cap category of an Indian share, from AMFI's half-yearly list (SEBI's rule: ranks 1–100
 * large cap, 101–250 mid cap, the rest small cap). Only the top 250 are stored, so a share not
 * found there, including one listed after the list's date, counts as small cap.
 */
export const MARKET_CAP_LIST = { asOf: AMFI_MARKET_CAP.asOf, listed: AMFI_MARKET_CAP.listed };

const byIsin = new Map<string, MarketCap>();
const byNse = new Map<string, MarketCap>();
const byBse = new Map<string, MarketCap>();
AMFI_MARKET_CAP.top250.forEach(([isin, nse, bse], i) => {
  const cap: MarketCap = i < 100 ? 'LARGE' : 'MID';
  byIsin.set(isin, cap);
  if (nse) byNse.set(nse, cap);
  if (bse) byBse.set(bse, cap);
});

export function marketCapOf(
  h: Pick<HoldingView, 'instrumentId' | 'assetClass' | 'symbol' | 'isin'>,
): MarketCap | null {
  if (h.assetClass !== 'IN_EQUITY') return null;
  const isin = h.isin ?? (h.symbol && /^IN[A-Z0-9]{10}$/.test(h.symbol) ? h.symbol : undefined);
  const viaIsin = isin ? byIsin.get(isin) : undefined;
  if (viaIsin) return viaIsin;
  if (!h.symbol) return 'UNCLASSIFIED';
  const [own, other] = h.instrumentId.startsWith('IN_EQUITY:BSE:')
    ? [byBse, byNse]
    : [byNse, byBse];
  return own.get(h.symbol) ?? other.get(h.symbol) ?? 'SMALL';
}
