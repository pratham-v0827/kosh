import Decimal from 'decimal.js';
import { toEpochDay } from './dates';
import { type CashFlow, xirr } from './xirr';

/**
 * Ledger → positions. Transactions are the source of truth (ADR-0005); positions, cost basis,
 * realised P&L and cash flows are derived here, deterministically, using FIFO lots (ADR-0012).
 * All money is INR in M1; USD + FX arrives with the price engine (M2).
 */

export type AssetClass = 'IN_EQUITY' | 'US_EQUITY' | 'MUTUAL_FUND' | 'UNLISTED' | 'CRYPTO';
export const ASSET_CLASSES = [
  'IN_EQUITY',
  'US_EQUITY',
  'MUTUAL_FUND',
  'UNLISTED',
  'CRYPTO',
] as const satisfies readonly AssetClass[];

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
  /** Price per unit in INR (BUY, SELL, OPENING_BALANCE). Decimal string. */
  price?: string;
  /** Brokerage, taxes and charges in INR. Added to cost on buys, deducted from proceeds on sells. */
  fees?: string;
  /** Cash amount in INR (DIVIDEND, FEE). */
  amount?: string;
  /** SPLIT / BONUS ratio. */
  ratio?: Ratio;
  /** Tie-breaker for transactions on the same date (e.g. createdAt millis). */
  seq?: number;
}

export interface Lot {
  date: string;
  qty: string;
  /** Cost per unit including allocated buy fees. */
  unitCost: string;
}

export interface Position {
  key: string;
  accountId: string;
  instrumentId: string;
  qty: string;
  /** Cost of the units still held (FIFO). */
  openCost: string;
  /** openCost / qty, or "0" when nothing is held. */
  avgCost: string;
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

interface MutablePosition {
  accountId: string;
  instrumentId: string;
  lots: { date: string; qty: Decimal; unitCost: Decimal }[];
  realised: Decimal;
  dividends: Decimal;
  fees: Decimal;
  firstAcquired: string | null;
  flows: Map<string, Decimal>;
}

const ZERO = new Decimal(0);

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
    let p = book.get(key);
    const ensure = () => {
      if (!p) {
        p = {
          accountId: t.accountId,
          instrumentId: t.instrumentId,
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
        const pos = ensure();
        const gross = qty.times(price).plus(fees);
        pos.lots.push({ date: t.tradeDate, qty, unitCost: gross.div(qty) });
        pos.fees = pos.fees.plus(fees);
        pos.firstAcquired ??= t.tradeDate;
        addFlow(pos, t.tradeDate, gross.neg());
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
        const proceeds = qty.times(price).minus(fees);
        pos.realised = pos.realised.plus(proceeds.minus(matchedCost));
        pos.fees = pos.fees.plus(fees);
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
          }
        } else {
          p.lots.push({ date: t.tradeDate, qty: held().times(factor), unitCost: ZERO });
        }
        break;
      }

      case 'DIVIDEND': {
        const amount = dec(t.amount);
        if (!amount) {
          fail(t, 'MISSING_FIELD', 'amount is required');
          break;
        }
        if (amount.lte(0)) {
          fail(t, 'NON_POSITIVE_VALUE', 'amount must be > 0');
          break;
        }
        const pos = ensure();
        pos.dividends = pos.dividends.plus(amount);
        addFlow(pos, t.tradeDate, amount);
        break;
      }

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
        const pos = ensure();
        pos.fees = pos.fees.plus(amount);
        addFlow(pos, t.tradeDate, amount.neg());
        break;
      }
    }
  }

  const positions: Record<string, Position> = {};
  for (const [key, p] of book) {
    const qty = p.lots.reduce((s, l) => s.plus(l.qty), ZERO);
    const openCost = p.lots.reduce((s, l) => s.plus(l.qty.times(l.unitCost)), ZERO);
    positions[key] = {
      key,
      accountId: p.accountId,
      instrumentId: p.instrumentId,
      qty: qty.toString(),
      openCost: openCost.toDecimalPlaces(4).toString(),
      avgCost: qty.isZero() ? '0' : openCost.div(qty).toDecimalPlaces(4).toString(),
      realised: p.realised.toDecimalPlaces(4).toString(),
      dividends: p.dividends.toDecimalPlaces(4).toString(),
      fees: p.fees.toDecimalPlaces(4).toString(),
      firstAcquired: p.firstAcquired,
      lots: p.lots.map((l) => ({
        date: l.date,
        qty: l.qty.toString(),
        unitCost: l.unitCost.toDecimalPlaces(6).toString(),
      })),
      cashflows: [...p.flows.entries()]
        .sort(([a], [b]) => toEpochDay(a) - toEpochDay(b))
        .map(([d, v]) => [d, v.toDecimalPlaces(2).toNumber()]),
    };
  }
  return { positions, errors };
}

export interface Valuation {
  value: string;
  unrealised: string;
  /** Unrealised / open cost; null when open cost is zero (e.g. bonus-only). */
  unrealisedPct: number | null;
}

/** Value a position at a unit price (INR). */
export function valuePosition(position: Position, price: string): Valuation {
  const value = new Decimal(position.qty).times(price);
  const cost = new Decimal(position.openCost);
  const unrealised = value.minus(cost);
  return {
    value: value.toDecimalPlaces(2).toString(),
    unrealised: unrealised.toDecimalPlaces(2).toString(),
    unrealisedPct: cost.isZero() ? null : unrealised.div(cost).toNumber(),
  };
}

/** Annualised return for a position, treating the current value as a final inflow on `asOf`. */
export function positionXirr(position: Position, value: string, asOf: string) {
  const flows: CashFlow[] = position.cashflows.map(([date, amount]) => ({ date, amount }));
  flows.push({ date: asOf, amount: Number(value) });
  return xirr(flows);
}
