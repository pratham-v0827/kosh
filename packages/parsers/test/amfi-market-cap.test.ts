// AMFI's half-yearly market-cap list → the top-250 table Kosh commits. Built from invented rows in
// the layout of the 30 June 2026 file (checked 2026-11-15): a title row, a header row, then one row
// per company ranked by six-month average market cap.
import { describe, expect, it } from 'vitest';
import { readAmfiMarketCap } from '../src/amfi-market-cap';
import { readWorkbook } from '../src/sheets';
import { type XCell, writeXlsx } from './support/write-xlsx';

const HEADER: XCell[] = [
  'Sr. No.',
  'Company name',
  'ISIN',
  'BSE Symbol',
  'BSE 6 month Avg Total Market Cap in (Rs. Crs.)',
  'NSE Symbol',
  'NSE 6 month Avg Total Market Cap (Rs. Crs.)',
  'MSEI Symbol',
  'MSEI 6 month Avg Total Market Cap in (Rs Crs.)',
  'Average of All Exchanges (Rs. Cr.)',
  'Categorization as per SEBI Circular dated Oct 6, 2017',
];

const category = (rank: number) =>
  rank <= 100 ? 'Large Cap' : rank <= 250 ? 'Mid Cap' : 'Small Cap';
const isin = (rank: number) => `INE${String(rank).padStart(5, '0')}A011`;

function company(rank: number, o: Partial<Record<'nse' | 'bse' | 'cat', XCell>> = {}): XCell[] {
  const cap = 100000 - rank;
  return [
    rank,
    `Company ${rank} Ltd.`,
    isin(rank),
    o.bse !== undefined ? o.bse : `CO${rank}`,
    cap,
    o.nse !== undefined ? o.nse : `CO${rank}`,
    cap,
    '-',
    null,
    cap,
    o.cat !== undefined ? o.cat : category(rank),
  ];
}

function workbook(
  rows: XCell[][],
  title = 'Average Market Capitalization of listed companies during the six months ended 30 June 2026',
) {
  return readWorkbook(writeXlsx([{ name: 'FINAL', rows: [[title], HEADER, ...rows] }]));
}

const companies = (n: number) => Array.from({ length: n }, (_, i) => company(i + 1));

describe('readAmfiMarketCap', () => {
  it('keeps the top 250 with their ISIN and both symbols, and reads the period end', () => {
    const list = readAmfiMarketCap(workbook(companies(300)));
    expect(list.asOf).toBe('2026-06-30');
    expect(list.listed).toBe(300);
    expect(list.top250).toHaveLength(250);
    expect(list.top250[0]).toEqual([isin(1), 'CO1', 'CO1', 'Company 1 Ltd.']);
    expect(list.top250[249]).toEqual([isin(250), 'CO250', 'CO250', 'Company 250 Ltd.']);
  });

  it('turns a missing symbol ("-" or blank) into null and a numeric BSE code into text', () => {
    const rows = companies(260);
    rows[0] = company(1, { nse: '-', bse: 500325 });
    rows[1] = company(2, { bse: '-', nse: null });
    const list = readAmfiMarketCap(workbook(rows));
    expect(list.top250[0]!.slice(1, 3)).toEqual([null, '500325']);
    expect(list.top250[1]!.slice(1, 3)).toEqual([null, null]);
  });

  it('finds the columns by name, wherever they are', () => {
    const swap = (r: XCell[]): XCell[] => [r[0]!, r[2]!, r[1]!, ...r.slice(3)];
    const wb = readWorkbook(
      writeXlsx([
        {
          name: 'FINAL',
          rows: [
            ['Average Market Capitalization … six months ended 31 December 2025'],
            swap(HEADER),
            ...companies(255).map(swap),
          ],
        },
      ]),
    );
    const list = readAmfiMarketCap(wb);
    expect(list.asOf).toBe('2025-12-31');
    expect(list.top250[4]).toEqual([isin(5), 'CO5', 'CO5', 'Company 5 Ltd.']);
  });

  it('refuses a list whose categories do not follow SEBI’s 100 / 250 ranks', () => {
    const rows = companies(260);
    rows[100] = company(101, { cat: 'Large Cap' });
    expect(() => readAmfiMarketCap(workbook(rows))).toThrow(/rank 101/);
  });

  it('refuses ranks that skip or repeat', () => {
    const rows = companies(260);
    rows.splice(10, 1);
    expect(() => readAmfiMarketCap(workbook(rows))).toThrow(/rank/);
  });

  it('refuses a malformed ISIN', () => {
    const rows = companies(260);
    rows[3]![2] = 'not-an-isin';
    expect(() => readAmfiMarketCap(workbook(rows))).toThrow(/ISIN/);
  });

  it('refuses a short list, a missing column and a missing date', () => {
    expect(() => readAmfiMarketCap(workbook(companies(120)))).toThrow(/250/);
    const noIsin = readWorkbook(
      writeXlsx([{ name: 'FINAL', rows: [['six months ended 30 June 2026'], HEADER.slice(3)] }]),
    );
    expect(() => readAmfiMarketCap(noIsin)).toThrow(/columns/);
    expect(() => readAmfiMarketCap(workbook(companies(260), 'Market cap list'))).toThrow(/date/);
  });

  it('stops at the first row that is not a ranked company', () => {
    const list = readAmfiMarketCap(workbook([...companies(255), [], ['Source: exchanges']]));
    expect(list.listed).toBe(255);
  });
});
