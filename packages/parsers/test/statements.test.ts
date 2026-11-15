// Holdings-statement parsers (Groww, INDmoney US), tested on INVENTED fixtures that mirror the
// layout of the real exports. See docs/parsers/m3-holdings-spec.md.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectAll,
  growwHoldingsParser,
  ImportError,
  indmoneyUsHoldingsParser,
  MAX_IMPORT_ROWS,
  type NormalisedStatement,
  type ParserInput,
  readWorkbook,
  runImport,
  supportedFormats,
} from '../src';
import {
  GROWW_HEADER,
  GROWW_ROWS,
  GROWW_SHEET_NAME,
  growwSheet,
  type GrowwSheetOptions,
  growwTableRow,
  INDMONEY_HEADER,
  INDMONEY_ROWS,
  INDMONEY_SHEET_NAME,
  indmoneySheet,
  type IndmoneySheetOptions,
  indmoneyTableRow,
} from './support/fixture-data';
import { writeXls } from './support/write-xls';
import { writeXlsx } from './support/write-xlsx';

const ctx = { today: '2026-11-14', maxRows: MAX_IMPORT_ROWS };
const fixture = (...p: string[]) => readFileSync(resolve(import.meta.dirname, '../fixtures', ...p));
// Parsers are normally handed the opened workbook by the registry; do the same here so that
// they can also be called directly.
const input = (bytes: Uint8Array): ParserInput => ({
  bytes,
  fileName: 'upload.bin',
  workbook: () => readWorkbook(bytes),
});

/** Parse and insist on a holdings statement. */
const statement = (bytes: Uint8Array, c = ctx): NormalisedStatement => {
  const result = runImport(input(bytes), c);
  if (result.kind !== 'positions') throw new Error('expected a holdings statement');
  return result;
};
const failure = (bytes: Uint8Array, c = ctx): ImportError => {
  try {
    runImport(input(bytes), c);
  } catch (e) {
    if (e instanceof ImportError) return e;
    throw e;
  }
  throw new Error('expected an ImportError');
};
const check = (s: NormalisedStatement, id: string) => s.reconciliation.find((c) => c.id === id)!;

const groww = (o: GrowwSheetOptions = {}) =>
  writeXlsx([{ name: GROWW_SHEET_NAME, rows: growwSheet(o) }]);
const indmoney = (o: IndmoneySheetOptions = {}) =>
  writeXls([{ name: INDMONEY_SHEET_NAME, rows: indmoneySheet(o) }]);
/** One Groww table row with some cells replaced. */
const growwRow = (overrides: Record<number, string | number | null> = {}) => {
  const row = growwTableRow(GROWW_ROWS[0]!);
  for (const [i, v] of Object.entries(overrides)) row[Number(i)] = v;
  return row;
};
const indmoneyRow = (overrides: Record<number, string | number | null> = {}) => {
  const row = indmoneyTableRow(INDMONEY_ROWS[0]!);
  for (const [i, v] of Object.entries(overrides)) row[Number(i)] = v;
  return row;
};

