// INVENTED statements for tests, laid out exactly like the real exports (same label rows, header
// text, cell types and number quirks). Every identity, holding, quantity and amount below is made
// up: nothing here comes from a real person's file. Self-contained (no imports) so the fixture
// script can load it directly.

type Cell = string | number | null;

// ---------- Groww "Stocks Holdings Statement" (.xlsx) ----------

export interface GrowwRow {
  name: string;
  isin: string;
  quantity: number;
  /** Average cost before Groww rounds it to 2 places in the row (source of the summary gap). */
  trueAverage: number;
  closingPrice: number;
}

/**
 * A made-up portfolio of well-known Indian shares and two exchange-traded funds. ISINs are
 * illustrative: they have the right shape, and tests never look them up.
 */
export const GROWW_ROWS: GrowwRow[] = [
  {
    name: 'BHARAT PETROLEUM CORP LT',
    isin: 'INE029A01011',
    quantity: 37,
    trueAverage: 318.4567,
    closingPrice: 341.85,
  },
  {
    name: 'HERO MOTOCORP LIMITED',
    isin: 'INE158A01026',
    quantity: 7,
    trueAverage: 4426.3333,
    closingPrice: 4689.4,
  },
  {
    name: 'HINDALCO INDUSTRIES LTD',
    isin: 'INE038A01020',
    quantity: 53,
    trueAverage: 642.125,
    closingPrice: 611.9,
  },
  {
    name: 'ITC LTD',
    isin: 'INE154A01025',
    quantity: 113,
    trueAverage: 412.0909,
    closingPrice: 438.6,
  },
  {
    name: 'JSW STEEL LIMITED',
    isin: 'INE019A01038',
    quantity: 29,
    trueAverage: 902.6667,
    closingPrice: 971.35,
  },
  {
    name: 'STATE BANK OF INDIA',
    isin: 'INE062A01020',
    quantity: 41,
    trueAverage: 771.3125,
    closingPrice: 742.15,
  },
  {
    name: 'ADANI PORT & SEZ LTD',
    isin: 'INE742F01042',
    quantity: 19,
    trueAverage: 1288.4444,
    closingPrice: 1402.7,
  },
  {
    name: 'Grasim Industries Limited',
    isin: 'INE047A01021',
    quantity: 11,
    trueAverage: 2511.9722,
    closingPrice: 2688.05,
  },
  {
    name: 'BRITANNIA INDUSTRIES LTD.',
    isin: 'INE216A01030',
    quantity: 4,
    trueAverage: 5120.2,
    closingPrice: 4987.75,
  },
  {
    name: 'SBI-ETF NIFTY 50',
    isin: 'INF200KA1FS1',
    quantity: 147,
    trueAverage: 248.4433,
    closingPrice: 263.37,
  },
  {
    name: 'NIP IND ETF LIQUID BEES',
    isin: 'INF732E01037',
    quantity: 23,
    trueAverage: 999.985,
    closingPrice: 1000.01,
  },
];

export const GROWW_HEADER = [
  'Stock Name',
  'ISIN',
  'Quantity',
  'Average buy price',
  'Buy value',
  'Closing price',
  'Closing value',
  'Unrealised P&L',
];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One table row, with the same arithmetic Groww shows (floating-point noise included). */
export function growwTableRow(r: GrowwRow): Cell[] {
  const average = round2(r.trueAverage);
  const buyValue = round2(r.quantity * average);
  const closingValue = r.quantity * r.closingPrice; // left unrounded, as in the export
  return [
    r.name,
    r.isin,
    r.quantity,
    average,
    buyValue,
    r.closingPrice,
    closingValue,
    round2(closingValue - buyValue),
  ];
}

export interface GrowwSheetOptions {
  rows?: GrowwRow[];
  /** DD-MM-YYYY */
  asOn?: string;
  /** Replace the table rows entirely (for edge cases). */
  tableRows?: Cell[][];
  header?: Cell[];
  /** Leave out the summary block. */
  noSummary?: boolean;
  /** Override the "Invested Value" in the summary (to force a reconciliation warning). */
  investedValue?: number;
}

/** The whole sheet, row for row as Groww lays it out. */
export function growwSheet(o: GrowwSheetOptions = {}): Cell[][] {
  const rows = o.rows ?? GROWW_ROWS;
  const table = o.tableRows ?? rows.map(growwTableRow);
  // The summary is computed from unrounded averages, so it differs slightly from the row sum.
  const invested =
    o.investedValue ?? round2(rows.reduce((s, r) => s + r.quantity * r.trueAverage, 0));
  const closing = rows.reduce((s, r) => s + r.quantity * r.closingPrice, 0);
  return [
    ['Name', 'Asha Example'],
    ['Unique Client Code', '0000000000'],
    [],
    [`Holdings statement for stocks as on ${o.asOn ?? '31-10-2026'}`],
    [],
    ...(o.noSummary
      ? []
      : [
          ['Summary'],
          ['Invested Value', invested],
          ['Closing Value', closing],
          ['Unrealised P&L', round2(closing - invested)],
          [],
        ]),
    o.header ?? GROWW_HEADER,
    ...table,
  ];
}

