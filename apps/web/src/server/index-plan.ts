import { daysBetween, type IndexPoint } from '@kosh/core';

/** What is stored on `indices/{id}` about its history. */
export interface IndexDocState {
  /** IST day of the last successful check. */
  checkedDay?: string;
  /** Latest stored close (YYYY-MM-DD). */
  to?: string;
  /** Epoch ms before which a failed fetch is not retried. */
  retryAfter?: number;
}

/** After a failure, wait this long before asking Yahoo again. */
export const INDEX_RETRY_MS = 60 * 60 * 1000;

/** Whether to fetch an index's history today, and how far back. */
export function planIndexFetch(
  doc: IndexDocState | undefined,
  today: string,
  nowMs: number,
): 'skip' | '1mo' | '1y' | '10y' {
  if (doc?.retryAfter && doc.retryAfter > nowMs) return 'skip';
  if (doc?.checkedDay === today) return 'skip';
  if (!doc?.to) return '10y';
  const gap = daysBetween(doc.to, today);
  if (gap <= 25) return '1mo';
  if (gap <= 360) return '1y';
  return '10y';
}

/** Closes grouped by year, for `indices/{id}/years/{yyyy}` = { d: { date: close } }. */
export function closesByYear(closes: readonly IndexPoint[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const c of closes) {
    const year = c.date.slice(0, 4);
    const days = out.get(year) ?? {};
    days[c.date] = c.close;
    out.set(year, days);
  }
  return out;
}
