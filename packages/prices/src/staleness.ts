import type { AssetClass } from '@kosh/core';

/**
 * When is a price "stale"? Weekends are skipped; exchange holidays are not modelled yet, so a
 * price can show as stale on the day after a market holiday (documented limitation).
 */
export interface StalenessRules {
  /** Equities: stale once more than this many weekdays have passed since the price date. */
  equityWeekdays: number;
  /** Mutual funds (NAV is published in the evening): weekdays. */
  mfWeekdays: number;
  cryptoMinutes: number;
  /** Manual / unlisted prices: calendar days. */
  manualDays: number;
  /** FX reference rates: calendar days. */
  fxDays: number;
}

export const DEFAULT_STALENESS: StalenessRules = {
  equityWeekdays: 1,
  mfWeekdays: 2,
  cryptoMinutes: 60,
  manualDays: 30,
  fxDays: 4,
};

const DAY = 86_400_000;
const istDate = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);

/** Weekdays strictly after `from` up to and including `to` (both YYYY-MM-DD). */
export function weekdaysBetween(from: string, to: string): number {
  let n = 0;
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`) + DAY; t <= end; t += DAY) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

export type Freshness = 'fresh' | 'stale';

export function freshness(
  assetClass: AssetClass,
  source: string,
  asOf: string,
  now: Date,
  rules: StalenessRules = DEFAULT_STALENESS,
): Freshness {
  const at = new Date(asOf.length === 10 ? `${asOf}T10:00:00Z` : asOf);
  if (Number.isNaN(at.getTime())) return 'stale';
  if (source === 'manual') {
    return now.getTime() - at.getTime() > rules.manualDays * DAY ? 'stale' : 'fresh';
  }
  switch (assetClass) {
    case 'CRYPTO':
      return now.getTime() - at.getTime() > rules.cryptoMinutes * 60_000 ? 'stale' : 'fresh';
    case 'MUTUAL_FUND':
      return weekdaysBetween(istDate(at), istDate(now)) > rules.mfWeekdays ? 'stale' : 'fresh';
    case 'US_EQUITY':
      // US closes after midnight IST; compare in UTC calendar days.
      return weekdaysBetween(at.toISOString().slice(0, 10), now.toISOString().slice(0, 10)) >
        rules.equityWeekdays
        ? 'stale'
        : 'fresh';
    default:
      return weekdaysBetween(istDate(at), istDate(now)) > rules.equityWeekdays ? 'stale' : 'fresh';
  }
}

export function fxFreshness(
  asOf: string,
  now: Date,
  rules: StalenessRules = DEFAULT_STALENESS,
): Freshness {
  return now.getTime() - Date.parse(`${asOf}T16:00:00Z`) > rules.fxDays * DAY ? 'stale' : 'fresh';
}

/** Human age for badges: "5 min", "3 h", "2 d". */
export function ageLabel(asOf: string, now: Date): string {
  const ms = Math.max(
    0,
    now.getTime() - Date.parse(asOf.length === 10 ? `${asOf}T10:00:00Z` : asOf),
  );
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < DAY) return `${Math.round(ms / 3_600_000)} h`;
  return `${Math.round(ms / DAY)} d`;
}
