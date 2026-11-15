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
import { cellDecimal, Decimal, fixed, parseDayMonthName } from './statement-utils';
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
 * INDmoney US stocks "Holdings report" (.xls). Documented in docs/parsers/indmoney-us-holdings.md.
 * US tickers with fractional quantities, in US dollars. A snapshot with a first-purchase date per
 * holding, but no trades, names, ISINs or current prices.
 */

// Header cells as letters-and-digits keys ("Avg. Price ($)" → "avgprice").
const REQUIRED = ['stocksymbol', 'holdingsince', 'quantity', 'avgprice'] as const;
const OPTIONAL = ['totalvalue'] as const;
const HEADER_NAMES: Record<(typeof REQUIRED)[number], string> = {
  stocksymbol: 'Stock Symbol',
  holdingsince: 'Holding Since',
  quantity: 'Quantity',
  avgprice: 'Avg. Price ($)',
};

/** Fractional shares are tracked to 8 decimal places; anything smaller is a closed position. */
const QUANTITY_PLACES = 8;
const DUST = new Decimal('0.000001');
const PRICE_PLACES = 6;

function locate(input: ParserInput): { sheet: Sheet; header: HeaderMatch } | null {
  let best: { sheet: Sheet; header: HeaderMatch } | null = null;
  for (const sheet of input.workbook?.().sheets ?? []) {
    const header = findHeaderRow(sheet, REQUIRED, OPTIONAL);
    if (header && (!best || header.found > best.header.found)) best = { sheet, header };
  }
  return best;
}

