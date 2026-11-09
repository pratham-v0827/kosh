import Decimal from 'decimal.js';
import { toEpochDay } from './dates';
import { type CashFlow, xirr } from './xirr';

/**
 * Ledger → positions. Transactions are the source of truth (ADR-0005); positions, cost basis,
 * realised P&L and cash flows are derived here, deterministically, using FIFO lots (ADR-0012).
 *
 * Currencies: amounts on a transaction are in its `currency` (INR by default). USD transactions
 * carry `fxRate` (INR per USD on the trade date); every lot keeps both its native unit cost and
 * that FX rate, so INR P&L can be split into "stock" and "currency" effects.
 */

export type AssetClass = 'IN_EQUITY' | 'US_EQUITY' | 'MUTUAL_FUND' | 'UNLISTED' | 'CRYPTO';
export const ASSET_CLASSES = [
  'IN_EQUITY',
  'US_EQUITY',
  'MUTUAL_FUND',
  'UNLISTED',
  'CRYPTO',
] as const satisfies readonly AssetClass[];

export type Currency = 'INR' | 'USD';
export type TxnType = 'BUY' | 'SELL' | 'OPENING_BALANCE' | 'DIVIDEND' | 'FEE' | 'SPLIT' | 'BONUS';

/** Ratio for corporate actions. SPLIT 1:2 → each share becomes 2. BONUS 1:1 → 1 free share per 1 held. */
export interface Ratio {
  from: number;
  to: number;
}

export interface LedgerTxn {
  id: string;
  accountId: string;
  instrumentId: string;
  type: TxnType;
  /** Trade / ex-date as an ISO calendar date (YYYY-MM-DD). */
  tradeDate: string;
  /** Units (BUY, SELL, OPENING_BALANCE). Decimal string. */
  qty?: string;
  /** Price per unit in `currency` (BUY, SELL, OPENING_BALANCE). Decimal string. */
  price?: string;
  /** Brokerage, taxes and charges in `currency`. Added to cost on buys, deducted from proceeds on sells. */
  fees?: string;
  /** Cash amount in `currency` (DIVIDEND, FEE). */
  amount?: string;
  /** SPLIT / BONUS ratio. */
  ratio?: Ratio;
  /** Currency of price/fees/amount. Default INR. */
  currency?: Currency;
  /** INR per 1 unit of `currency` on the trade date. Required for USD money events. */
  fxRate?: string;
  /** Tie-breaker for transactions on the same date (e.g. createdAt millis). */
  seq?: number;
}

export interface Lot {
  date: string;
  qty: string;
  /** INR cost per unit including allocated buy fees. */
  unitCost: string;
  /** Native-currency cost per unit including fees. Equals unitCost for INR. */
  unitCostCcy: string;
  /** FX rate used for this lot (1 for INR). */
  fx: string;
}

export interface Position {
  key: string;
  accountId: string;
  instrumentId: string;
  currency: Currency;
  qty: string;
  /** INR cost of the units still held (FIFO). */
  openCost: string;
  /** Native-currency cost of the units still held. */
  openCostCcy: string;
  /** openCost / qty (INR), or "0" when nothing is held. */
  avgCost: string;
  /** openCostCcy / qty (native currency). */
  avgCostCcy: string;
  /** Realised P&L in INR (FX at sale vs FX at purchase included). */
  realised: string;
  dividends: string;
  fees: string;
  firstAcquired: string | null;
  lots: Lot[];
  /** INR cash flows aggregated per day, investor's view (buys negative). */
  cashflows: [date: string, amount: number][];
}

export type LedgerErrorCode =
  | 'SELL_EXCEEDS_HOLDING'
  | 'MISSING_FIELD'
  | 'MISSING_FX'
  | 'CURRENCY_MISMATCH'
  | 'NON_POSITIVE_VALUE'
  | 'INVALID_RATIO'
  | 'NO_HOLDING_FOR_ACTION';

export interface LedgerError {
  txnId: string;
  code: LedgerErrorCode;
  message: string;
}

export interface BookResult {
  positions: Record<string, Position>;
  /** Transactions that could not be applied; they are skipped, never silently half-applied. */
  errors: LedgerError[];
}

export const positionKey = (accountId: string, instrumentId: string) =>
  `${accountId}|${instrumentId}`;

