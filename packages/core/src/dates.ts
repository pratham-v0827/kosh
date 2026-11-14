const DAY_MS = 86_400_000;

/** A calendar date: `Date` (its UTC calendar day is used) or an ISO `YYYY-MM-DD` string. */
export type DateInput = Date | string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whole days since 1970-01-01 for a calendar date, ignoring time-of-day and timezone. */
export function toEpochDay(input: DateInput): number {
  if (typeof input === 'string') {
    const m = ISO_DATE.exec(input);
    if (!m) throw new RangeError(`Expected YYYY-MM-DD, got "${input}"`);
    const [, y, mo, d] = m;
    const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
    const check = new Date(ms);
    // BUG-013: all three parts must survive the round trip. Checking the day alone let month 13+
    // (which rolls into the next year) and day 0 through.
    if (
      check.getUTCFullYear() !== Number(y) ||
      check.getUTCMonth() !== Number(mo) - 1 ||
      check.getUTCDate() !== Number(d)
    ) {
      throw new RangeError(`Invalid calendar date "${input}"`);
    }
    return ms / DAY_MS;
  }
  if (Number.isNaN(input.getTime())) throw new RangeError('Invalid Date');
  return Math.floor(
    Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()) / DAY_MS,
  );
}

/** Days between two calendar dates (b − a). */
export function daysBetween(a: DateInput, b: DateInput): number {
  return toEpochDay(b) - toEpochDay(a);
}

/** The calendar date in India (Asia/Kolkata, UTC+05:30, no DST) as YYYY-MM-DD. */
export function indiaDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}
