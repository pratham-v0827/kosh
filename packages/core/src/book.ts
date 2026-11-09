import Decimal from 'decimal.js';
import { daysBetween } from './dates';
import {
  type AssetClass,
  ASSET_CLASSES,
  type Currency,
  dayChange,
  type Position,
  positionXirr,
  valuePosition,
} from './ledger';

/**
 * Compose the per-user read model ("book") from positions + instrument metadata + prices + FX.
 * Pure: the server persists the result to users/{uid}/book/current (and snapshots it on
 * refresh); the UI only reads it. Firestore cannot store nested arrays, so cash flows become
 * `{ d, a }` objects here.
 */

export interface InstrumentMeta {
  id: string;
  name: string;
  assetClass: AssetClass;
  symbol: string | null;
  /** Quote currency. Default: USD for US equities, INR otherwise. */
  currency?: Currency;
  /** Indian stocks: listing exchange (default NSE). */
  exchange?: 'NSE' | 'BSE';
}

export type PriceStatus = 'fresh' | 'stale';

export interface PriceInfo {
  price: string;
  prevClose?: string;
  currency: Currency;
  /** ISO date or instant the price is valid for. */
  asOf: string;
  /** "manual" or a provider id. */
  source: string;
  status: PriceStatus;
}

export interface FxInfo {
  /** INR per USD. */
  rate: string;
  prevRate?: string;
  asOf: string;
  source: string;
  status: PriceStatus;
}

export type XirrNote = 'NO_PRICE' | 'NO_FX' | 'TOO_SHORT' | 'NOT_COMPUTABLE';

export interface HoldingView extends Omit<Position, 'cashflows'> {
  name: string;
  assetClass: AssetClass;
  symbol: string | null;
  cashflows: { d: string; a: number }[];
  price: PriceInfo | null;
  /** fresh/stale from the price; "missing" when there is none (or no FX for a USD price). */
  priceStatus: PriceStatus | 'missing';
  /** FX applied to the price (null for INR prices). */
  fxRate: string | null;
  value: string | null;
  unrealised: string | null;
  unrealisedPct: number | null;
  stockEffect: string | null;
  fxEffect: string | null;
  dayChange: string | null;
  dayChangePct: number | null;
  xirr: number | null;
  xirrNote: XirrNote | null;
}

export interface ClassTotals {
  invested: string;
  value: string;
  count: number;
}

export interface BookTotals {
  /** Open cost of everything still held. */
  invested: string;
  /** Value of holdings that have a price. */
  value: string;
  /** Open cost of the priced holdings only (denominator for unrealised %). */
  pricedInvested: string;
  unrealised: string;
  unrealisedPct: number | null;
  realised: string;
  dividends: string;
  /** Sum of day changes where a previous close is known. */
  dayChange: string;
  dayChangePct: number | null;
  /** Holdings that contributed a day change (have a previous price). 0 → show "—". */
  dayChangeCount: number;
  holdingsCount: number;
  unpricedCount: number;
  staleCount: number;
  byAssetClass: Record<AssetClass, ClassTotals>;
}

export interface ComposedBook {
  holdings: Record<string, HoldingView>;
  totals: BookTotals;
  fx: FxInfo | null;
}

/** XIRR over very short holding periods is noise; the UI explains why it is hidden. */
export const MIN_XIRR_DAYS = 30;

const ZERO = new Decimal(0);

export const defaultCurrency = (c: AssetClass): Currency => (c === 'US_EQUITY' ? 'USD' : 'INR');

