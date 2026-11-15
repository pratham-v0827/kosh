import { daysBetween, toEpochDay } from './dates';
import Decimal from './decimal';
import type { HoldingView, InstrumentRow } from './book';
import { MIN_XIRR_DAYS } from './book';
import type { AssetClass } from './ledger';
import { type CashFlow, xirr } from './xirr';

/**
 * Portfolio analytics for the dashboard: combined returns, allocation, insights, benchmark
 * comparison and chart ranges. Pure functions over the stored book; no I/O.
 */

const ZERO = new Decimal(0);
const isOpen = (h: HoldingView) => new Decimal(h.qty).gt(0);

// ---------- combined XIRR ----------

export interface XirrSummary {
  /** Annualised money-weighted return, or null when it cannot be computed. */
  rate: number | null;
  reason: 'OK' | 'NO_DATA' | 'TOO_SHORT' | 'NOT_COMPUTABLE';
  /** Some included purchases are dated only by their first purchase. */
  approximate: boolean;
  /** Positions in the calculation. */
  included: number;
  /** Positions left out, and why. */
  excluded: { noDates: number; unpriced: number };
}

/**
 * XIRR of a set of positions as if they were one investment: all their dated cash flows, plus
 * the current value today. Positions without purchase dates (holdings statements) and open
 * positions without a price are left out and counted, never guessed.
 *
 * `currency: 'native'` uses each position's own currency (all must share it), for comparing US
 * holdings with a US index in dollars.
 */
export function combinedXirr(
  list: readonly HoldingView[],
  asOf: string,
  options: { currency?: 'INR' | 'native' } = {},
): XirrSummary {
  const native = options.currency === 'native';
  const flows = new Map<string, number>();
  let terminal = ZERO;
  let included = 0;
  let approximate = false;
  const excluded = { noDates: 0, unpriced: 0 };

  for (const h of list) {
    const open = isOpen(h);
    if (!open && h.cashflows.length === 0) continue;
    if (h.dateQuality === 'unknown') {
      excluded.noDates++;
      continue;
    }
    if (open && (h.value === null || h.price === null)) {
      excluded.unpriced++;
      continue;
    }
    const own = native && h.currency !== 'INR' ? (h.cashflowsCcy ?? []) : h.cashflows;
    for (const f of own) flows.set(f.d, (flows.get(f.d) ?? 0) + f.a);
    if (open) {
      terminal = terminal.plus(
        native ? new Decimal(h.qty).times(h.price!.price) : new Decimal(h.value!),
      );
    }
    if (h.dateQuality === 'approximate') approximate = true;
    included++;
  }

  const result = (reason: XirrSummary['reason'], rate: number | null = null): XirrSummary => ({
    rate,
    reason,
    approximate,
    included,
    excluded,
  });
  if (included === 0 || flows.size === 0) return result('NO_DATA');
  const first = [...flows.keys()].sort((a, b) => toEpochDay(a) - toEpochDay(b))[0]!;
  if (daysBetween(first, asOf) < MIN_XIRR_DAYS) return result('TOO_SHORT');

  const cash: CashFlow[] = [...flows].map(([date, amount]) => ({ date, amount }));
  if (!terminal.isZero()) cash.push({ date: asOf, amount: terminal.toNumber() });
  const r = xirr(cash);
  return r.ok ? result('OK', r.rate) : result('NOT_COMPUTABLE');
}

/** XIRR of the whole portfolio. */
export const portfolioXirr = (holdings: Record<string, HoldingView>, asOf: string): XirrSummary =>
  combinedXirr(Object.values(holdings), asOf);

/** A consolidated row with the XIRR of all its accounts together. */
export interface ConsolidatedRow extends InstrumentRow {
  xirr: XirrSummary;
}

/** Add the combined XIRR (across accounts) to each consolidated row. */
export function withCombinedXirr(
  rows: readonly InstrumentRow[],
  holdings: Record<string, HoldingView>,
  asOf: string,
): ConsolidatedRow[] {
  return rows.map((r) => ({
    ...r,
    xirr: combinedXirr(
      r.positionKeys.flatMap((k) => (holdings[k] ? [holdings[k]] : [])),
      asOf,
    ),
  }));
}

// ---------- allocation ----------

export type AllocationBy = 'assetClass' | 'account' | 'geography' | 'instrumentType' | 'marketCap';

