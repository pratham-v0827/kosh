import Decimal from 'decimal.js';
import { daysBetween } from './dates';
import {
  type AssetClass,
  ASSET_CLASSES,
  type Position,
  positionXirr,
  valuePosition,
} from './ledger';

/**
 * Compose the per-user read model ("book") from positions + instrument metadata + prices.
 * Pure: the server persists the result to users/{uid}/book/current, the UI only reads it.
 * Firestore cannot store nested arrays, so cash flows become `{ d, a }` objects here.
 */

export interface InstrumentMeta {
  id: string;
  name: string;
  assetClass: AssetClass;
  symbol: string | null;
}

export interface PriceInfo {
  price: string;
  asOf: string;
  source: 'manual';
}

export type XirrNote = 'NO_PRICE' | 'TOO_SHORT' | 'NOT_COMPUTABLE';

export interface HoldingView extends Omit<Position, 'cashflows'> {
  name: string;
  assetClass: AssetClass;
  symbol: string | null;
  cashflows: { d: string; a: number }[];
  price: PriceInfo | null;
  value: string | null;
  unrealised: string | null;
  unrealisedPct: number | null;
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
  holdingsCount: number;
  unpricedCount: number;
  byAssetClass: Record<AssetClass, ClassTotals>;
}

export interface ComposedBook {
  holdings: Record<string, HoldingView>;
  totals: BookTotals;
}

/** One row per instrument, aggregating the same holding across accounts (e.g. two brokers). */
export interface InstrumentRow {
  instrumentId: string;
  name: string;
  assetClass: AssetClass;
  symbol: string | null;
  qty: string;
  avgCost: string;
  invested: string;
  price: PriceInfo | null;
  value: string | null;
  unrealised: string | null;
  unrealisedPct: number | null;
  realised: string;
  /** Share of total priced value, 0..1; null when unpriced. */
  weight: number | null;
  accounts: { accountId: string; qty: string }[];
  positionKeys: string[];
}

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
    const priced =
      first.price !== null && list.every((h) => h.value !== null || new Decimal(h.qty).isZero());
    const value = priced ? list.reduce((s, h) => s.plus(h.value ?? 0), ZERO) : null;
    const unrealised = value ? value.minus(invested) : null;
    if (value) totalValue = totalValue.plus(value);
    rows.push({
      instrumentId,
      name: first.name,
      assetClass: first.assetClass,
      symbol: first.symbol,
      qty: qty.toString(),
      avgCost: qty.isZero() ? '0' : invested.div(qty).toDecimalPlaces(4).toString(),
      invested: invested.toDecimalPlaces(2).toString(),
      price: first.price,
      value: value?.toDecimalPlaces(2).toString() ?? null,
      unrealised: unrealised?.toDecimalPlaces(2).toString() ?? null,
      unrealisedPct: unrealised && !invested.isZero() ? unrealised.div(invested).toNumber() : null,
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

/** XIRR over very short holding periods is noise; the UI explains why it is hidden. */
export const MIN_XIRR_DAYS = 30;

const ZERO = new Decimal(0);

export function composeBook(
  positions: Record<string, Position>,
  instruments: Record<string, InstrumentMeta>,
  prices: Record<string, PriceInfo>,
  asOf: string,
): ComposedBook {
  const holdings: Record<string, HoldingView> = {};
  let invested = ZERO;
  let value = ZERO;
  let pricedInvested = ZERO;
  let realised = ZERO;
  let dividends = ZERO;
  let holdingsCount = 0;
  let unpricedCount = 0;
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

    let val: ReturnType<typeof valuePosition> | null = null;
    let x: number | null = null;
    let xirrNote: XirrNote | null = null;
    if (open && price) {
      val = valuePosition(p, price.price);
      if (p.firstAcquired && daysBetween(p.firstAcquired, asOf) < MIN_XIRR_DAYS) {
        xirrNote = 'TOO_SHORT';
      } else {
        const r = positionXirr(p, val.value, asOf);
        if (r.ok) x = r.rate;
        else xirrNote = 'NOT_COMPUTABLE';
      }
    } else if (open) {
      xirrNote = 'NO_PRICE';
    }

    holdings[key] = {
      ...p,
      name: meta.name,
      assetClass: meta.assetClass,
      symbol: meta.symbol,
      cashflows: p.cashflows.map(([d, a]) => ({ d, a })),
      price,
      value: val?.value ?? null,
      unrealised: val?.unrealised ?? null,
      unrealisedPct: val?.unrealisedPct ?? null,
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
    } else {
      unpricedCount++;
    }
  }

  const unrealised = value.minus(pricedInvested);
  return {
    holdings,
    totals: {
      invested: invested.toDecimalPlaces(2).toString(),
      value: value.toDecimalPlaces(2).toString(),
      pricedInvested: pricedInvested.toDecimalPlaces(2).toString(),
      unrealised: unrealised.toDecimalPlaces(2).toString(),
      unrealisedPct: pricedInvested.isZero() ? null : unrealised.div(pricedInvested).toNumber(),
      realised: realised.toDecimalPlaces(2).toString(),
      dividends: dividends.toDecimalPlaces(2).toString(),
      holdingsCount,
      unpricedCount,
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
