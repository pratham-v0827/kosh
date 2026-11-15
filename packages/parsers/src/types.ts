import type { AssetClass, Currency, Ratio, TxnType } from '@kosh/core';

/** A file handed to a parser. Lives in memory only; never written to disk or logged. */
export interface ParserInput {
  bytes: Uint8Array;
  fileName: string;
  mime?: string;
  /** For encrypted PDFs. Used once in memory; must never appear in errors, logs or output. */
  password?: string;
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
  kind: 'transactions';
  /** Shown in the list of supported formats. */
  label: string;
  /** File extensions this parser can read, lower case, with the dot. */
  extensions: readonly string[];
  /** Confidence 0…1 from header/signature sniffing only (no full parse). */
  detect(input: ParserInput): number;
  /** Full parse and normalisation. Throws ImportError for file-level problems. */
  parse(input: ParserInput, ctx: ParseContext): NormalisedImport;
}

export interface Detection {
  parserId: string;
  version: string;
  confidence: number;
}
