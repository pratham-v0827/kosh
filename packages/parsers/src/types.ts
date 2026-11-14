import type { AssetClass, Currency, Ratio, TxnType } from '@kosh/core';
import type { Workbook } from './sheets/types';

/** A file handed to a parser. Lives in memory only; never written to disk or logged. */
export interface ParserInput {
  bytes: Uint8Array;
  fileName: string;
  mime?: string;
  /** For encrypted PDFs. Used once in memory; must never appear in errors, logs or output. */
  password?: string;
  /**
   * The file opened as a spreadsheet, read at most once however many parsers ask. Provided by the
   * registry. Throws ImportError when the file is not a readable spreadsheet.
   */
  workbook?: () => Workbook;
}

/** Where a statement comes from. Becomes part of the account id (`import:<source>`). */
export type Source = 'kosh' | 'zerodha' | 'groww' | 'indmoney' | 'cas' | 'coindcx';

/** Transaction types a statement row may map to (a subset of the ledger's types). */
export type ImportTxnType = Exclude<TxnType, 'OPENING_BALANCE'>;

/** One statement row, normalised to Kosh's vocabulary. Money values are decimal strings. */
export interface NormalisedRow {
  /** 1-based line (or row) number in the file, for messages shown to the user. */
  line: number;
  instrument: {
    assetClass: AssetClass;
    name: string;
    symbol?: string;
    exchange?: 'NSE' | 'BSE';
  };
  type: ImportTxnType;
  /** ISO calendar date, YYYY-MM-DD. */
  tradeDate: string;
  qty?: string;
  price?: string;
  fees?: string;
  amount?: string;
  ratio?: Ratio;
  currency: Currency;
  /** INR per 1 USD when the statement states it. Otherwise looked up for the trade date. */
  fxRate?: string;
  /** Trade or order id from the broker, when present. Makes de-duplication exact. */
  brokerRef?: string;
  note?: string;
}

/** A row (or the whole file) that could not be used as it is. Never contains file contents. */
export interface RowIssue {
  line: number;
  field?: string;
  message: string;
}

export interface NormalisedImport {
  /** "kosh.csv@1.0.0" */
  parser: string;
  source: Source;
  kind: 'transactions';
  rows: NormalisedRow[];
  issues: RowIssue[];
  /** Data rows found in the file (rows + rows with issues). */
  totalRows: number;
}

/** One position from a holdings statement (a snapshot: no trades). Money is decimal strings. */
export interface NormalisedHolding {
  /** 1-based spreadsheet row, for messages shown to the user. */
  line: number;
  assetClass: Extract<AssetClass, 'IN_EQUITY' | 'US_EQUITY'>;
  /** Exchange-traded funds are priced like shares but shown separately in allocation views. */
  instrumentType: 'STOCK' | 'ETF';
  /** Company or fund name when the file has one; otherwise the ticker. */
  name: string;
  /** Exchange ticker, when the file gives one. */
  symbol?: string;
  /** ISIN, when the file gives one. Resolved to a ticker after parsing. */
  isin?: string;
  quantity: string;
  /** Average buy price per unit, in `currency`. */
  avgBuyPrice: string;
  /** Cost of the position, in `currency`. */
  investedAmount: string;
  currency: Currency;
  /** First-purchase date (YYYY-MM-DD) when the file states it. */
  acquiredOn?: string;
  /** Price per unit as on the statement date, when the file states it. */
  statementPrice?: string;
  /** Notes about this row, shown in the preview. Never contain other rows' data. */
  warnings: string[];
}

/** One line of the reconciliation report shown in the preview. */
export interface ReconciliationCheck {
  id: 'rows' | 'invested' | 'value' | 'row-values';
  label: string;
  status: 'ok' | 'warning' | 'not-available';
  /** A short sentence without amounts; the amounts are in the fields below. */
  detail: string;
  currency?: Currency;
  /** Total stated in the file. */
  fileTotal?: string;
  /** Sum of the parsed rows. */
  rowsTotal?: string;
  difference?: string;
}

export interface NormalisedStatement {
  /** "groww.holdings@1.0.0" */
  parser: string;
  source: Source;
  kind: 'positions';
  /** Shown to the user, e.g. "Groww" or "INDmoney (US stocks)". */
  label: string;
  /** Account suffix: holdings of one broker and market replace each other on re-import. */
  account: string;
  /** The "as on" date of the statement (YYYY-MM-DD). */
  statementDate: string;
  holdings: NormalisedHolding[];
  issues: RowIssue[];
  /** Rows deliberately left out (zero quantity, closed positions), with the reason. */
  skipped: { line: number; reason: string }[];
  reconciliation: ReconciliationCheck[];
  /** Notes about the file as a whole (for example a missing statement date). */
  notes: string[];
  /** Data rows found under the header (holdings + skipped + rows with issues). */
  totalRows: number;
}

export type ParseResult = NormalisedImport | NormalisedStatement;

export interface ParseContext {
  /** Today in India (YYYY-MM-DD); rows dated later are rejected. Injected for tests. */
  today: string;
  /** Hard cap on rows per file. */
  maxRows: number;
}

export interface Parser {
  /** "kosh.csv" */
  id: string;
  /** Semver. Bump the major version when the source changes its format. */
  version: string;
  source: Source;
  kind: 'transactions' | 'positions';
  /** Shown in the list of supported formats. */
  label: string;
  /** File extensions this parser can read, lower case, with the dot. */
  extensions: readonly string[];
  /** Confidence 0…1 from header/signature sniffing only (no full parse). */
  detect(input: ParserInput): number;
  /** Full parse and normalisation. Throws ImportError for file-level problems. */
  parse(input: ParserInput, ctx: ParseContext): ParseResult;
  /**
   * For a file this parser almost recognises: one sentence on what is wrong with it (for example
   * which expected columns are missing). Must not quote file contents.
   */
  explain?(input: ParserInput): string | null;
}

export interface Detection {
  parserId: string;
  version: string;
  confidence: number;
}