export const indmoneyUsHoldingsParser: Parser = {
  id: 'indmoney.us-holdings',
  version: '1.0.0',
  source: 'indmoney',
  kind: 'positions',
  label: 'INDmoney US stocks holdings report',
  extensions: ['.xls'],

  detect(input) {
    const at = locate(input);
    if (!at) return 0;
    const c = at.header.columns;
    if (at.header.found < REQUIRED.length) {
      return c.stocksymbol !== undefined && c.holdingsince !== undefined ? 0.5 : 0;
    }
    const signed =
      valueBeside(at.sheet, 'brokername') !== null ||
      valueBeside(at.sheet, 'holdingsason') !== null;
    return signed ? 1 : 0.9;
  },

  explain(input) {
    const at = locate(input);
    if (!at || at.header.found === REQUIRED.length) return null;
    const c = at.header.columns;
    if (c.stocksymbol === undefined || c.holdingsince === undefined) return null;
    const missing = REQUIRED.filter((k) => c[k] === undefined).map((k) => HEADER_NAMES[k]);
    return `This looks like an INDmoney US holdings report, but these columns are missing: ${missing.join(', ')}. Download the report again from INDmoney without editing it`;
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

    const notes: string[] = [];
    const asOn = valueBeside(sheet, 'holdingsason');
    let date = asOn && asOn.t === 's' ? parseDate(asOn.v) : null;
    if (!date || date > ctx.today) {
      notes.push('The statement date was not found in the file, so today is used');
      date = ctx.today;
    }

    const holdings: NormalisedHolding[] = [];
    const issues: RowIssue[] = [];
    const skipped: NormalisedStatement['skipped'] = [];
    const seen = new Set<string>();
    let totalRows = 0;
    let totalChecked = 0;
    let totalMismatches = 0;

    for (let r = header.row + 1; r < sheet.rows.length; r++) {
      if (isBlankRow(sheet.rows[r])) continue;
      const line = r + 1;
      const raw = cellText(cell(r, 'stocksymbol'));
      // The table ends where the notes begin ("Disclaimer:-", then lines starting with "*").
      if (labelKey(raw).startsWith('disclaimer')) break;
      if (raw.startsWith('*')) continue;
      totalRows++;
      if (totalRows > ctx.maxRows) {
        throw new ImportError('TOO_MANY_ROWS', `A file can hold at most ${ctx.maxRows} rows`, {
          maxRows: ctx.maxRows,
        });
      }
      const bad = (field: string, message: string) => issues.push({ line, field, message });

      const symbol = raw.toUpperCase();
      const quantity = cellDecimal(cell(r, 'quantity'));
      const average = cellDecimal(cell(r, 'avgprice'));
      const before = issues.length;
      if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) {
        bad('Stock Symbol', 'This is not a valid US ticker');
      } else if (seen.has(symbol)) {
        bad('Stock Symbol', 'This ticker is listed more than once in the file');
      }
      if (quantity === 'empty') bad('Quantity', 'The quantity is missing');
      else if (quantity === 'invalid' || quantity.isNegative()) {
        bad('Quantity', 'The quantity is not a valid number');
      }
      if (average === 'empty') bad('Avg. Price ($)', 'The average price is missing');
      else if (average === 'invalid' || average.isNegative()) {
        bad('Avg. Price ($)', 'The average price is not a valid number');
      }
      if (issues.length > before) continue;
      const qty = (quantity as Decimal).toDecimalPlaces(QUANTITY_PLACES);
      const avg = (average as Decimal).toDecimalPlaces(PRICE_PLACES);
      if (qty.gt('1e12') || avg.gt('1e12')) {
        bad('Quantity', 'That number is too large');
        continue;
      }
      if (qty.lt(DUST)) {
        skipped.push({
          line,
          reason: (quantity as Decimal).isZero()
            ? 'The quantity is zero'
            : 'A closed position: less than 0.000001 of a share is left',
        });
        continue;
      }
      seen.add(symbol);

      const warnings: string[] = [];
      const invested = qty.times(avg);

      // "Total Value ($)" is the cost in most rows. Where it is not, the row is flagged and
      // quantity × average price is used, which is what the position actually cost.
      const total = cellDecimal(cell(r, 'totalvalue'));
      if (total !== 'empty' && total !== 'invalid') {
        totalChecked++;
        const scale = Decimal.max(invested.abs(), new Decimal('0.01'));
        if (total.minus(invested).abs().div(scale).gt('0.01')) {
          totalMismatches++;
          warnings.push(
            'Total Value in the file differs from quantity × average price; Kosh uses quantity × average price',
          );
        }
      }

      let acquiredOn = parseDayMonthName(cellText(cell(r, 'holdingsince')));
      if (acquiredOn && parseDate(acquiredOn) === null) acquiredOn = null;
      if (!acquiredOn || acquiredOn > date) {
        warnings.push('Holding Since could not be read, so the statement date is used instead');
        acquiredOn = date;
      }

      holdings.push({
        line,
        assetClass: 'US_EQUITY',
        instrumentType: 'STOCK',
        name: symbol, // the file has no company name; it is looked up with the first price
        symbol,
        quantity: fixed(qty, QUANTITY_PLACES),
        avgBuyPrice: fixed(avg, PRICE_PLACES),
        investedAmount: fixed(invested, PRICE_PLACES),
        currency: 'USD',
        acquiredOn,
        warnings,
      });
    }

    if (holdings.length === 0 && issues.length === 0) {
      throw new ImportError('NO_HOLDINGS', 'This report lists no holdings');
    }

    return {
      parser: `${this.id}@${this.version}`,
      source: this.source,
      kind: 'positions',
      label: 'INDmoney (US stocks)',
      account: 'indmoney-us',
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
        {
          id: 'invested',
          label: 'Invested value',
          status: 'not-available',
          detail: 'This report has no totals to compare with',
        },
        {
          id: 'row-values',
          label: 'Row arithmetic',
          status: totalChecked === 0 ? 'not-available' : totalMismatches === 0 ? 'ok' : 'warning',
          detail:
            totalChecked === 0
              ? 'The file has no Total Value column to check'
              : totalMismatches === 0
                ? 'Total Value matches quantity × average price on every row'
                : 'On some rows Total Value does not equal quantity × average price; those rows are marked',
        },
      ],
    };
  },
};