export type Geography = 'IN' | 'US' | 'GLOBAL';
export type InstrumentKind = 'STOCK' | 'ETF' | 'MUTUAL_FUND' | 'CRYPTO' | 'UNLISTED';
export type MarketCap = 'LARGE' | 'MID' | 'SMALL' | 'UNCLASSIFIED';

export const geographyOf = (assetClass: AssetClass): Geography =>
  assetClass === 'US_EQUITY' ? 'US' : assetClass === 'CRYPTO' ? 'GLOBAL' : 'IN';

export function kindOf(h: Pick<HoldingView, 'assetClass' | 'instrumentType'>): InstrumentKind {
  switch (h.assetClass) {
    case 'IN_EQUITY':
    case 'US_EQUITY':
      return h.instrumentType === 'ETF' ? 'ETF' : 'STOCK';
    case 'MUTUAL_FUND':
      return 'MUTUAL_FUND';
    case 'CRYPTO':
      return 'CRYPTO';
    default:
      return 'UNLISTED';
  }
}

export interface AllocationSlice {
  key: string;
  /** Value of the priced holdings in this slice (INR). */
  value: string;
  /** Open cost of every holding in this slice (INR). */
  invested: string;
  /** Share of the total priced value, 0…1; null when nothing in the portfolio is priced. */
  valueWeight: number | null;
  /** Share of the total open cost, 0…1. */
  costWeight: number;
  count: number;
  /** Holdings in this slice without a price (counted in `invested`, not in `value`). */
  unpriced: number;
}

export interface AllocationOptions {
  /** Market-cap category of an Indian stock, e.g. from AMFI's list. */
  marketCap?: (h: HoldingView) => MarketCap | null;
}

/**
 * Split open holdings into slices. Market cap applies to Indian shares only (other holdings are
 * left out of that view); every other grouping covers the whole portfolio.
 */
export function allocation(
  holdings: Record<string, HoldingView>,
  by: AllocationBy,
  options: AllocationOptions = {},
): AllocationSlice[] {
  const keyOf = (h: HoldingView): string | null => {
    switch (by) {
      case 'assetClass':
        return h.assetClass;
      case 'account':
        return h.accountId;
      case 'geography':
        return geographyOf(h.assetClass);
      case 'instrumentType':
        return kindOf(h);
      case 'marketCap':
        if (h.assetClass !== 'IN_EQUITY' || kindOf(h) !== 'STOCK') return null;
        return options.marketCap?.(h) ?? 'UNCLASSIFIED';
    }
  };

  const slices = new Map<
    string,
    { value: Decimal; invested: Decimal; count: number; unpriced: number }
  >();
  for (const h of Object.values(holdings)) {
    if (!isOpen(h)) continue;
    const key = keyOf(h);
    if (key === null) continue;
    const s = slices.get(key) ?? { value: ZERO, invested: ZERO, count: 0, unpriced: 0 };
    s.invested = s.invested.plus(h.openCost);
    if (h.value === null) s.unpriced++;
    else s.value = s.value.plus(h.value);
    s.count++;
    slices.set(key, s);
  }

  const totalValue = [...slices.values()].reduce((t, s) => t.plus(s.value), ZERO);
  const totalCost = [...slices.values()].reduce((t, s) => t.plus(s.invested), ZERO);
  return [...slices]
    .map(([key, s]) => ({
      key,
      value: s.value.toDecimalPlaces(2).toString(),
      invested: s.invested.toDecimalPlaces(2).toString(),
      valueWeight: totalValue.isZero() ? null : s.value.div(totalValue).toNumber(),
      costWeight: totalCost.isZero() ? 0 : s.invested.div(totalCost).toNumber(),
      count: s.count,
      unpriced: s.unpriced,
    }))
    .sort((a, b) => Number(b.value) - Number(a.value) || Number(b.invested) - Number(a.invested));
}

// ---------- insights ----------

export interface HoldingPeriodSplit {
  /** Value (INR) of units held for at least a year. */
  longTerm: string;
  /** Value of units held for less than a year. */
  shortTerm: string;
  /** Value of units whose purchase date is not known (holdings statements). */
  unknown: string;
}

export interface Insights {
  /** Largest rises today, by percentage. */
  gainers: InstrumentRow[];
  /** Largest falls today, by percentage. */
  losers: InstrumentRow[];
  /** Holdings above the concentration threshold, largest first. */
  concentrated: InstrumentRow[];
  threshold: number;
  holdingPeriod: HoldingPeriodSplit;
}

