import { z } from 'zod';
import { getText } from './http';
import { yahooThrottle } from './providers/yahoo';
import { INDIAN_ISIN, type ProviderContext } from './types';

/**
 * ISIN → exchange ticker for Indian shares and exchange-traded funds.
 *
 * Statements such as Groww's identify a holding by ISIN only, but prices are looked up by
 * ticker. This asks Yahoo Finance's search endpoint (UNOFFICIAL, like the Yahoo price source: an
 * honest, identified client, throttled, and switched off by ENABLE_UNOFFICIAL_YAHOO=false).
 * NSE and BSE publish official ISIN lists but refuse automated clients (ADR-0019).
 *
 * Only the ISIN is sent. Results are cached by the caller, so each ISIN is looked up once.
 */
export interface IsinMatch {
  symbol: string;
  exchange: 'NSE' | 'BSE';
  /** Name as the source gives it, when present. */
  name?: string;
}

export type IsinLookup =
  | { status: 'found'; match: IsinMatch }
  /** The source answered and knows no Indian listing for this ISIN. Safe to remember. */
  | { status: 'not-found' }
  /** Switched off, or the source could not be reached. Not a fact about the ISIN: do not cache. */
  | { status: 'unavailable'; reason: string };

const SEARCH = 'https://query1.finance.yahoo.com/v1/finance/search';

const SearchResponse = z.object({
  quotes: z
    .array(
      z.object({
        symbol: z.string().optional(),
        shortname: z.string().optional(),
        longname: z.string().optional(),
      }),
    )
    .default([]),
});

// Same shape the rest of Kosh accepts for a ticker (letters, digits, and . - &).
const TICKER = /^[A-Z0-9][A-Z0-9.\-&]{0,19}$/;

/** Pick the Indian listing from a search response: NSE first, else BSE. Null when there is none. */
export function parseIsinSearch(body: string): IsinMatch | null {
  let parsed: z.infer<typeof SearchResponse>;
  try {
    parsed = SearchResponse.parse(JSON.parse(body));
  } catch {
    throw new Error('unexpected response shape');
  }
  const pick = (suffix: '.NS' | '.BO'): IsinMatch | null => {
    for (const q of parsed.quotes) {
      const s = q.symbol ?? '';
      if (!s.endsWith(suffix)) continue;
      const symbol = s.slice(0, -suffix.length).toUpperCase();
      if (!TICKER.test(symbol)) continue;
      const name = (q.longname ?? q.shortname ?? '').trim().slice(0, 120);
      return { symbol, exchange: suffix === '.NS' ? 'NSE' : 'BSE', ...(name ? { name } : {}) };
    }
    return null;
  };
  return pick('.NS') ?? pick('.BO');
}

export async function lookupIsin(isin: string, ctx: ProviderContext): Promise<IsinLookup> {
  // The ISIN goes into a URL: only a well-formed one is ever sent.
  if (!INDIAN_ISIN.test(isin)) return { status: 'not-found' };
  if ((ctx.env.ENABLE_UNOFFICIAL_YAHOO ?? 'true').toLowerCase() === 'false') {
    return { status: 'unavailable', reason: 'disabled by configuration' };
  }
  const url = `${SEARCH}?q=${encodeURIComponent(isin)}&quotesCount=6&newsCount=0&listsCount=0`;
  try {
    const body = await yahooThrottle(() =>
      getText('yahoo-unofficial', url, ctx, { timeoutMs: 8000, retries: 1 }),
    );
    const match = parseIsinSearch(body);
    return match ? { status: 'found', match } : { status: 'not-found' };
  } catch (e) {
    return { status: 'unavailable', reason: e instanceof Error ? e.message : 'lookup failed' };
  }
}