export function composeBook(
  positions: Record<string, Position>,
  instruments: Record<string, InstrumentMeta>,
  prices: Record<string, PriceInfo>,
  asOf: string,
  fx: FxInfo | null = null,
): ComposedBook {
  const holdings: Record<string, HoldingView> = {};
  let invested = ZERO;
  let value = ZERO;
  let pricedInvested = ZERO;
  let realised = ZERO;
  let dividends = ZERO;
  let day = ZERO;
  let dayBase = ZERO;
  let dayCount = 0;
  let holdingsCount = 0;
  let unpricedCount = 0;
  let staleCount = 0;
  const byClass = Object.fromEntries(
    ASSET_CLASSES.map((c) => [c, { invested: ZERO, value: ZERO, count: 0 }]),
  ) as Record<AssetClass, { invested: Decimal; value: Decimal; count: number }>;

  for (const [key, p] of Object.entries(positions)) {
    const meta = instruments[p.instrumentId] ?? {
      id: p.instrumentId,
      name: p.instrumentId,
      assetClass: 'UNLISTED' as const,
      symbol: null,
    };
    const open = new Decimal(p.qty).gt(0);
    const price = prices[p.instrumentId] ?? null;
    const needsFx = price?.currency === 'USD';
    const usable = price && (!needsFx || fx);
    const fxUsed =
      needsFx && fx
        ? { rate: fx.rate, ...(fx.prevRate ? { prevRate: fx.prevRate } : {}) }
        : { rate: '1' };

    let val: ReturnType<typeof valuePosition> | null = null;
    let dc: ReturnType<typeof dayChange> = null;
    let x: number | null = null;
    let xirrNote: XirrNote | null = null;
    if (open && usable) {
      val = valuePosition(p, price.price, fxUsed.rate);
      dc = dayChange(p, price, fxUsed);
      if (p.firstAcquired && daysBetween(p.firstAcquired, asOf) < MIN_XIRR_DAYS) {
        xirrNote = 'TOO_SHORT';
      } else {
        const r = positionXirr(p, val.value, asOf);
        if (r.ok) x = r.rate;
        else xirrNote = 'NOT_COMPUTABLE';
      }
    } else if (open) {
      xirrNote = price ? 'NO_FX' : 'NO_PRICE';
    }
    const status: HoldingView['priceStatus'] = usable
      ? price.status === 'stale' || (needsFx && fx?.status === 'stale')
        ? 'stale'
        : 'fresh'
      : 'missing';

    holdings[key] = {
      ...p,
      name: meta.name,
      assetClass: meta.assetClass,
      symbol: meta.symbol,
      cashflows: p.cashflows.map(([d, a]) => ({ d, a })),
      price,
      priceStatus: status,
      fxRate: needsFx && fx ? fx.rate : null,
      value: val?.value ?? null,
      unrealised: val?.unrealised ?? null,
      unrealisedPct: val?.unrealisedPct ?? null,
      stockEffect: val?.stockEffect ?? null,
      fxEffect: val?.fxEffect ?? null,
      dayChange: dc?.change ?? null,
      dayChangePct: dc?.pct ?? null,
      xirr: x,
      xirrNote,
    };

    realised = realised.plus(p.realised);
    dividends = dividends.plus(p.dividends);
    if (!open) continue;

    holdingsCount++;
    invested = invested.plus(p.openCost);
    const c = byClass[meta.assetClass];
    c.count++;
    c.invested = c.invested.plus(p.openCost);
    if (val) {
      value = value.plus(val.value);
      pricedInvested = pricedInvested.plus(p.openCost);
      c.value = c.value.plus(val.value);
      if (status === 'stale') staleCount++;
      if (dc) {
        day = day.plus(dc.change);
        dayCount++;
        dayBase = dayBase.plus(new Decimal(val.value).minus(dc.change));
      }
    } else {
      unpricedCount++;
    }
  }

  const unrealised = value.minus(pricedInvested);
  return {
    holdings,
    fx,
    totals: {
      invested: invested.toDecimalPlaces(2).toString(),
      value: value.toDecimalPlaces(2).toString(),
      pricedInvested: pricedInvested.toDecimalPlaces(2).toString(),
      unrealised: unrealised.toDecimalPlaces(2).toString(),
      unrealisedPct: pricedInvested.isZero() ? null : unrealised.div(pricedInvested).toNumber(),
      realised: realised.toDecimalPlaces(2).toString(),
      dividends: dividends.toDecimalPlaces(2).toString(),
      dayChange: day.toDecimalPlaces(2).toString(),
      dayChangePct: dayBase.isZero() ? null : day.div(dayBase).toNumber(),
      dayChangeCount: dayCount,
      holdingsCount,
      unpricedCount,
      staleCount,
      byAssetClass: Object.fromEntries(
        ASSET_CLASSES.map((cls) => [
          cls,
          {
            invested: byClass[cls].invested.toDecimalPlaces(2).toString(),
            value: byClass[cls].value.toDecimalPlaces(2).toString(),
            count: byClass[cls].count,
          },
        ]),
      ) as Record<AssetClass, ClassTotals>,
    },
  };
}