describe('registry', () => {
  it('lists the holdings formats with their kind', () => {
    expect(supportedFormats().map((f) => [f.id, f.kind, f.extensions])).toEqual([
      ['kosh.csv', 'transactions', ['.csv']],
      ['groww.holdings', 'positions', ['.xlsx']],
      ['indmoney.us-holdings', 'positions', ['.xls']],
    ]);
  });

  it('each parser claims its own fixture and no other', () => {
    const files = {
      'groww.holdings': fixture('groww-holdings', 'holdings.xlsx'),
      'indmoney.us-holdings': fixture('indmoney-us-holdings', 'holdings.xls'),
      'kosh.csv': fixture('kosh-csv', 'sample.csv'),
    };
    for (const [owner, bytes] of Object.entries(files)) {
      for (const d of detectAll(input(bytes))) {
        if (d.parserId === owner)
          expect(d.confidence, `${owner} on its own file`).toBeGreaterThanOrEqual(0.8);
        else expect(d.confidence, `${d.parserId} on ${owner}'s file`).toBeLessThan(0.2);
      }
    }
  });

  it('detects by content: the file name and extension are ignored', () => {
    // INDmoney's layout saved as .xlsx, and Groww's saved as .xls, are still recognised
    const asXlsx = writeXlsx([{ name: 'Anything', rows: indmoneySheet() }]);
    expect(statement(asXlsx).parser).toBe('indmoney.us-holdings@1.0.0');
    const asXls = writeXls([{ name: 'Anything', rows: growwSheet() }]);
    expect(statement(asXls).parser).toBe('groww.holdings@1.0.0');
  });

  it('gives a specific, helpful error for files it cannot use', () => {
    const pdf = failure(new TextEncoder().encode('%PDF-1.7\n…'));
    expect([pdf.code, pdf.message]).toEqual([
      'UNKNOWN_FORMAT',
      'PDF statements are not supported yet. Use an Excel or CSV export, or the Kosh CSV template',
    ]);
    const other = failure(
      writeXlsx([
        {
          name: 'S',
          rows: [
            ['Some', 'other'],
            ['sheet', 1],
          ],
        },
      ]),
    );
    expect(other.code).toBe('UNKNOWN_FORMAT');
    expect(other.message).toMatch(/not a statement Kosh can read yet/);
    expect(other.details?.supported).toHaveLength(3);
    expect(failure(writeXlsx([{ name: 'S', rows: [] }])).code).toBe('UNKNOWN_FORMAT'); // empty sheet
    expect(failure(new TextEncoder().encode('just some text\n')).message).toMatch(
      /does not recognise this file/,
    );
    // an Excel file that cannot be opened says why, instead of "unknown format"
    expect(failure(groww().slice(0, 60)).code).toBe('CORRUPT_FILE');
    expect(
      failure(writeXlsx([{ name: 'S', rows: growwSheet() }], { encryptedFlag: true })).code,
    ).toBe('ENCRYPTED_FILE');
    expect(
      failure(writeXls([{ name: 'S', rows: indmoneySheet() }], { encrypted: true })).message,
    ).toMatch(/password-protected/);
  });

  it('explains a near miss by naming the missing columns', () => {
    const header = GROWW_HEADER.filter((h) => h !== 'Average buy price' && h !== 'Quantity');
    const e = failure(groww({ header, tableRows: [['X LTD', 'INE000A01000', 1, 2, 3, 4]] }));
    expect(e.code).toBe('UNKNOWN_FORMAT');
    expect(e.message).toMatch(/looks like a Groww holdings statement/);
    expect(e.message).toMatch(/Quantity, Average buy price/);
    expect(e.message).not.toContain('X LTD');

    const usHeader = INDMONEY_HEADER.filter((h) => h !== 'Quantity');
    const us = failure(
      indmoney({ header: usHeader, tableRows: [['AAA', '01 Jan 2024, 10:00 AM', 5, 5]] }),
    );
    expect(us.message).toMatch(/looks like an INDmoney US holdings report/);
    expect(us.message).toMatch(/Quantity/);
    // a table that shares only one column name is not "almost" either format
    expect(
      growwHoldingsParser.explain!(input(writeXlsx([{ name: 'S', rows: [['ISIN']] }]))),
    ).toBeNull();
    expect(indmoneyUsHoldingsParser.explain!(input(groww()))).toBeNull();
    expect(growwHoldingsParser.explain!(input(groww()))).toBeNull(); // a full match needs no hint
  });
});

