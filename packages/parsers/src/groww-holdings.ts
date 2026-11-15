import { ImportError } from './errors';
import {
  cellText,
  findHeaderRow,
  type HeaderMatch,
  isBlankRow,
  labelKey,
  type Sheet,
  valueBeside,
} from './sheets';
import { cellDecimal, Decimal, fixed, reconcileTotal } from './statement-utils';
import type {
  NormalisedHolding,
  NormalisedStatement,
  ParseContext,
  Parser,
  ParserInput,
  RowIssue,
} from './types';
import { parseDate } from './values';

/**
 * Groww "Stocks Holdings Statement" (.xlsx). Documented in docs/parsers/groww-holdings.md.
 * Indian shares and exchange-traded funds, identified by ISIN. A snapshot: no trades, no dates.
 */

// Header cells, compared as letters-and-digits keys ("Average buy price" → "averagebuyprice").
const REQUIRED = ['stockname', 'isin', 'quantity', 'averagebuyprice'] as const;
const OPTIONAL = ['buyvalue', 'closingprice', 'closingvalue', 'unrealisedpl'] as const;
const HEADER_NAMES: Record<(typeof REQUIRED)[number], string> = {
  stockname: 'Stock Name',
  isin: 'ISIN',
  quantity: 'Quantity',
  averagebuyprice: 'Average buy price',
};

const MAX_NAME = 120;

/** The sheet holding the table, and where its header is. Best partial match if none is full. */
function locate(input: ParserInput): { sheet: Sheet; header: HeaderMatch } | null {
  let best: { sheet: Sheet; header: HeaderMatch } | null = null;
  for (const sheet of input.workbook?.().sheets ?? []) {
    const header = findHeaderRow(sheet, REQUIRED, OPTIONAL);
    if (header && (!best || header.found > best.header.found)) best = { sheet, header };
  }
  return best;
}

/** "Holdings statement for stocks as on 31-01-2026" → "2026-01-31". */
function statementDate(sheet: Sheet, headerRow: number): string | null {
  for (let r = 0; r < headerRow; r++) {
    for (const cell of sheet.rows[r] ?? []) {
      const text = cellText(cell);
      if (text.length > 200 || !labelKey(text).includes('ason')) continue;
      const m = /(\d{2}-\d{2}-\d{4})/.exec(text);
      const iso = m ? parseDate(m[1]!) : null;
      if (iso) return iso;
    }
  }
  return null;
}

