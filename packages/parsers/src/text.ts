import Papa from 'papaparse';
import { ImportError } from './errors';

/** Bytes checked when sniffing a file (detect must stay cheap). */
const SNIFF_BYTES = 4096;

/** True when the bytes look like text (no NUL bytes in the first few KB). */
export function looksLikeText(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, SNIFF_BYTES);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return false;
  return n > 0;
}

/** Decode UTF-8 (with or without a byte-order mark). Throws NOT_TEXT for binary files. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length === 0) throw new ImportError('EMPTY_FILE', 'The file is empty');
  if (!looksLikeText(bytes)) {
    throw new ImportError('NOT_TEXT', 'This does not look like a text or CSV file');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new ImportError(
      'NOT_TEXT',
      'The file is not UTF-8 text. Save it as "CSV UTF-8" and retry',
    );
  }
}

/** First non-empty line, for header sniffing. */
export function firstLine(bytes: Uint8Array): string {
  if (!looksLikeText(bytes)) return '';
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, SNIFF_BYTES));
  return (
    head
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .find((l) => l.trim() !== '') ?? ''
  );
}

/** Lower-case, trimmed, with spaces and dashes folded to underscores: "Trade Date" → "trade_date". */
export const headerKey = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

export interface CsvTable {
  /** Normalised header keys, in file order. */
  header: string[];
  /** Data rows as objects keyed by header key, with the 1-based line number of each. */
  rows: { line: number; cells: Record<string, string> }[];
}

/**
 * Parse CSV text (RFC 4180: quotes, embedded commas and newlines). Blank lines are skipped.
 * Cell values are returned as trimmed strings and are never evaluated: a cell such as
 * "=HYPERLINK(…)" stays plain text.
 */
export function parseCsv(text: string, maxRows: number): CsvTable {
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    skipEmptyLines: 'greedy',
    // one extra data row lets us tell "exactly at the limit" from "over the limit"
    preview: maxRows + 2,
  });
  const data = result.data;
  if (data.length === 0) throw new ImportError('EMPTY_FILE', 'The file has no rows');
  const header = data[0]!.map(headerKey);
  if (data.length - 1 > maxRows) {
    throw new ImportError(
      'TOO_MANY_ROWS',
      `A file can hold at most ${maxRows} rows. Split it into smaller files (for example by year)`,
      { maxRows },
    );
  }
  const rows = data.slice(1).map((cells, i) => ({
    // Papa drops blank lines, so this is the row's position among non-blank lines.
    line: i + 2,
    cells: Object.fromEntries(header.map((h, c) => [h, (cells[c] ?? '').trim()])),
  }));
  return { header, rows };
}