// ---------- INDmoney US stocks "Holdings report" (.xls) ----------

export interface IndmoneyRow {
  symbol: string;
  holdingSince: string;
  quantity: number;
  averagePrice: number;
  /** "Total Value ($)" as the file shows it; defaults to quantity × average price. */
  totalValue?: number;
}

/** A made-up US portfolio, including the two odd rows seen in real reports. */
export const INDMONEY_ROWS: IndmoneyRow[] = [
  {
    symbol: 'ORCL',
    holdingSince: '14 Mar 2023, 08:15 PM',
    quantity: 3.25817364,
    averagePrice: 104.3382915527,
  },
  {
    symbol: 'ADBE',
    holdingSince: '02 Aug 2022, 07:45 PM',
    quantity: 1.1 + 2.2,
    averagePrice: 412.4406666666667,
  },
  {
    symbol: 'GS',
    holdingSince: '21 Nov 2023, 09:02 PM',
    quantity: 2.75,
    averagePrice: 338.4205729166667,
  },
  {
    symbol: 'DIS',
    holdingSince: '09 Jan 2024, 08:31 PM',
    quantity: 4.10293847,
    averagePrice: 92.7731,
  },
  {
    symbol: 'NKE',
    holdingSince: '30 May 2024, 07:59 PM',
    quantity: 0.84726153,
    averagePrice: 95.91834512,
    totalValue: 81.27,
  },
  {
    symbol: 'BF.B',
    holdingSince: '17 Feb 2022, 10:10 PM',
    quantity: 1.2,
    averagePrice: 62.5,
    totalValue: 75,
  },
  { symbol: 'HD', holdingSince: '05 Sep 2025, 08:05 PM', quantity: 10.5, averagePrice: 358.137 },
  {
    symbol: 'META',
    holdingSince: '26 Jun 2026, 07:36 PM',
    quantity: 0.7 + 0.1,
    averagePrice: 541.88,
    totalValue: 433.5,
  },
  // A sold-out position that left a rounding crumb behind, with a tiny negative total.
  {
    symbol: 'T',
    holdingSince: '11 Apr 2021, 08:48 PM',
    quantity: 3.552713678800501e-15,
    averagePrice: 9.99,
    totalValue: -0.00000001,
  },
  // A row whose total is negative although quantity and average price are positive.
  {
    symbol: 'BA',
    holdingSince: '08 Dec 2021, 09:20 PM',
    quantity: 2.5,
    averagePrice: 191.4,
    totalValue: -823.52,
  },
];

export const INDMONEY_HEADER = [
  'Stock Symbol',
  'Holding Since',
  'Quantity',
  'Avg. Price ($)',
  'Total Value ($)',
];

export const indmoneyTableRow = (r: IndmoneyRow): Cell[] => [
  r.symbol,
  r.holdingSince,
  r.quantity,
  r.averagePrice,
  r.totalValue ?? r.quantity * r.averagePrice,
];

export interface IndmoneySheetOptions {
  rows?: IndmoneyRow[];
  /** YYYY-MM-DD */
  asOn?: string;
  tableRows?: Cell[][];
  header?: Cell[];
  noAccountBlock?: boolean;
}

/** The whole sheet, row for row as INDmoney lays it out (header on row 8, notes at the end). */
export function indmoneySheet(o: IndmoneySheetOptions = {}): Cell[][] {
  const table = o.tableRows ?? (o.rows ?? INDMONEY_ROWS).map(indmoneyTableRow);
  return [
    ...(o.noAccountBlock
      ? []
      : [
          ['Account Details'],
          ['Broker Name', 'DriveWealth'],
          ['Broker Account', 'KOSH000001'],
          ['Holdings as on', o.asOn ?? '2026-10-31'],
          [],
          [],
          [],
        ]),
    o.header ?? INDMONEY_HEADER,
    ...table,
    [],
    [],
    [],
    [],
    ['Disclaimer:-'],
    ['* This report is for information only and is not advice.'],
    ['* Figures come from the US broker and may change.'],
  ];
}

export const GROWW_SHEET_NAME = 'Sheet1';
export const INDMONEY_SHEET_NAME = 'HOLDINGS_BOOK';
