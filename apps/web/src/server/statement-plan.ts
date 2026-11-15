import { InstrumentInput } from '@kosh/contracts';
import type { Currency, LedgerTxn } from '@kosh/core';
import {
  canonicalDecimal,
  fingerprint,
  type NormalisedHolding,
  type NormalisedStatement,
  type RowIssue,
} from '@kosh/parsers';
import { HttpError } from './http';
import { instrumentIdFor } from './instrument-id';

/**
 * Planning for a HOLDINGS statement (a snapshot of positions, not a trade history).
 *
 * A newer statement from the same broker replaces that broker's statement holdings. This module
 * works out the difference without touching the database: which holdings are added, changed,
 * unchanged or no longer present.
 */

/** A ticker found for an ISIN (from the user's own instruments, the shared cache, or a lookup). */
export interface ResolvedIsin {
  /** Set when the user already holds this ISIN under an instrument: that identity is reused. */
  instrumentId?: string;
  symbol: string;
  exchange: 'NSE' | 'BSE';
  name?: string;
}

/** One of the broker's holdings currently in the ledger (from an earlier statement). */
export interface CurrentLot {
  txnId: string;
  instrumentId: string;
  name: string;
  quantity: string;
  avgBuyPrice: string;
  tradeDate: string;
}

export interface StatementRow {
  line: number;
  /** added = new holding; changed = quantity or average price differs; unchanged = left as is. */
  status: 'added' | 'changed' | 'unchanged';
  instrumentId: string;
  assetClass: NormalisedHolding['assetClass'];
  instrumentType: NormalisedHolding['instrumentType'];
  name: string;
  symbol?: string;
  exchange?: 'NSE' | 'BSE';
  isin?: string;
  /** No ticker is known yet: the holding is imported, but not priced until it is mapped. */
  unresolved: boolean;
  quantity: string;
  avgBuyPrice: string;
  investedAmount: string;
  currency: Currency;
  /** Date of the opening lot: the first purchase when the file has it, else the statement date. */
  tradeDate: string;
  dateQuality: 'approximate' | 'unknown';
  fxRate?: string;
  statementPrice?: string;
  warnings: string[];
  /** For "changed" rows: what the ledger holds now. */
  previous?: { txnId: string; quantity: string; avgBuyPrice: string };
  fingerprint: string;
}

export interface RemovedRow {
  txnId: string;
  instrumentId: string;
  name: string;
  quantity: string;
  avgBuyPrice: string;
}

export interface StatementPlan {
  accountId: string;
  rows: StatementRow[];
  /** Holdings in the ledger that the statement no longer lists. */
  removed: RemovedRow[];
  /**
   * BUG-018: every lot of this broker the plan was compared against. Confirm checks they are all
   * still active under the same holding; if not (say an earlier import was undone meanwhile), the
   * preview is out of date, because "unchanged" rows are not written again.
   */
  basis: { txnId: string; instrumentId: string }[];
  issues: RowIssue[];
  newInstrumentIds: string[];
  /** The statement is dated before the one currently in the ledger. */
  olderThanCurrent: boolean;
  /**
   * True when some rows could not be read: holdings missing from the file are then KEPT, because
   * one of them may be a row that failed to parse.
   */
  removalsSuppressed: boolean;
  counts: {
    total: number;
    added: number;
    changed: number;
    unchanged: number;
    removed: number;
    skipped: number;
    needsAttention: number;
    unresolved: number;
  };
}

export interface StatementPlanInputs {
  /** ISIN → ticker. A missing key or null means "not resolved". */
  resolved: ReadonlyMap<string, ResolvedIsin | null>;
  current: readonly CurrentLot[];
  existingInstrumentIds: ReadonlySet<string>;
  /** USD→INR reference rate by date, for US holdings. */
  fxByDate: ReadonlyMap<string, string | null>;
  /** Statement date of the broker's holdings currently in the ledger, if any. */
  currentStatementDate?: string | null;
}

export const statementAccountId = (account: string) => `import:${account}`;

/** Dates for which a USD→INR rate is needed before planning. */
export function statementFxDates(s: NormalisedStatement): string[] {
  return [
    ...new Set(
      s.holdings.filter((h) => h.currency === 'USD').map((h) => h.acquiredOn ?? s.statementDate),
    ),
  ];
}

const same = (a: string, b: string) => canonicalDecimal(a) === canonicalDecimal(b);

