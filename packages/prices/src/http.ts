import type { ProviderContext } from './types';

/** Identifies Kosh honestly. Providers must be accessed politely: no spoofing, no bot-check evasion. */
export const USER_AGENT = 'Kosh/0.1 (open-source portfolio tracker; price lookups by symbol only)';

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status?: number,
  ) {
    super(`${provider}: ${message}`);
  }
}

export async function getText(
  provider: string,
  url: string,
  ctx: ProviderContext,
  timeoutMs = 15_000,
): Promise<string> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await ctx.fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' }, signal });
  } catch (e) {
    throw new ProviderError(provider, `request failed (${(e as Error).name})`);
  }
  if (!res.ok) throw new ProviderError(provider, `HTTP ${res.status}`, res.status);
  return res.text();
}

export async function getJson<T>(
  provider: string,
  url: string,
  ctx: ProviderContext,
  timeoutMs?: number,
): Promise<T> {
  const text = await getText(provider, url, ctx, timeoutMs);
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