describe('groww.holdings', () => {
  const s = statement(fixture('groww-holdings', 'holdings.xlsx'));

  it('reads the committed fixture (snapshot)', () => {
    expect(s).toMatchObject({
      parser: 'groww.holdings@1.0.0',
      source: 'groww',
      kind: 'positions',
      label: 'Groww',
      account: 'groww',
      statementDate: '2026-10-31',
      totalRows: GROWW_ROWS.length,
      issues: [],
      skipped: [],
      notes: [],
    });
    expect(s.holdings).toHaveLength(GROWW_ROWS.length);
    expect(s).toMatchSnapshot();
  });

  it('the committed fixture is what the fixture script produces from the invented data', () => {
    expect(statement(groww())).toEqual(s);
  });

  it('maps a row exactly, as decimal strings', () => {
    expect(s.holdings[0]).toEqual({
      line: 12,
      assetClass: 'IN_EQUITY',
      instrumentType: 'STOCK',
      name: 'BHARAT PETROLEUM CORP LT',
      isin: 'INE029A01011',
      quantity: '37',
      avgBuyPrice: '318.46',
      investedAmount: '11783.02',
      currency: 'INR',
      statementPrice: '341.85',
      warnings: [],
    });
    expect(s.holdings.find((h) => h.name === 'Grasim Industries Limited')).toBeDefined(); // case kept
  });

  it('classifies fund units (INF…) as exchange-traded funds', () => {
    expect(s.holdings.filter((h) => h.instrumentType === 'ETF').map((h) => h.isin)).toEqual([
      'INF200KA1FS1',
      'INF732E01037',
    ]);
  });

  it('reconciles with the summary in the file, within rounding', () => {
    expect(check(s, 'rows').status).toBe('ok');
    const invested = check(s, 'invested');
    expect(invested.status).toBe('ok');
    expect(invested.detail).toBe('The rows add up to the total in the file, within rounding');
    // the summary uses unrounded averages, so a small gap is expected and shown
    expect(Number(invested.difference)).toBeGreaterThan(0);
    expect(Number(invested.difference)).toBeLessThan(GROWW_ROWS.length);
    expect(check(s, 'value')).toMatchObject({ status: 'ok', difference: '0' });
    expect(check(s, 'row-values').status).toBe('ok');
  });

  it('never carries the account holder name or client code', () => {
    const json = JSON.stringify(s);
    expect(json).not.toContain('Asha Example');
    expect(json).not.toContain('0000000000');
  });

  it('tolerates reordered and extra columns', () => {
    const order = [1, 0, 7, 2, 3, 6, 5, 4]; // ISIN first, values shuffled
    const header = ['Sr. No.', ...order.map((i) => GROWW_HEADER[i]!), 'Sector'];
    const tableRows = GROWW_ROWS.map((r, n) => {
      const row = growwTableRow(r);
      return [n + 1, ...order.map((i) => row[i]!), 'Some sector'];
    });
    const shuffled = statement(groww({ header, tableRows }));
    expect(shuffled.holdings).toEqual(s.holdings);
    expect(check(shuffled, 'invested').status).toBe('ok');
  });

  it('reads a single holding, and fractional quantities', () => {
    const one = statement(groww({ rows: [GROWW_ROWS[0]!] }));
    expect(one.holdings).toHaveLength(1);
    const fractional = statement(groww({ tableRows: [growwRow({ 2: 2.5, 4: 796.15 })] }));
    expect(fractional.holdings[0]).toMatchObject({ quantity: '2.5', investedAmount: '796.15' });
  });

  it('accepts numbers typed as text, in Indian and accounting styles', () => {
    const typed = statement(
      groww({
        tableRows: [
          growwRow({ 2: '1,200', 3: '₹ 318.46', 4: '3,82,152.00', 5: '341.85', 6: null }),
        ],
      }),
    );
    expect(typed.holdings[0]).toMatchObject({
      quantity: '1200',
      avgBuyPrice: '318.46',
      investedAmount: '382152',
      statementPrice: '341.85',
    });
    expect(check(typed, 'row-values').status).toBe('ok');
  });

  it('skips zero-quantity rows and totals rows, and says so', () => {
    const out = statement(
      groww({
        tableRows: [
          growwRow(),
          growwRow({ 0: 'SOLD OUT LTD', 1: 'INE000A01000', 2: 0, 4: 0, 6: 0, 7: 0 }),
          ['Total', null, null, null, 11783.02, null, 12648.45, 865.43],
          ['Grand Total', null, null, null, 11783.02],
        ],
      }),
    );
    expect(out.holdings).toHaveLength(1);
    expect(out.skipped).toEqual([{ line: 13, reason: 'The quantity is zero' }]);
    expect(out.totalRows).toBe(2);
    expect(out.issues).toEqual([]);
  });

  it('sets aside rows with damaged cells and keeps the good ones', () => {
    const out = statement(
      groww({
        tableRows: [
          growwRow(),
          growwRow({ 1: 'INE000A01001', 2: 'abc' }),
          growwRow({ 1: 'NOTANISIN' }),
          growwRow({ 1: 'INE000A01003', 2: -5 }),
          growwRow({ 1: 'INE000A01004', 3: null }),
          growwRow({ 0: '', 1: 'INE000A01005' }),
          growwRow(), // the same ISIN again
          growwRow({ 1: 'INE000A01007', 2: 5e13 }),
          growwRow({ 1: 'INE000A01008', 2: null, 3: 'n/a' }),
          growwRow({ 1: 'INE000A01009', 3: -1 }),
          growwRow({ 1: 'INE000A01010', 2: true as unknown as number }),
        ],
      }),
    );
    expect(out.holdings.map((h) => h.line)).toEqual([12]);
    expect(out.issues.map((i) => [i.line, i.field, i.message])).toEqual([
      [13, 'Quantity', 'The quantity is not a valid number'],
      [14, 'ISIN', 'This is not a valid Indian ISIN'],
      [15, 'Quantity', 'The quantity is not a valid number'],
      [16, 'Average buy price', 'The average buy price is missing'],
      [17, 'Stock Name', 'The name is missing'],
      [18, 'ISIN', 'This ISIN is listed more than once in the file'],
      [19, 'Quantity', 'That number is too large'],
      [20, 'Quantity', 'The quantity is missing'],
      [20, 'Average buy price', 'The average buy price is missing'],
      [21, 'Average buy price', 'The average buy price is not a valid number'],
      [22, 'Quantity', 'The quantity is not a valid number'],
    ]);
    expect(check(out, 'rows').status).toBe('warning');
    expect(out.totalRows).toBe(11);
  });

  it('keeps formula-looking text as plain text and cuts very long names', () => {
    const danger = '=HYPERLINK("http://evil.example","click")';
    const out = statement(
      groww({
        tableRows: [growwRow({ 0: danger }), growwRow({ 0: 'N'.repeat(300), 1: 'INE000A01001' })],
      }),
    );
    expect(out.holdings[0]!.name).toBe(danger);
    expect(out.holdings[1]!.name).toHaveLength(120);
  });

  it('flags a buy value that does not match quantity × average price', () => {
    const out = statement(groww({ tableRows: [growwRow({ 4: 12000 })] }));
    expect(out.holdings[0]!.investedAmount).toBe('12000'); // the file's own figure is kept
    expect(out.holdings[0]!.warnings).toHaveLength(1);
    expect(check(out, 'row-values').status).toBe('warning');
  });

  it('computes cost when there is no Buy value column, and copes without closing prices', () => {
    const header = ['Stock Name', 'ISIN', 'Quantity', 'Average buy price'];
    const out = statement(groww({ header, tableRows: [['X LTD', 'INE000A01000', 3, 100.555]] }));
    expect(out.holdings[0]).toMatchObject({ investedAmount: '301.67', avgBuyPrice: '100.555' });
    expect(out.holdings[0]).not.toHaveProperty('statementPrice');
    expect(check(out, 'value').status).toBe('not-available');
    // closing price present but no closing value column: the value is computed for the check
    const partial = statement(
      groww({
        header: [...header, 'Closing price'],
        tableRows: [['X LTD', 'INE000A01000', 3, 100, 110]],
      }),
    );
    expect(partial.holdings[0]!.statementPrice).toBe('110');
  });

  it('reports a summary that does not match the rows, and a missing summary', () => {
    const off = statement(groww({ investedValue: 999999 }));
    expect(check(off, 'invested')).toMatchObject({
      status: 'warning',
      detail: 'The rows do not add up to the total in the file',
      fileTotal: '999999',
    });
    const none = statement(groww({ noSummary: true }));
    expect(check(none, 'invested').status).toBe('not-available');
    expect(check(none, 'value').status).toBe('not-available');
    // without the summary block the table starts higher up; everything else is identical
    const withoutLine = (list: NormalisedStatement['holdings']) =>
      list.map((h) => ({ ...h, line: 0 }));
    expect(withoutLine(none.holdings)).toEqual(withoutLine(s.holdings));
  });

  it('uses today, with a note, when the statement date is missing or in the future', () => {
    for (const asOn of ['99-99-9999', '31-12-2026']) {
      const out = statement(groww({ asOn }));
      expect(out.statementDate).toBe('2026-11-14');
      expect(out.notes).toEqual(['The statement date was not found in the file, so today is used']);
    }
  });

  it('refuses a statement with no holdings, and one with too many rows', () => {
    expect(failure(groww({ tableRows: [] })).code).toBe('NO_HOLDINGS');
    expect(failure(groww(), { ...ctx, maxRows: 3 }).code).toBe('TOO_MANY_ROWS');
    expect(() => growwHoldingsParser.parse(input(indmoney()), ctx)).toThrow(/table was not found/);
  });
});