function identify(
  h: NormalisedHolding,
  resolved: ReadonlyMap<string, ResolvedIsin | null>,
): Pick<StatementRow, 'instrumentId' | 'symbol' | 'exchange' | 'unresolved' | 'name'> {
  if (h.symbol) {
    return {
      instrumentId: instrumentIdFor({ assetClass: h.assetClass, name: h.name, symbol: h.symbol }),
      symbol: h.symbol,
      unresolved: false,
      name: h.name,
    };
  }
  const hit = h.isin ? (resolved.get(h.isin) ?? null) : null;
  if (hit) {
    return {
      instrumentId:
        hit.instrumentId ??
        instrumentIdFor({
          assetClass: h.assetClass,
          name: h.name,
          symbol: hit.symbol,
          exchange: hit.exchange,
        }),
      symbol: hit.symbol,
      exchange: hit.exchange,
      unresolved: false,
      name: h.name,
    };
  }
  // No ticker: the ISIN is the identity until the user maps it.
  return { instrumentId: `${h.assetClass}:${h.isin ?? 'UNKNOWN'}`, unresolved: true, name: h.name };
}

export function planStatement(s: NormalisedStatement, inputs: StatementPlanInputs): StatementPlan {
  const accountId = statementAccountId(s.account);
  const issues: RowIssue[] = [...s.issues];
  const currentById = new Map(inputs.current.map((c) => [c.instrumentId, c]));
  const inFile = new Set<string>();
  const rows: StatementRow[] = [];

  for (const h of s.holdings) {
    const id = identify(h, inputs.resolved);
    if (inFile.has(id.instrumentId)) {
      issues.push({
        line: h.line,
        message: 'This holding appears more than once in the file under the same ticker',
      });
      continue;
    }
    // From here the instrument counts as "present in the file", even if the row has a problem,
    // so that a row with an issue never turns into a removal.
    inFile.add(id.instrumentId);

    const previous = currentById.get(id.instrumentId);
    // Without a purchase date in the file, a holding keeps the earliest date Kosh has seen it:
    // a newer statement must not make an untouched holding look changed, or newer than it is.
    const tradeDate = h.acquiredOn ?? previous?.tradeDate ?? s.statementDate;
    const status: StatementRow['status'] = !previous
      ? 'added'
      : same(previous.quantity, h.quantity) &&
          same(previous.avgBuyPrice, h.avgBuyPrice) &&
          previous.tradeDate === tradeDate
        ? 'unchanged'
        : 'changed';

    let fxRate: string | undefined;
    if (h.currency === 'USD' && status !== 'unchanged') {
      fxRate = inputs.fxByDate.get(tradeDate) ?? undefined;
      if (!fxRate) {
        issues.push({
          line: h.line,
          field: 'Holding Since',
          message: 'No USD→INR rate was found for this date, so the holding was left out',
        });
        continue;
      }
    }

    rows.push({
      line: h.line,
      status,
      ...id,
      assetClass: h.assetClass,
      instrumentType: h.instrumentType,
      ...(h.isin ? { isin: h.isin } : {}),
      quantity: h.quantity,
      avgBuyPrice: h.avgBuyPrice,
      investedAmount: h.investedAmount,
      currency: h.currency,
      tradeDate,
      dateQuality: h.acquiredOn ? 'approximate' : 'unknown',
      ...(fxRate ? { fxRate } : {}),
      ...(h.statementPrice ? { statementPrice: h.statementPrice } : {}),
      warnings: h.warnings,
      ...(status === 'changed' && previous
        ? {
            previous: {
              txnId: previous.txnId,
              quantity: previous.quantity,
              avgBuyPrice: previous.avgBuyPrice,
            },
          }
        : {}),
      fingerprint: fingerprint({
        source: s.source,
        accountId,
        instrumentId: id.instrumentId,
        type: 'OPENING_BALANCE',
        tradeDate,
        qty: h.quantity,
        price: h.avgBuyPrice,
      }),
    });
  }

  // Rows the parser could not read have no known instrument: one of the "missing" holdings may be
  // such a row, so nothing is removed in that case.
  const removalsSuppressed = s.issues.length > 0;
  const removed: RemovedRow[] = removalsSuppressed
    ? []
    : inputs.current
        .filter((c) => !inFile.has(c.instrumentId))
        .map((c) => ({
          txnId: c.txnId,
          instrumentId: c.instrumentId,
          name: c.name,
          quantity: c.quantity,
          avgBuyPrice: c.avgBuyPrice,
        }));

  issues.sort((a, b) => a.line - b.line);
  const count = (status: StatementRow['status']) => rows.filter((r) => r.status === status).length;
  return {
    accountId,
    rows,
    removed,
    basis: inputs.current.map((c) => ({ txnId: c.txnId, instrumentId: c.instrumentId })),
    issues,
    newInstrumentIds: [
      ...new Set(
        rows
          .filter((r) => r.status !== 'unchanged')
          .map((r) => r.instrumentId)
          .filter((id) => !inputs.existingInstrumentIds.has(id)),
      ),
    ],
    olderThanCurrent: Boolean(
      inputs.currentStatementDate && s.statementDate < inputs.currentStatementDate,
    ),
    removalsSuppressed,
    counts: {
      total: s.totalRows,
      added: count('added'),
      changed: count('changed'),
      unchanged: count('unchanged'),
      removed: removed.length,
      skipped: s.skipped.length,
      needsAttention: new Set(issues.map((i) => i.line)).size,
      unresolved: rows.filter((r) => r.unresolved).length,
    },
  };
}

