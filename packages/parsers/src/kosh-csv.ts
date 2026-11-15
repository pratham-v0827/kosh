import { InstrumentInput, TransactionInput } from '@kosh/contracts';
import { type AssetClass, ASSET_CLASSES, type Currency } from '@kosh/core';
import { ImportError } from './errors';
import { decodeText, firstLine, headerKey, parseCsv } from './text';
import type {
  ImportTxnType,
  NormalisedImport,
  NormalisedRow,
  ParseContext,
  Parser,
  ParserInput,
  RowIssue,
} from './types';
import { parseDate, parseDecimal, parseRatio } from './values';

/**
 * Kosh's own CSV template (documented in docs/parsers/kosh-csv.md). It lets people bring in
 * history from any source by filling a spreadsheet, and it is the reference parser for the
 * import framework.
 */
export const KOSH_CSV_COLUMNS = [
  'date',
  'type',
  'asset_class',
  'name',
  'symbol',
  'exchange',
  'quantity',
  'price',
  'fees',
  'amount',
  'ratio',
  'fx_rate',
  'reference',
  'note',
] as const;

const REQUIRED = ['date', 'type', 'asset_class', 'name'] as const;

const TYPES: Record<string, ImportTxnType> = {
  buy: 'BUY',
  sell: 'SELL',
  dividend: 'DIVIDEND',
  fee: 'FEE',
  split: 'SPLIT',
  bonus: 'BONUS',
};

const ASSET_CLASS_ALIASES: Record<string, AssetClass> = {
  in_equity: 'IN_EQUITY',
  indian_stock: 'IN_EQUITY',
  indian_stocks: 'IN_EQUITY',
  us_equity: 'US_EQUITY',
  us_stock: 'US_EQUITY',
  us_stocks: 'US_EQUITY',
  mutual_fund: 'MUTUAL_FUND',
  mutual_funds: 'MUTUAL_FUND',
  mf: 'MUTUAL_FUND',
  unlisted: 'UNLISTED',
  crypto: 'CRYPTO',
};

const currencyOf = (c: AssetClass): Currency => (c === 'US_EQUITY' ? 'USD' : 'INR');

function header(input: ParserInput): string[] {
  return firstLine(input.bytes).split(',').map(headerKey);
}

function normaliseRow(
  line: number,
  c: Record<string, string>,
  ctx: ParseContext,
): { row?: NormalisedRow; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const bad = (field: string, message: string) => issues.push({ line, field, message });
  const cell = (k: string) => c[k] ?? '';

  const tradeDate = parseDate(cell('date'));
  if (!tradeDate) bad('date', 'Use a date like 2025-03-14 or 14-03-2025');
  else if (tradeDate > ctx.today) bad('date', 'Date cannot be in the future');

  const type = TYPES[cell('type').toLowerCase()];
  if (!type) bad('type', 'Use buy, sell, dividend, fee, split or bonus');

  const assetClass: AssetClass | undefined =
    ASSET_CLASS_ALIASES[headerKey(cell('asset_class'))] ??
    ASSET_CLASSES.find((a) => a === cell('asset_class').toUpperCase());
  if (!assetClass) {
    bad('asset_class', 'Use in_equity, us_equity, mutual_fund, unlisted or crypto');
  }

  // Optional number: blank is fine, anything else must be a plain non-negative number.
  const number = (field: string): string | undefined => {
    const raw = cell(field);
    if (raw === '') return undefined;
    const v = parseDecimal(raw);
    if (v === null) bad(field, 'Use a plain number like 2410.50');
    return v ?? undefined;
  };
  const qty = number('quantity');
  const price = number('price');
  const fees = number('fees');
  const amount = number('amount');
  const fxRate = number('fx_rate');
  const ratio = cell('ratio') === '' ? undefined : parseRatio(cell('ratio'));
  if (ratio === null) bad('ratio', 'Use a ratio like 1:5');

  if (issues.length > 0 || !tradeDate || !type || !assetClass) return { issues };

  // Same schemas as the manual-entry API: identical bounds, symbol rules and messages.
  const exchange = cell('exchange').toUpperCase();
  const instrument = InstrumentInput.safeParse({
    name: cell('name'),
    assetClass,
    symbol: cell('symbol'),
    ...(exchange ? { exchange } : {}),
  });
  if (!instrument.success) {
    for (const i of instrument.error.issues) {
      bad(String(i.path[0] ?? 'name'), i.message);
    }
  }
  const txn = TransactionInput.safeParse({
    type,
    instrumentId: 'pending',
    tradeDate,
    qty,
    price,
    fees,
    amount,
    ratio: ratio ?? undefined,
    fxRate,
    note: cell('note') || undefined,
  });
  if (!txn.success) {
    const names: Record<string, string> = { qty: 'quantity', fxRate: 'fx_rate', tradeDate: 'date' };
    for (const i of txn.error.issues) {
      const key = String(i.path[0] ?? 'type');
      const missing = i.code === 'invalid_type';
      bad(names[key] ?? key, missing ? `Required for a ${type.toLowerCase()} row` : i.message);
    }
  }
  if (!instrument.success || !txn.success) return { issues };

  const t = txn.data;
  const reference = cell('reference').slice(0, 60);
  return {
    issues,
    row: {
      line,
      instrument: {
        assetClass,
        name: instrument.data.name,
        ...(instrument.data.symbol ? { symbol: instrument.data.symbol } : {}),
        ...(instrument.data.exchange ? { exchange: instrument.data.exchange } : {}),
      },
      type,
      tradeDate,
      currency: currencyOf(assetClass),
      ...('qty' in t ? { qty: t.qty, price: t.price } : {}),
      ...('fees' in t && t.fees ? { fees: t.fees } : {}),
      ...('amount' in t ? { amount: t.amount } : {}),
      ...('ratio' in t ? { ratio: t.ratio } : {}),
      ...('fxRate' in t && t.fxRate && assetClass === 'US_EQUITY' ? { fxRate: t.fxRate } : {}),
      ...(reference ? { brokerRef: reference } : {}),
      ...(t.note ? { note: t.note } : {}),
    },
  };
}

export const koshCsvParser: Parser = {
  id: 'kosh.csv',
  version: '1.0.0',
  source: 'kosh',
  kind: 'transactions',
  label: 'Kosh CSV template (any source)',
  extensions: ['.csv'],

  detect(input) {
    const cols = new Set(header(input));
    if (!REQUIRED.every((r) => cols.has(r))) return 0;
    // The required four are common words; the template's own columns make it certain.
    const own = ['asset_class', 'quantity', 'fx_rate', 'reference'].filter((k) => cols.has(k));
    return own.length >= 2 ? 1 : 0.6;
  },

  parse(input, ctx): NormalisedImport {
    const table = parseCsv(decodeText(input.bytes), ctx.maxRows);
    const missing = REQUIRED.filter((r) => !table.header.includes(r));
    if (missing.length > 0) {
      throw new ImportError('MISSING_COLUMNS', `Missing column(s): ${missing.join(', ')}`, {
        missing,
      });
    }
    const rows: NormalisedRow[] = [];
    const issues: RowIssue[] = [];
    for (const r of table.rows) {
      const out = normaliseRow(r.line, r.cells, ctx);
      if (out.row) rows.push(out.row);
      issues.push(...out.issues);
    }
    return {
      parser: `${this.id}@${this.version}`,
      source: this.source,
      kind: 'transactions',
      rows,
      issues,
      totalRows: table.rows.length,
    };
  },
};