describe('indmoney.us-holdings', () => {
  const s = statement(fixture('indmoney-us-holdings', 'holdings.xls'));
  const by = (symbol: string) => s.holdings.find((h) => h.symbol === symbol)!;

  it('reads the committed fixture (snapshot)', () => {
    expect(s).toMatchObject({
      parser: 'indmoney.us-holdings@1.0.0',
      source: 'indmoney',
      kind: 'positions',
      label: 'INDmoney (US stocks)',
      account: 'indmoney-us',
      statementDate: '2026-10-31',
      totalRows: INDMONEY_ROWS.length,
      issues: [],
      notes: [],
    });
    expect(s.holdings).toHaveLength(INDMONEY_ROWS.length - 1);
    expect(s).toMatchSnapshot();
  });

  it('the committed fixture is what the fixture script produces from the invented data', () => {
    expect(statement(indmoney())).toEqual(s);
  });

  it('turns noisy binary numbers into clean decimals', () => {
    expect(by('ORCL')).toEqual({
      line: 9,
      assetClass: 'US_EQUITY',
      instrumentType: 'STOCK',
      name: 'ORCL',
      symbol: 'ORCL',
      quantity: '3.25817364',
      avgBuyPrice: '104.338292', // 104.3382915527 rounded half-up to 6 places
      investedAmount: '339.952273', // 3.25817364 × 104.338292, in decimal arithmetic
      currency: 'USD',
      acquiredOn: '2023-03-14',
      warnings: [],
    });
    expect(by('ADBE').quantity).toBe('3.3'); // stored as 3.3000000000000003
    expect(by('META').quantity).toBe('0.8'); // stored as 0.7999999999999999
    expect(by('BF.B')).toMatchObject({
      symbol: 'BF.B',
      investedAmount: '75',
      acquiredOn: '2022-02-17',
    });
    for (const h of s.holdings) {
      for (const v of [h.quantity, h.avgBuyPrice, h.investedAmount])
        expect(v).toMatch(/^\d+(\.\d+)?$/);
    }
  });

  it('skips a closed position left as a rounding crumb', () => {
    expect(s.skipped).toEqual([
      { line: 17, reason: 'A closed position: less than 0.000001 of a share is left' },
    ]);
    expect(s.holdings.map((h) => h.symbol)).not.toContain('T');
  });

  it('flags the row whose Total Value disagrees, and uses quantity × average price', () => {
    expect(by('BA')).toMatchObject({ investedAmount: '478.5' });
    expect(by('BA').warnings).toEqual([
      'Total Value in the file differs from quantity × average price; Kosh uses quantity × average price',
    ]);
    expect(s.holdings.filter((h) => h.warnings.length > 0)).toHaveLength(1);
    expect(check(s, 'row-values').status).toBe('warning');
    expect(check(s, 'invested').status).toBe('not-available');
    expect(check(s, 'rows').status).toBe('ok');
  });

  it('never carries the broker account number', () => {
    expect(JSON.stringify(s)).not.toContain('KOSH000001');
  });

  it('stops at the notes below the table', () => {
    const out = statement(
      indmoney({
        tableRows: [indmoneyRow(), ['* a note inside the table'], indmoneyRow({ 0: 'MSFT' })],
      }),
    );
    expect(out.holdings.map((h) => h.symbol)).toEqual(['ORCL', 'MSFT']);
    expect(out.totalRows).toBe(2);
  });

  it('falls back to the statement date when Holding Since is unreadable or in the future', () => {
    const out = statement(
      indmoney({
        tableRows: [
          indmoneyRow({ 1: 'sometime in spring' }),
          indmoneyRow({ 0: 'MSFT', 1: '31 Feb 2024, 10:00 AM' }),
          indmoneyRow({ 0: 'KO', 1: '01 Jan 2030, 10:00 AM' }),
          indmoneyRow({ 0: 'V', 1: '5 Jul 2025' }),
          indmoneyRow({ 0: 'PEP', 1: '05 Xyz 2025, 10:00 AM' }),
          indmoneyRow({ 0: 'HD', 1: null }),
        ],
      }),
    );
    expect(out.holdings.map((h) => [h.symbol, h.acquiredOn, h.warnings.length])).toEqual([
      ['ORCL', '2026-10-31', 1],
      ['MSFT', '2026-10-31', 1],
      ['KO', '2026-10-31', 1],
      ['V', '2025-07-05', 0],
      ['PEP', '2026-10-31', 1],
      ['HD', '2026-10-31', 1],
    ]);
  });

  it('sets aside rows with damaged cells and keeps the good ones', () => {
    const out = statement(
      indmoney({
        tableRows: [
          indmoneyRow(),
          indmoneyRow({ 0: 'bad ticker!' }),
          indmoneyRow(), // the same ticker again
          indmoneyRow({ 0: 'AAA', 2: 'lots' }),
          indmoneyRow({ 0: 'BBB', 2: -1 }),
          indmoneyRow({ 0: 'CCC', 3: null }),
          indmoneyRow({ 0: 'DDD', 3: '(5.00)' }),
          indmoneyRow({ 0: 'EEE', 2: null }),
          indmoneyRow({ 0: 'FFF', 3: 'abc' }),
          indmoneyRow({ 0: 'GGG', 2: 5e13 }),
          indmoneyRow({ 0: 'HHH', 2: 0 }),
        ],
      }),
    );
    expect(out.holdings.map((h) => h.symbol)).toEqual(['ORCL']);
    expect(out.issues.map((i) => [i.line, i.field, i.message])).toEqual([
      [10, 'Stock Symbol', 'This is not a valid US ticker'],
      [11, 'Stock Symbol', 'This ticker is listed more than once in the file'],
      [12, 'Quantity', 'The quantity is not a valid number'],
      [13, 'Quantity', 'The quantity is not a valid number'],
      [14, 'Avg. Price ($)', 'The average price is missing'],
      [15, 'Avg. Price ($)', 'The average price is not a valid number'],
      [16, 'Quantity', 'The quantity is missing'],
      [17, 'Avg. Price ($)', 'The average price is not a valid number'],
      [18, 'Quantity', 'That number is too large'],
    ]);
    expect(out.skipped).toEqual([{ line: 19, reason: 'The quantity is zero' }]);
    expect(check(out, 'rows').status).toBe('warning');
  });

  it('works without the Total Value column and without the account block', () => {
    const header = INDMONEY_HEADER.slice(0, 4);
    const out = statement(
      indmoney({ header, noAccountBlock: true, tableRows: [indmoneyRow().slice(0, 4)] }),
    );
    expect(out.holdings).toHaveLength(1);
    expect(check(out, 'row-values').status).toBe('not-available');
    expect(out.statementDate).toBe('2026-11-14');
    expect(out.notes).toHaveLength(1);
    expect(indmoneyUsHoldingsParser.detect(input(indmoney({ header, noAccountBlock: true })))).toBe(
      0.9,
    );
    // every Total Value agreeing gives a clean check
    const clean = statement(indmoney({ rows: INDMONEY_ROWS.slice(0, 3) }));
    expect(check(clean, 'row-values').status).toBe('ok');
  });

  it('accepts a day-first statement date, and refuses one in the future', () => {
    expect(statement(indmoney({ asOn: '31-10-2026' })).statementDate).toBe('2026-10-31');
    const future = statement(indmoney({ asOn: '2027-01-01' }));
    expect(future.statementDate).toBe('2026-11-14');
    expect(future.notes).toHaveLength(1);
  });

  it('refuses a report with no holdings, and one with too many rows', () => {
    expect(failure(indmoney({ tableRows: [] })).code).toBe('NO_HOLDINGS');
    expect(failure(indmoney(), { ...ctx, maxRows: 3 }).code).toBe('TOO_MANY_ROWS');
    expect(() => indmoneyUsHoldingsParser.parse(input(groww()), ctx)).toThrow(
      /table was not found/,
    );
  });
});