export const growwHoldingsParser: Parser = {
  id: 'groww.holdings',
  version: '1.0.0',
  source: 'groww',
  kind: 'positions',
  label: 'Groww stocks holdings statement',
  extensions: ['.xlsx'],

  detect(input) {
    const at = locate(input);
    if (!at) return 0;
    if (at.header.found < REQUIRED.length) {
      // Recognisably a Groww-style table (name + ISIN) but incomplete: not confident enough.
      const c = at.header.columns;
      return c.stockname !== undefined && c.isin !== undefined ? 0.5 : 0;
    }
    const signed =
      valueBeside(at.sheet, 'uniqueclientcode') !== null ||
      statementDate(at.sheet, at.header.row) !== null;
    return signed ? 1 : 0.9;
  },

  explain(input) {
    const at = locate(input);
    if (!at || at.header.found === REQUIRED.length) return null;
    const c = at.header.columns;
    if (c.stockname === undefined || c.isin === undefined) return null;
    const missing = REQUIRED.filter((k) => c[k] === undefined).map((k) => HEADER_NAMES[k]);
    return `This looks like a Groww holdings statement, but these columns are missing: ${missing.join(', ')}. Download the statement again from Groww (Profile → Reports → Stocks → Holdings statement) without editing it`;
  },

  parse(input, ctx: ParseContext): NormalisedStatement {
    const at = locate(input);
    if (!at || at.header.found < REQUIRED.length) {
      throw new ImportError('MISSING_COLUMNS', 'The holdings table was not found in this file');
    }
    const { sheet, header } = at;
    const col = header.columns;
    const cell = (r: number, key: string) =>
      col[key] === undefined ? undefined : (sheet.rows[r]?.[col[key]] ?? undefined);

    const holdings: NormalisedHolding[] = [];
    const issues: RowIssue[] = [];
    const skipped: NormalisedStatement['skipped'] = [];
    const seen = new Set<string>();
    let totalRows = 0;
    let investedSum = new Decimal(0);
    let valueSum = new Decimal(0);
    let valueKnown = true;
    let rowMismatches = 0;

    for (let r = header.row + 1; r < sheet.rows.length; r++) {
      if (isBlankRow(sheet.rows[r])) continue;
      const line = r + 1;
      const name = cellText(cell(r, 'stockname'));
      const isin = cellText(cell(r, 'isin')).toUpperCase();
      const first = labelKey(name);
      if (isin === '' && (first === 'total' || first === 'grandtotal')) continue; // a totals row
      totalRows++;
      if (totalRows > ctx.maxRows) {
        throw new ImportError('TOO_MANY_ROWS', `A file can hold at most ${ctx.maxRows} rows`, {
          maxRows: ctx.maxRows,
        });
      }
      const bad = (field: string, message: string) => issues.push({ line, field, message });

      const quantity = cellDecimal(cell(r, 'quantity'));
      const average = cellDecimal(cell(r, 'averagebuyprice'));
      const before = issues.length;
      if (name === '') bad('Stock Name', 'The name is missing');
      if (!/^IN[A-Z0-9]{10}$/.test(isin)) bad('ISIN', 'This is not a valid Indian ISIN');
      else if (seen.has(isin)) bad('ISIN', 'This ISIN is listed more than once in the file');
      if (quantity === 'empty') bad('Quantity', 'The quantity is missing');
      else if (quantity === 'invalid' || quantity.isNegative()) {
        bad('Quantity', 'The quantity is not a valid number');
      }
      if (average === 'empty') bad('Average buy price', 'The average buy price is missing');
      else if (average === 'invalid' || average.isNegative()) {
        bad('Average buy price', 'The average buy price is not a valid number');
      }
      if (issues.length > before) continue;
      // narrowed: both are Decimals from here on
      const qty = quantity as Decimal;
      const avg = average as Decimal;
      if (qty.gt('1e12') || avg.gt('1e12')) {
        bad('Quantity', 'That number is too large');
        continue;
      }
      if (qty.isZero()) {
        skipped.push({ line, reason: 'The quantity is zero' });
        continue;
      }
      seen.add(isin);

      const warnings: string[] = [];
      const computed = qty.times(avg);
      const buyValue = cellDecimal(cell(r, 'buyvalue'));
      let invested = computed;
      if (buyValue !== 'empty' && buyValue !== 'invalid' && !buyValue.isNegative()) {
        invested = buyValue;
        if (buyValue.minus(computed).abs().gt('0.05')) {
          rowMismatches++;
          warnings.push(
            'Buy value in the file differs from quantity × average buy price; the file’s buy value is used',
          );
        }
      }
      investedSum = investedSum.plus(invested);

      const closing = cellDecimal(cell(r, 'closingprice'));
      const closingOk = closing !== 'empty' && closing !== 'invalid' && closing.gt(0);
      const closingValue = cellDecimal(cell(r, 'closingvalue'));
      if (closingValue !== 'empty' && closingValue !== 'invalid') {
        valueSum = valueSum.plus(closingValue);
      } else if (closingOk) valueSum = valueSum.plus(qty.times(closing));
      else valueKnown = false;

      holdings.push({
        line,
        assetClass: 'IN_EQUITY',
        // INF… ISINs are fund units; on a stock statement those are exchange-traded funds.
        instrumentType: isin.startsWith('INF') ? 'ETF' : 'STOCK',
        name: name.length > MAX_NAME ? name.slice(0, MAX_NAME) : name,
        isin,
        quantity: fixed(qty, 8),
        avgBuyPrice: fixed(avg, 4),
        investedAmount: fixed(invested, 2),
        currency: 'INR',
        ...(closingOk ? { statementPrice: fixed(closing, 4) } : {}),
        warnings,
      });
    }

    if (holdings.length === 0 && issues.length === 0) {
      throw new ImportError('NO_HOLDINGS', 'This statement lists no holdings');
    }

    const notes: string[] = [];
    let date = statementDate(sheet, header.row);
    if (!date || date > ctx.today) {
      notes.push('The statement date was not found in the file, so today is used');
      date = ctx.today;
    }

    return {
      parser: `${this.id}@${this.version}`,
      source: this.source,
      kind: 'positions',
      label: 'Groww',
      account: 'groww',
      statementDate: date,
      holdings,
      issues,
      skipped,
      notes,
      totalRows,
      reconciliation: [
        {
          id: 'rows',
          label: 'Rows',
          status: issues.length === 0 ? 'ok' : 'warning',
          detail:
            issues.length === 0
              ? 'Every row in the table was read'
              : 'Some rows could not be read and are listed under "Needs attention"',
        },
        reconcileTotal({
          id: 'invested',
          label: 'Invested value',
          fileTotal: cellDecimal(valueBeside(sheet, 'investedvalue')),
          rowsTotal: investedSum,
          rows: totalRows,
          currency: 'INR',
        }),
        valueKnown
          ? reconcileTotal({
              id: 'value',
              label: 'Closing value',
              fileTotal: cellDecimal(valueBeside(sheet, 'closingvalue')),
              rowsTotal: valueSum,
              rows: totalRows,
              currency: 'INR',
            })
          : {
              id: 'value',
              label: 'Closing value',
              status: 'not-available',
              detail: 'Some rows have no closing price, so the total cannot be checked',
            },
        {
          id: 'row-values',
          label: 'Row arithmetic',
          status: rowMismatches === 0 ? 'ok' : 'warning',
          detail:
            rowMismatches === 0
              ? 'Quantity × average buy price matches the buy value on every row'
              : 'On some rows the buy value does not equal quantity × average buy price',
        },
      ],
    };
  },
};