/** One row per instrument, aggregating the same holding across accounts (e.g. two brokers). */
export interface InstrumentRow {
  instrumentId: string;
  name: string;
  assetClass: AssetClass;
  symbol: string | null;
  currency: Currency;
  qty: string;
  /** INR average cost. */
  avgCost: string;
  /** Native-currency average cost (same as avgCost for INR). */
  avgCostCcy: string;
  invested: string;
  price: PriceInfo | null;
  priceStatus: HoldingView['priceStatus'];
  fxRate: string | null;
  value: string | null;
  unrealised: string | null;
  unrealisedPct: number | null;
  stockEffect: string | null;
  fxEffect: string | null;
  dayChange: string | null;
  dayChangePct: number | null;
  realised: string;
  /** Share of total priced value, 0..1; null when unpriced. */
  weight: number | null;
  accounts: { accountId: string; qty: string }[];
  positionKeys: string[];
}

const sumOrNull = (list: HoldingView[], f: (h: HoldingView) => string | null) => {
  const open = list.filter((h) => new Decimal(h.qty).gt(0));
  if (open.length === 0 || open.some((h) => f(h) === null)) return null;
  return open.reduce((s, h) => s.plus(f(h)!), ZERO);
};

export function groupByInstrument(
  holdings: Record<string, HoldingView>,
  options: { includeClosed?: boolean } = {},
): InstrumentRow[] {
  const groups = new Map<string, HoldingView[]>();
  for (const h of Object.values(holdings)) {
    const list = groups.get(h.instrumentId) ?? [];
    list.push(h);
    groups.set(h.instrumentId, list);
  }

  const rows: InstrumentRow[] = [];
  let totalValue = ZERO;
  for (const [instrumentId, list] of groups) {
    const first = list[0]!;
    const qty = list.reduce((s, h) => s.plus(h.qty), ZERO);
    if (qty.isZero() && !options.includeClosed) continue;
    const invested = list.reduce((s, h) => s.plus(h.openCost), ZERO);
    const investedCcy = list.reduce((s, h) => s.plus(h.openCostCcy), ZERO);
    const value = sumOrNull(list, (h) => h.value);
    const unrealised = value ? value.minus(invested) : null;
    const day = sumOrNull(list, (h) => h.dayChange);
    if (value) totalValue = totalValue.plus(value);
    const statuses = list.map((h) => h.priceStatus);
    rows.push({
      instrumentId,
      name: first.name,
      assetClass: first.assetClass,
      symbol: first.symbol,
      currency: first.currency,
      qty: qty.toString(),
      avgCost: qty.isZero() ? '0' : invested.div(qty).toDecimalPlaces(4).toString(),
      avgCostCcy: qty.isZero() ? '0' : investedCcy.div(qty).toDecimalPlaces(4).toString(),
      invested: invested.toDecimalPlaces(2).toString(),
      price: first.price,
      priceStatus: statuses.includes('missing')
        ? 'missing'
        : statuses.includes('stale')
          ? 'stale'
          : 'fresh',
      fxRate: first.fxRate,
      value: value?.toDecimalPlaces(2).toString() ?? null,
      unrealised: unrealised?.toDecimalPlaces(2).toString() ?? null,
      unrealisedPct: unrealised && !invested.isZero() ? unrealised.div(invested).toNumber() : null,
      stockEffect:
        sumOrNull(list, (h) => h.stockEffect)
          ?.toDecimalPlaces(2)
          .toString() ?? null,
      fxEffect:
        sumOrNull(list, (h) => h.fxEffect)
          ?.toDecimalPlaces(2)
          .toString() ?? null,
      dayChange: day?.toDecimalPlaces(2).toString() ?? null,
      dayChangePct:
        day && value && !value.minus(day).isZero() ? day.div(value.minus(day)).toNumber() : null,
      realised: list
        .reduce((s, h) => s.plus(h.realised), ZERO)
        .toDecimalPlaces(2)
        .toString(),
      weight: null,
      accounts: list.map((h) => ({ accountId: h.accountId, qty: h.qty })),
      positionKeys: list.map((h) => h.key),
    });
  }
  for (const r of rows) {
    r.weight =
      r.value && !totalValue.isZero() ? new Decimal(r.value).div(totalValue).toNumber() : null;
  }
  return rows.sort((a, b) => Number(b.value ?? b.invested) - Number(a.value ?? a.invested));
}
