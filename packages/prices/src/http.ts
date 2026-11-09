import type { ProviderContext, Quote } from './types';

/** Identifies Kosh honestly. Providers must be accessed politely: no spoofing, no bot-check evasion. */
export const USER_AGENT = 'Kosh/0.1 (open-source portfolio tracker; price lookups by symbol only)';

/**
 * The only hosts Kosh may call for market data (SSRF guard). A symbol can never change the host:
 * URLs are built from constants plus encodeURIComponent(symbol), and checked here before fetching.
 */
export const ALLOWED_HOSTS = new Set([
  'portal.amfiindia.com',
  'www.amfiindia.com',
  'api.mfapi.in',
  'api.coindcx.com',
  'finnhub.io',
  'api.twelvedata.com',
  'api.frankfurter.dev',
  'www.alphavantage.co',
  'query1.finance.yahoo.com',
]);

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status?: number,
    /** Quotes obtained before the provider stopped (e.g. daily quota reached). */
    public readonly partial?: Map<string, Quote>,
  ) {
    super(`${provider}: ${message}`);
  }
}

export function assertAllowedUrl(provider: string, url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ProviderError(provider, 'invalid URL');
  }
  if (
    u.protocol !== 'https:' ||
    !ALLOWED_HOSTS.has(u.hostname) ||
    u.username ||
    u.password ||
    u.port
  ) {
    throw new ProviderError(provider, `host not allowed: ${u.hostname}`);
  }
  return u;
}

export interface GetOptions {
  timeoutMs?: number;
  /** Retries for network errors, 429 and 5xx, with exponential backoff + jitter. Default 0. */
  retries?: number;
  /** Non-2xx statuses whose body should still be returned (e.g. Yahoo 404 "symbol not found"). */
  acceptStatus?: number[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getText(
  provider: string,
  url: string,
  ctx: ProviderContext,
  options: GetOptions | number = {},
): Promise<string> {
  const o: GetOptions = typeof options === 'number' ? { timeoutMs: options } : options;
  const { timeoutMs = 15_000, retries = 0, acceptStatus = [] } = o;
  const target = assertAllowedUrl(provider, url);
  for (let attempt = 0; ; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
    let res: Response | null = null;
    let failure: ProviderError;
    try {
      res = await ctx.fetch(target, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json,text/plain,*/*' },
        redirect: 'error', // a redirect could leave the allow-list
        signal,
      });
      if (res.ok || acceptStatus.includes(res.status)) return await res.text();
      failure = new ProviderError(provider, `HTTP ${res.status}`, res.status);
    } catch (e) {
      failure = new ProviderError(provider, `request failed (${(e as Error).name})`);
    }
    const retryable = !res || res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries || ctx.signal?.aborted) throw failure;
    await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 250));
  }
}

/** Serialises calls per key with a minimum gap (simple, per server instance). */
export function createThrottle(minIntervalMs: number) {
  let chain: Promise<unknown> = Promise.resolve();
  let last = 0;
  return function throttle<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      const wait = last + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      return fn();
    });
    chain = run.catch(() => undefined);
    return run;
  };
}

export async function getJson<T = unknown>(
  provider: string,
  url: string,
  ctx: ProviderContext,
  options?: GetOptions | number,
): Promise<T> {
  const text = await getText(provider, url, ctx, options);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError(provider, 'invalid JSON');
  }
}

/** "06-Nov-2026" or "06-11-2026" → "2026-11-06". */
export function parseIndianDate(s: string): string | null {
  const months: Record<string, string> = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  };
  const m = /^(\d{2})-([A-Za-z]{3}|\d{2})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mm = /^\d+$/.test(m[2]!) ? m[2]! : months[m[2]!.toLowerCase()];
  return mm ? `${m[3]}-${mm}-${m[1]}` : null;
}

/** End of an Indian trading/NAV day, as an ISO instant (15:30 IST = 10:00 UTC). */
export const istCloseIso = (date: string) => `${date}T10:00:00.000Z`;

export const isDecimal = (s: string | undefined | null): s is string =>
  typeof s === 'string' && /^\d+(\.\d+)?$/.test(s.trim()) && Number(s) > 0;