describe('partial matches stay below the confidence threshold', () => {
  it('a table with only some of the expected columns is not claimed', () => {
    const someGroww = writeXlsx([
      {
        name: 'S',
        rows: [
          ['Stock Name', 'ISIN', 'Sector'],
          ['X', 'INE000A01000', 'IT'],
        ],
      },
    ]);
    expect(growwHoldingsParser.detect(input(someGroww))).toBe(0.5);
    expect(detectAll(input(someGroww))[0]!.confidence).toBeLessThan(0.8);
    const someUs = writeXlsx([
      {
        name: 'S',
        rows: [
          ['Stock Symbol', 'Holding Since'],
          ['AAA', 'x'],
        ],
      },
    ]);
    expect(
      detectAll(input(someUs)).find((d) => d.parserId === 'indmoney.us-holdings')!.confidence,
    ).toBe(0.5);
    // unrelated single matching header: not even a partial match
    const unrelated = writeXlsx([
      {
        name: 'S',
        rows: [
          ['Quantity', 'Colour'],
          [1, 'red'],
        ],
      },
    ]);
    expect(detectAll(input(unrelated)).every((d) => d.confidence === 0)).toBe(true);
    // Groww's table without the labels above it is still recognised, a little less surely
    const bare = writeXlsx([{ name: 'S', rows: [GROWW_HEADER, growwRow()] }]);
    expect(growwHoldingsParser.detect(input(bare))).toBe(0.9);
  });
});
