import { HttpError } from './http';

/**
 * Per-user limits on ledger edits (SEC-002). Every edit re-reads the user's whole ledger inside a
 * transaction, so unlimited edits from one free account could exhaust a self-hoster's Firestore
 * free-tier quota for everyone. Counters live in userMeta and are checked inside the same
 * transaction as the write, so concurrent requests cannot slip past them.
 */
export const WRITE_LIMIT_PER_MINUTE = 30;
export const WRITE_LIMIT_PER_DAY = 500;
/** Ceilings that keep book/current far below Firestore's 1 MiB document limit. */
export const MAX_ACTIVE_TRANSACTIONS = 5000;
export const MAX_INSTRUMENTS = 500;
/** Manual price history kept per instrument (newest last). */
export const MANUAL_PRICE_HISTORY = 50;

export interface WriteCounters {
  writeMinute: number;
  writesThisMinute: number;
  writeDay: string;
  writesToday: number;
}

/** Throws 429 when over a limit; otherwise returns the counters to store with this write. */
export function nextWriteCounters(
  meta: Partial<WriteCounters> | undefined,
  now: Date,
  today: string,
): WriteCounters {
  const minute = Math.floor(now.getTime() / 60_000);
  const inMinute = meta?.writeMinute === minute ? Number(meta.writesThisMinute ?? 0) : 0;
  const inDay = meta?.writeDay === today ? Number(meta.writesToday ?? 0) : 0;
  if (inMinute >= WRITE_LIMIT_PER_MINUTE) {
    throw new HttpError(
      429,
      'WRITE_RATE_LIMIT',
      'Too many changes at once. Try again in a minute.',
      {
        retryAfter: 60 - now.getUTCSeconds(),
      },
    );
  }
  if (inDay >= WRITE_LIMIT_PER_DAY) {
    throw new HttpError(
      429,
      'WRITE_DAILY_LIMIT',
      `Daily limit of ${WRITE_LIMIT_PER_DAY} changes reached. Try again tomorrow.`,
      { retryAfter: 3600 },
    );
  }
  return {
    writeMinute: minute,
    writesThisMinute: inMinute + 1,
    writeDay: today,
    writesToday: inDay + 1,
  };
}

/** Throws 422 when a change would grow the ledger past the ceilings. */
export function assertLedgerSize(activeTransactions: number, instruments: number) {
  if (activeTransactions > MAX_ACTIVE_TRANSACTIONS) {
    throw new HttpError(
      422,
      'LIMIT_REACHED',
      `A portfolio can hold at most ${MAX_ACTIVE_TRANSACTIONS} transactions`,
    );
  }
  if (instruments > MAX_INSTRUMENTS) {
    throw new HttpError(
      422,
      'LIMIT_REACHED',
      `A portfolio can hold at most ${MAX_INSTRUMENTS} holdings`,
    );
  }
}

/** Append to a manual price history, keeping only the newest entries (SEC-004). */
export function appendHistory<T>(
  history: T[] | undefined,
  entry: T,
  max = MANUAL_PRICE_HISTORY,
): T[] {
  return [...(history ?? []), entry].slice(-max);
}
