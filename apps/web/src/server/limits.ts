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

// ---------- imports ----------

/** File previews per user per day (each one reads the whole ledger and parses a file). */
export const IMPORT_PREVIEWS_PER_DAY = 30;
/** Imported rows per user per day. Every row is a Firestore write on a shared free quota. */
export const IMPORT_ROWS_PER_DAY = 2000;
/**
 * Writes one import may make (rows, plus two per new holding, plus bookkeeping). Keeps a confirm
 * comfortably inside a single Firestore transaction.
 */
export const IMPORT_WRITE_BUDGET = 480;

export interface ImportPreviewCounters {
  importPreviewDay: string;
  importPreviewsToday: number;
}

export function nextImportPreviewCounters(
  meta: Partial<ImportPreviewCounters> | undefined,
  today: string,
): ImportPreviewCounters {
  const used = meta?.importPreviewDay === today ? Number(meta.importPreviewsToday ?? 0) : 0;
  if (used >= IMPORT_PREVIEWS_PER_DAY) {
    throw new HttpError(
      429,
      'IMPORT_DAILY_LIMIT',
      `Daily limit of ${IMPORT_PREVIEWS_PER_DAY} file uploads reached. Try again tomorrow.`,
      { retryAfter: 3600 },
    );
  }
  return { importPreviewDay: today, importPreviewsToday: used + 1 };
}

export interface ImportRowCounters {
  importRowDay: string;
  importRowsToday: number;
}

export function nextImportRowCounters(
  meta: Partial<ImportRowCounters> | undefined,
  today: string,
  rows: number,
): ImportRowCounters {
  const used = meta?.importRowDay === today ? Number(meta.importRowsToday ?? 0) : 0;
  if (used + rows > IMPORT_ROWS_PER_DAY) {
    throw new HttpError(
      429,
      'IMPORT_ROW_LIMIT',
      `You can import ${IMPORT_ROWS_PER_DAY} rows a day (${IMPORT_ROWS_PER_DAY - used} left today).`,
      { retryAfter: 3600, remaining: Math.max(0, IMPORT_ROWS_PER_DAY - used) },
    );
  }
  return { importRowDay: today, importRowsToday: used + rows };
}

/** Writes an import of `rows` new rows and `newInstruments` new holdings will make. */
export const importWrites = (rows: number, newInstruments: number) =>
  rows + 2 * newInstruments + 10;