/** One year, the line most investors watch for gains (informational only, not tax advice). */
export const LONG_TERM_DAYS = 365;

/**
 * Descriptive insights: today's biggest movers, holdings that are a large share of the portfolio,
 * and how much of the portfolio has been held for more than a year. Never a recommendation.
 */
export function insights(
  rows: readonly InstrumentRow[],
  holdings: Record<string, HoldingView>,
  asOf: string,
  options: { threshold?: number; top?: number } = {},
): Insights {
  const threshold = options.threshold ?? 0.1;
  const top = options.top ?? 3;
  const moving = rows.filter((r) => r.dayChangePct !== null && r.dayChangePct !== 0);
  const byMove = [...moving].sort((a, b) => b.dayChangePct! - a.dayChangePct!);

  let longTerm = ZERO;
  let shortTerm = ZERO;
  let unknown = ZERO;
  for (const h of Object.values(holdings)) {
    if (!isOpen(h) || h.value === null) continue;
    const qty = new Decimal(h.qty);
    const value = new Decimal(h.value);
    if (h.dateQuality === 'unknown') {
      unknown = unknown.plus(value);
      continue;
    }
    for (const lot of h.lots) {
      const share = value.times(lot.qty).div(qty);
      if (daysBetween(lot.date, asOf) >= LONG_TERM_DAYS) longTerm = longTerm.plus(share);
      else shortTerm = shortTerm.plus(share);
    }
  }

  return {
    gainers: byMove.filter((r) => r.dayChangePct! > 0).slice(0, top),
    losers: byMove
      .filter((r) => r.dayChangePct! < 0)
      .reverse()
      .slice(0, top),
    concentrated: rows
      .filter((r) => r.weight !== null && r.weight > threshold)
      .sort((a, b) => b.weight! - a.weight!),
    threshold,
    holdingPeriod: {
      longTerm: longTerm.toDecimalPlaces(2).toString(),
      shortTerm: shortTerm.toDecimalPlaces(2).toString(),
      unknown: unknown.toDecimalPlaces(2).toString(),
    },
  };
}

// ---------- benchmark ----------

export interface IndexPoint {
  /** YYYY-MM-DD */
  date: string;
  close: number;
}

export type BenchmarkResult =
  | { ok: true; rate: number }
  | { ok: false; reason: 'NO_FLOWS' | 'NO_INDEX_DATA' | 'NOT_COMPUTABLE' };

