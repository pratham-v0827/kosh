import { ImportError } from '../errors';
import {
  type Cell,
  DEFAULT_SHEET_LIMITS,
  type Sheet,
  type SheetLimits,
  type Workbook,
} from './types';
import { readXls } from './xls';
import { readXlsx } from './xlsx';

export { DEFAULT_SHEET_LIMITS, type Cell, type Sheet, type SheetLimits, type Workbook };

export type Container = 'xlsx' | 'xls' | 'pdf' | 'other';

/** Identify the container from its first bytes, never from the file name. */
export function sniffContainer(bytes: Uint8Array): Container {
  const b = bytes;
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    return 'xlsx'; // a zip; whether it really is a workbook is checked when it is opened
  }
  if (b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
    return 'xls';
  }
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) {
    return 'pdf';
  }
  return 'other';
}

/** Read a spreadsheet's cell values. Throws ImportError for anything unreadable or too large. */
export function readWorkbook(
  bytes: Uint8Array,
  limits: SheetLimits = DEFAULT_SHEET_LIMITS,
): Workbook {
  const kind = sniffContainer(bytes);
  try {
    if (kind === 'xlsx') return readXlsx(bytes, limits);
    if (kind === 'xls') return readXls(bytes, limits);
  } catch (e) {
    if (e instanceof ImportError) throw e;
    // A bounds error from a damaged file. The original message may quote file bytes: drop it.
    throw new ImportError('CORRUPT_FILE', 'This Excel file is damaged and could not be read');
  }
  throw new ImportError('UNSUPPORTED_FILE', 'This is not an Excel file');
}

// ---------- helpers for parsers ----------

/** Text of a cell, trimmed. Numbers and booleans are not text and give ''. */
export const cellText = (c: Cell | undefined): string => (c && c.t === 's' ? c.v.trim() : '');

/**
 * Comparison key for headers and labels: lower case, letters and digits only.
 * "Avg. Price ($)" → "avgprice", "Unrealised P&L" → "unrealisedpl".
 */
export function labelKey(text: string): string {
  let out = '';
  const s = text.length > 80 ? text.slice(0, 80) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) out += s[i];
    else if (c >= 97 && c <= 122) out += s[i];
    else if (c >= 65 && c <= 90) out += String.fromCharCode(c + 32);
  }
  return out;
}

export interface HeaderMatch {
  /** Index of the header row in `sheet.rows`. */
  row: number;
  /** Column index for each key present in the header row (required and optional). */
  columns: Record<string, number>;
  /** How many of the required keys were found (equals required.length on a full match). */
  found: number;
}

/**
 * Find the table's header row by content: the first row, within the top `scanRows`, that contains
 * the most required headers. Columns are located by name, so extra or reordered columns are fine.
 */
export function findHeaderRow(
  sheet: Sheet,
  required: readonly string[],
  optional: readonly string[] = [],
  scanRows = 60,
): HeaderMatch | null {
  let best: HeaderMatch | null = null;
  const wanted = new Set([...required, ...optional]);
  for (let r = 0; r < Math.min(sheet.rows.length, scanRows); r++) {
    const columns: Record<string, number> = {};
    const row = sheet.rows[r]!;
    for (let c = 0; c < row.length; c++) {
      const key = labelKey(cellText(row[c]));
      if (key && wanted.has(key) && columns[key] === undefined) columns[key] = c;
    }
    const found = required.filter((k) => columns[k] !== undefined).length;
    if (found > 0 && (!best || found > best.found)) best = { row: r, columns, found };
    if (found === required.length) break;
  }
  return best;
}

/** The cell to the right of a label ("Holdings as on" → its value), searching the top rows. */
export function valueBeside(sheet: Sheet, label: string, scanRows = 60): Cell {
  for (let r = 0; r < Math.min(sheet.rows.length, scanRows); r++) {
    const row = sheet.rows[r]!;
    for (let c = 0; c < row.length; c++) {
      if (labelKey(cellText(row[c])) !== label) continue;
      for (let k = c + 1; k < row.length; k++) if (row[k]) return row[k]!;
      return null;
    }
  }
  return null;
}

/** True when a row has no usable cell. */
export const isBlankRow = (row: readonly Cell[] | undefined): boolean =>
  !row || row.every((c) => c === null || (c.t === 's' && c.v.trim() === ''));
