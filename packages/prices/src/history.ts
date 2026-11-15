import type { IndexPoint } from '@kosh/core';
import { getText, isDecimal, parseIndianDate, ProviderError } from './http';
import { fetchYahooHistory, type IndexHistory, yahooSymbol } from './providers/yahoo';
import type { Currency, PriceTarget, ProviderContext } from './types';

/** Where a holding's daily price history comes from. */
export type HistorySource =
  { provider: 'yahoo'; symbol: string; currency: Currency } | { provider: 'mfapi'; code: string };

/** Listed shares → Yahoo (unofficial); mutual funds → mfapi.in; crypto and unlisted → none. */
export function historySourceFor(t: PriceTarget): HistorySource | null {
  if (t.assetClass === 'IN_EQUITY' || t.assetClass === 'US_EQUITY') {
    const symbol = yahooSymbol(t);
    return symbol
      ? { provider: 'yahoo', symbol, currency: t.assetClass === 'US_EQUITY' ? 'USD' : 'INR' }
      : null;
  }
  if (t.assetClass === 'MUTUAL_FUND' && /^\d{4,7}$/.test(t.symbol)) {
    return { provider: 'mfapi', code: t.symbol };
  }
  return null;
}

/** mfapi.in's full NAV history (newest first) → valid NAVs, oldest first. Null for "not found". */
export function parseMfHistory(body: string): IndexPoint[] | null {
  let json: { status?: unknown; data?: unknown };
  try {
    json = JSON.parse(body) as typeof json;
  } catch {
    throw new ProviderError('mfapi', 'invalid JSON');
  }
  if (json.status !== 'SUCCESS' || !Array.isArray(json.data)) return null;
  const byDay = new Map<string, number>();
  for (const row of json.data as { date?: unknown; nav?: unknown }[]) {
    const date = typeof row?.date === 'string' ? parseIndianDate(row.date) : null;
    const nav = typeof row?.nav === 'string' && isDecimal(row.nav) ? Number(row.nav) : NaN;
    if (date && nav > 0) byDay.set(date, Math.round(nav * 1e4) / 1e4);
  }
  return [...byDay]
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** A holding's daily closes (NAVs for funds). Never throws. */
export async function fetchDailyHistory(
  source: HistorySource,
  range: '1mo' | '1y' | '10y',
  ctx: ProviderContext,
): Promise<IndexHistory> {
  if (source.provider === 'yahoo') {
    return fetchYahooHistory(source.symbol, source.currency, range, ctx);
  }
  try {
    // mfapi has no range parameter: the whole history is one small JSON document.
    const body = await getText(
      'mfapi',
      `https://api.mfapi.in/mf/${encodeURIComponent(source.code)}`,
      ctx,
      { timeoutMs: 10000, retries: 1 },
    );
    const closes = parseMfHistory(body);
    return closes && closes.length > 0 ? { status: 'ok', closes } : { status: 'not-found' };
  } catch (e) {
    return { status: 'unavailable', reason: e instanceof Error ? e.message : 'request failed' };
  }
}