/** Close on the date, or the latest one before it. `points` sorted by date. */
function closeOn(points: readonly IndexPoint[], date: string): number | null {
  let lo = 0;
  let hi = points.length - 1;
  let found: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.date <= date) {
      found = points[mid]!.close;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * "What if every purchase and sale had been made in the index instead?" (a public-market
 * equivalent). Each cash flow buys or sells index units at that day's close; the units left are
 * valued at the latest close; the XIRR of those flows is the benchmark's return. Compare it with
 * the portfolio XIRR of the same holdings.
 *
 * Flows are the investor's view (purchases negative) and must be in the index's currency.
 */
export function benchmarkXirr(
  flows: readonly { d: string; a: number }[],
  index: readonly IndexPoint[],
  asOf: string,
): BenchmarkResult {
  if (flows.length === 0) return { ok: false, reason: 'NO_FLOWS' };
  const last = closeOn(index, asOf);
  if (last === null) return { ok: false, reason: 'NO_INDEX_DATA' };
  let units = 0;
  for (const f of flows) {
    const close = closeOn(index, f.d);
    if (close === null || close <= 0) return { ok: false, reason: 'NO_INDEX_DATA' };
    units += -f.a / close;
  }
  const cash: CashFlow[] = flows.map((f) => ({ date: f.d, amount: f.a }));
  cash.push({ date: asOf, amount: units * last });
  const r = xirr(cash);
  return r.ok ? { ok: true, rate: r.rate } : { ok: false, reason: 'NOT_COMPUTABLE' };
}

/** All dated flows of these positions, merged by day, in INR or in their own currency. */
export function datedFlows(
  list: readonly HoldingView[],
  currency: 'INR' | 'native' = 'INR',
): { d: string; a: number }[] {
  const flows = new Map<string, number>();
  for (const h of list) {
    if (h.dateQuality === 'unknown') continue;
    const own =
      currency === 'native' && h.currency !== 'INR' ? (h.cashflowsCcy ?? []) : h.cashflows;
    for (const f of own) flows.set(f.d, (flows.get(f.d) ?? 0) + f.a);
  }
  return [...flows].map(([d, a]) => ({ d, a })).sort((x, y) => toEpochDay(x.d) - toEpochDay(y.d));
}

/** The indices Kosh compares against. Prices come from Yahoo (unofficial), cached server-side. */
export const BENCHMARKS = {
  NIFTY50: { symbol: '^NSEI', currency: 'INR', market: 'IN' },
  SENSEX: { symbol: '^BSESN', currency: 'INR', market: 'IN' },
  SP500: { symbol: '^GSPC', currency: 'USD', market: 'US' },
} as const satisfies Record<
  string,
  { symbol: string; currency: 'INR' | 'USD'; market: Exclude<Geography, 'GLOBAL'> }
>;
export type BenchmarkId = keyof typeof BENCHMARKS;
export const BENCHMARK_IDS = Object.keys(BENCHMARKS) as BenchmarkId[];

export interface BenchmarkGroup {
  market: 'IN' | 'US';
  /** Currency of both figures: rupees for India, dollars for the US. */
  currency: 'INR' | 'USD';
  /** XIRR of this market's holdings (the same positions the index figures use). */
  portfolio: XirrSummary;
  benchmarks: { id: BenchmarkId; result: BenchmarkResult }[];
}

/**
 * Each market's holdings against its own index, in its own currency: Indian holdings against the
 * Nifty 50 and Sensex in rupees, US holdings against the S&P 500 in dollars (so currency moves
 * do not count as out- or under-performance). Crypto has no index here and is left out. Both
 * sides use the same positions: undated and unpriced ones are left out of both.
 */
export function benchmarkComparison(
  holdings: Record<string, HoldingView>,
  asOf: string,
  indices: Partial<Record<BenchmarkId, readonly IndexPoint[]>>,
): BenchmarkGroup[] {
  const groups: BenchmarkGroup[] = [];
  for (const market of ['IN', 'US'] as const) {
    const list = Object.values(holdings).filter(
      (h) => geographyOf(h.assetClass) === market && (isOpen(h) || h.cashflows.length > 0),
    );
    if (list.length === 0) continue;
    const currency = market === 'US' ? 'native' : 'INR';
    const used = list.filter(
      (h) => h.dateQuality !== 'unknown' && !(isOpen(h) && (h.value === null || h.price === null)),
    );
    const flows = datedFlows(used, currency);
    groups.push({
      market,
      currency: market === 'US' ? 'USD' : 'INR',
      portfolio: combinedXirr(list, asOf, { currency }),
      benchmarks: BENCHMARK_IDS.filter((id) => BENCHMARKS[id].market === market).map((id) => ({
        id,
        result: benchmarkXirr(flows, indices[id] ?? [], asOf),
      })),
    });
  }
  return groups;
}

// ---------- value over time ----------

export type ChartRange = '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL';

export const RANGE_DAYS: Record<Exclude<ChartRange, 'ALL'>, number> = {
  '1W': 7,
  '1M': 30,
  '3M': 91,
  '6M': 182,
  '1Y': 365,
};

export interface SeriesPoint {
  /** YYYY-MM-DD */
  date: string;
  /** Portfolio value that day (INR). */
  value: number;
  /** Open cost that day (INR). */
  invested: number;
}

export interface RangeView {
  points: SeriesPoint[];
  /** Change in value minus change in invested money: the gain over the range, not new deposits. */
  gain: number | null;
  /** `gain` as a share of the value at the start; null when the start is zero. */
  gainPct: number | null;
}

/**
 * Points for a chart range. The last point before the range is kept as its starting point, so a
 * range never starts with a gap. Points must be sorted by date.
 */
export function seriesRange(
  points: readonly SeriesPoint[],
  range: ChartRange,
  asOf: string,
): RangeView {
  let view: SeriesPoint[];
  if (range === 'ALL') view = [...points];
  else {
    const start = toEpochDay(asOf) - RANGE_DAYS[range];
    const from = points.findIndex((p) => toEpochDay(p.date) >= start);
    view = from === -1 ? points.slice(-1) : points.slice(Math.max(0, from - 1));
  }
  if (view.length < 2) return { points: view, gain: null, gainPct: null };
  const a = view[0]!;
  const b = view[view.length - 1]!;
  const gain = b.value - a.value - (b.invested - a.invested);
  return { points: view, gain, gainPct: a.value === 0 ? null : gain / a.value };
}