// Same-day ordering: corporate actions apply first (trades on the ex-date are post-action),
// then acquisitions, then disposals, then cash events.
const DAY_ORDER: Record<TxnType, number> = {
  SPLIT: 0,
  BONUS: 0,
  OPENING_BALANCE: 1,
  BUY: 1,
  SELL: 2,
  DIVIDEND: 3,
  FEE: 3,
};

interface MutableLot {
  date: string;
  qty: Decimal;
  unitCost: Decimal;
  unitCostCcy: Decimal;
  fx: Decimal;
}

interface MutablePosition {
  accountId: string;
  instrumentId: string;
  currency: Currency;
  lots: MutableLot[];
  realised: Decimal;
  dividends: Decimal;
  fees: Decimal;
  firstAcquired: string | null;
  flows: Map<string, Decimal>;
}

const ZERO = new Decimal(0);
const ONE = new Decimal(1);

function dec(value: string | undefined): Decimal | null {
  if (value === undefined || value === '') return null;
  try {
    const d = new Decimal(value);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

function addFlow(p: MutablePosition, date: string, amount: Decimal) {
  p.flows.set(date, (p.flows.get(date) ?? ZERO).plus(amount));
}

/** Build positions from an unordered list of ledger transactions. Pure and deterministic. */
export function buildPositions(txns: readonly LedgerTxn[]): BookResult {
  const sorted = [...txns].sort((a, b) => {
    const d = toEpochDay(a.tradeDate) - toEpochDay(b.tradeDate);
    if (d !== 0) return d;
    const o = DAY_ORDER[a.type] - DAY_ORDER[b.type];
    if (o !== 0) return o;
    return (a.seq ?? 0) - (b.seq ?? 0) || a.id.localeCompare(b.id);
  });

  const book = new Map<string, MutablePosition>();
  const errors: LedgerError[] = [];
  const fail = (t: LedgerTxn, code: LedgerErrorCode, message: string) =>
    errors.push({ txnId: t.id, code, message });

  for (const t of sorted) {
    const key = positionKey(t.accountId, t.instrumentId);
    const currency: Currency = t.currency ?? 'INR';
    let p = book.get(key);

    if (p && p.currency !== currency && t.type !== 'SPLIT' && t.type !== 'BONUS') {
      fail(t, 'CURRENCY_MISMATCH', `This holding is in ${p.currency}, not ${currency}`);
      continue;
    }

    /** FX for money events: 1 for INR; required and positive for USD. */
    const fxFor = (): Decimal | null => {
      if (currency === 'INR') return ONE;
      const fx = dec(t.fxRate);
      if (!fx || fx.lte(0)) {
        fail(t, 'MISSING_FX', 'A USD transaction needs the USD→INR rate for its date');
        return null;
      }
      return fx;
    };
    const ensure = () => {
      if (!p) {
        p = {
          accountId: t.accountId,
          instrumentId: t.instrumentId,
          currency,
          lots: [],
          realised: ZERO,
          dividends: ZERO,
          fees: ZERO,
          firstAcquired: null,
          flows: new Map(),
        };
        book.set(key, p);
      }
      return p;
    };
    const held = () => (p ? p.lots.reduce((s, l) => s.plus(l.qty), ZERO) : ZERO);

    switch (t.type) {
      case 'BUY':
      case 'OPENING_BALANCE': {
        const qty = dec(t.qty);
        const price = dec(t.price);
        const fees = dec(t.fees) ?? ZERO;
        if (!qty || !price) {
          fail(t, 'MISSING_FIELD', 'qty and price are required');
          break;
        }
        if (qty.lte(0) || price.lt(0) || fees.lt(0)) {
          fail(t, 'NON_POSITIVE_VALUE', 'qty must be > 0; price and fees must be ≥ 0');
          break;
        }
        const fx = fxFor();
        if (!fx) break;
        const pos = ensure();
        const grossCcy = qty.times(price).plus(fees);
        const grossInr = grossCcy.times(fx);
        pos.lots.push({
          date: t.tradeDate,
          qty,
          unitCost: grossInr.div(qty),
          unitCostCcy: grossCcy.div(qty),
          fx,
        });
        pos.fees = pos.fees.plus(fees.times(fx));
        pos.firstAcquired ??= t.tradeDate;
        addFlow(pos, t.tradeDate, grossInr.neg());
        break;
      }

      case 'SELL': {
        const qty = dec(t.qty);
        const price = dec(t.price);
        const fees = dec(t.fees) ?? ZERO;
        if (!qty || !price) {
          fail(t, 'MISSING_FIELD', 'qty and price are required');
          break;
        }
        if (qty.lte(0) || price.lt(0) || fees.lt(0)) {
          fail(t, 'NON_POSITIVE_VALUE', 'qty must be > 0; price and fees must be ≥ 0');
          break;
        }
        const available = held();
        if (qty.gt(available)) {
          fail(
            t,
            'SELL_EXCEEDS_HOLDING',
            `Selling ${qty.toString()} but only ${available.toString()} held on ${t.tradeDate}`,
          );
          break;
        }
        const fx = fxFor();
        if (!fx) break;
        const pos = ensure();
        let remaining = qty;
        let matchedCost = ZERO;
        while (remaining.gt(0)) {
          const lot = pos.lots[0]!;
          const take = Decimal.min(lot.qty, remaining);
          matchedCost = matchedCost.plus(take.times(lot.unitCost));
          lot.qty = lot.qty.minus(take);
          remaining = remaining.minus(take);
          if (lot.qty.isZero()) pos.lots.shift();
        }
        const proceeds = qty.times(price).minus(fees).times(fx);
        pos.realised = pos.realised.plus(proceeds.minus(matchedCost));
        pos.fees = pos.fees.plus(fees.times(fx));
        addFlow(pos, t.tradeDate, proceeds);
        break;
      }

      case 'SPLIT':
      case 'BONUS': {
        const r = t.ratio;
        if (
          !r ||
          !Number.isInteger(r.from) ||
          !Number.isInteger(r.to) ||
          r.from <= 0 ||
          r.to <= 0
        ) {
          fail(t, 'INVALID_RATIO', 'ratio.from and ratio.to must be positive integers');
          break;
        }
        if (!p || held().isZero()) {
          fail(t, 'NO_HOLDING_FOR_ACTION', `No units held on ${t.tradeDate}`);
          break;
        }
        const factor = new Decimal(r.to).div(r.from);
        if (t.type === 'SPLIT') {
          for (const lot of p.lots) {
            lot.qty = lot.qty.times(factor);
            lot.unitCost = lot.unitCost.div(factor);
            lot.unitCostCcy = lot.unitCostCcy.div(factor);
          }
        } else {
          p.lots.push({
            date: t.tradeDate,
            qty: held().times(factor),
            unitCost: ZERO,
            unitCostCcy: ZERO,
            fx: p.lots[0]?.fx ?? ONE,
          });
        }
        break;
      }

      case 'DIVIDEND':
      case 'FEE': {
        const amount = dec(t.amount);
        if (!amount) {
          fail(t, 'MISSING_FIELD', 'amount is required');
          break;
        }
        if (amount.lte(0)) {
          fail(t, 'NON_POSITIVE_VALUE', 'amount must be > 0');
          break;
        }
        const fx = fxFor();
        if (!fx) break;
        const pos = ensure();
        const inr = amount.times(fx);
        if (t.type === 'DIVIDEND') {
          pos.dividends = pos.dividends.plus(inr);
          addFlow(pos, t.tradeDate, inr);
        } else {
          pos.fees = pos.fees.plus(inr);
          addFlow(pos, t.tradeDate, inr.neg());
        }
        break;
      }
    }
  }

  const positions: Record<string, Position> = {};
  for (const [key, p] of book) {
    const qty = p.lots.reduce((s, l) => s.plus(l.qty), ZERO);
    const openCost = p.lots.reduce((s, l) => s.plus(l.qty.times(l.unitCost)), ZERO);
    const openCostCcy = p.lots.reduce((s, l) => s.plus(l.qty.times(l.unitCostCcy)), ZERO);
    positions[key] = {
      key,
      accountId: p.accountId,
      instrumentId: p.instrumentId,
      currency: p.currency,
      qty: qty.toString(),
      openCost: openCost.toDecimalPlaces(4).toString(),
      openCostCcy: openCostCcy.toDecimalPlaces(4).toString(),
      avgCost: qty.isZero() ? '0' : openCost.div(qty).toDecimalPlaces(4).toString(),
      avgCostCcy: qty.isZero() ? '0' : openCostCcy.div(qty).toDecimalPlaces(4).toString(),
      realised: p.realised.toDecimalPlaces(4).toString(),
      dividends: p.dividends.toDecimalPlaces(4).toString(),
      fees: p.fees.toDecimalPlaces(4).toString(),
      firstAcquired: p.firstAcquired,
      lots: p.lots.map((l) => ({
        date: l.date,
        qty: l.qty.toString(),
        unitCost: l.unitCost.toDecimalPlaces(6).toString(),
        unitCostCcy: l.unitCostCcy.toDecimalPlaces(6).toString(),
        fx: l.fx.toString(),
      })),
      cashflows: [...p.flows.entries()]
        .sort(([a], [b]) => toEpochDay(a) - toEpochDay(b))
        .map(([d, v]) => [d, v.toDecimalPlaces(2).toNumber()]),
    };
  }
  return { positions, errors };
}

export interface Valuation {
  /** INR value. */
  value: string;
  unrealised: string;
  /** Unrealised / open cost; null when open cost is zero (e.g. bonus-only). */
  unrealisedPct: number | null;
  /** INR P&L from the price move, at today's FX (null for INR holdings). */
  stockEffect: string | null;
  /** INR P&L from the FX move since each lot was bought (null for INR holdings). */
  fxEffect: string | null;
}

/**
 * Value a position at a unit price in its own currency, converted at `fx` (INR per unit).
 *   value       = qty × price × fx
 *   stockEffect = Σ lot.qty × (price − lot.unitCostCcy) × fx
 *   fxEffect    = Σ lot.qty × lot.unitCostCcy × (fx − lot.fx)
 * stockEffect + fxEffect = value − openCost.
 */
export function valuePosition(position: Position, price: string, fx: string = '1'): Valuation {
  const X = new Decimal(fx);
  const P = new Decimal(price);
  const value = new Decimal(position.qty).times(P).times(X);
  const cost = new Decimal(position.openCost);
  const unrealised = value.minus(cost);
  let stock: Decimal | null = null;
  let fxe: Decimal | null = null;
  if (position.currency !== 'INR') {
    stock = ZERO;
    fxe = ZERO;
    for (const l of position.lots) {
      const q = new Decimal(l.qty);
      stock = stock.plus(q.times(P.minus(l.unitCostCcy)).times(X));
      fxe = fxe.plus(q.times(l.unitCostCcy).times(X.minus(l.fx)));
    }
  }
  return {
    value: value.toDecimalPlaces(2).toString(),
    unrealised: unrealised.toDecimalPlaces(2).toString(),
    unrealisedPct: cost.isZero() ? null : unrealised.div(cost).toNumber(),
    stockEffect: stock?.toDecimalPlaces(2).toString() ?? null,
    fxEffect: fxe?.toDecimalPlaces(2).toString() ?? null,
  };
}

/**
 * INR day change. Each lot moves from its base to today's value:
 * base = previous close at the previous FX, or, for lots bought on/after the quote date,
 * the purchase cost (so a position bought today shows only today's move from the buy price).
 * Returns null when there is no previous close.
 */
export function dayChange(
  position: Position,
  quote: { price: string; prevClose?: string; asOf: string },
  fx: { rate: string; prevRate?: string } = { rate: '1' },
): { change: string; pct: number | null } | null {
  if (!quote.prevClose) return null;
  const X = new Decimal(fx.rate);
  const X0 = new Decimal(fx.prevRate ?? fx.rate);
  const P = new Decimal(quote.price);
  const P0 = new Decimal(quote.prevClose);
  const quoteDate = quote.asOf.slice(0, 10);
  let change = ZERO;
  let base = ZERO;
  for (const l of position.lots) {
    const q = new Decimal(l.qty);
    const fresh = l.date >= quoteDate;
    const b = fresh ? q.times(l.unitCostCcy).times(l.fx) : q.times(P0).times(X0);
    base = base.plus(b);
    change = change.plus(q.times(P).times(X).minus(b));
  }
  return {
    change: change.toDecimalPlaces(2).toString(),
    pct: base.isZero() ? null : change.div(base).toNumber(),
  };
}

/** Annualised return for a position, treating the current value as a final inflow on `asOf`. */
export function positionXirr(position: Position, value: string, asOf: string) {
  const flows: CashFlow[] = position.cashflows.map(([date, amount]) => ({ date, amount }));
  flows.push({ date: asOf, amount: Number(value) });
  return xirr(flows);
}