/** Ledger fields for the opening lot of a statement row (what confirm writes). */
export function statementRowToLedgerFields(
  r: StatementRow,
  accountId: string,
): Omit<LedgerTxn, 'id' | 'seq'> {
  return {
    accountId,
    instrumentId: r.instrumentId,
    type: 'OPENING_BALANCE',
    tradeDate: r.tradeDate,
    qty: r.quantity,
    price: r.avgBuyPrice,
    currency: r.currency,
    dateQuality: r.dateQuality,
    ...(r.fxRate ? { fxRate: r.fxRate } : {}),
  };
}

export interface TickerMapping {
  line: number;
  symbol: string;
  exchange?: 'NSE' | 'BSE';
}

/**
 * Apply the tickers a user typed for unresolved rows (other rows are left alone). Throws 422 for
 * a ticker Kosh would not accept, and (BUG-019) for two rows that would end up on one holding:
 * a broker account holds one opening lot per share, and a later statement replaces just one.
 */
export function applyMappings(
  rows: readonly StatementRow[],
  mappings: readonly TickerMapping[],
  source: string,
  accountId: string,
): StatementRow[] {
  const byLine = new Map(mappings.map((m) => [m.line, m]));
  const out = rows.map((row) => {
    const mapping = byLine.get(row.line);
    // An unchanged row is not written again: it is mapped from the holdings page instead.
    if (!mapping || !row.unresolved || row.status === 'unchanged') return row;
    const checked = InstrumentInput.safeParse({
      name: row.name,
      assetClass: row.assetClass,
      symbol: mapping.symbol,
      ...(mapping.exchange ? { exchange: mapping.exchange } : {}),
    });
    if (!checked.success || !checked.data.symbol) {
      throw new HttpError(422, 'VALIDATION_FAILED', `Row ${row.line}: that is not a valid ticker`, {
        fields: { [`mappings.${row.line}`]: 'Letters, digits and . - & only' },
      });
    }
    const symbol = checked.data.symbol;
    const exchange = checked.data.exchange ?? 'NSE';
    const instrumentId = instrumentIdFor({
      assetClass: row.assetClass,
      name: row.name,
      symbol,
      exchange,
    });
    return {
      ...row,
      instrumentId,
      symbol,
      exchange,
      unresolved: false,
      fingerprint: fingerprint({
        source,
        accountId,
        instrumentId,
        type: 'OPENING_BALANCE',
        tradeDate: row.tradeDate,
        qty: row.quantity,
        price: row.avgBuyPrice,
      }),
    };
  });

  const lineOf = new Map<string, number>();
  for (const row of out) {
    const other = lineOf.get(row.instrumentId);
    if (other !== undefined) {
      const typed = byLine.has(row.line) ? row.line : other;
      throw new HttpError(
        422,
        'DUPLICATE_HOLDING',
        `Row ${typed}: ${row.symbol ?? row.instrumentId} is already another row of this statement. Check the ticker`,
        { fields: { [`mappings.${typed}`]: 'Already used by another row' } },
      );
    }
    lineOf.set(row.instrumentId, row.line);
  }
  return out;
}
