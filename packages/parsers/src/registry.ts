import { ImportError } from './errors';
import { growwHoldingsParser } from './groww-holdings';
import { indmoneyUsHoldingsParser } from './indmoney-us-holdings';
import { koshCsvParser } from './kosh-csv';
import { DEFAULT_SHEET_LIMITS, readWorkbook, sniffContainer, type Workbook } from './sheets';
import type { Detection, ParseContext, Parser, ParseResult, ParserInput } from './types';

/** Every parser Kosh ships. Order does not matter: the most confident one wins. */
export const PARSERS: readonly Parser[] = [
  koshCsvParser,
  growwHoldingsParser,
  indmoneyUsHoldingsParser,
];

/** A parser is used only when it is at least this sure about the file. */
export const MIN_CONFIDENCE = 0.8;
/** Uploads above this size are refused before any parsing (matches the API limit). */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
/**
 * Rows per file. Keeps a draft import inside one Firestore document and its confirmation inside
 * one transaction. Larger histories are imported as several files (for example one per year).
 */
export const MAX_IMPORT_ROWS = 450;

export interface SupportedFormat {
  id: string;
  version: string;
  label: string;
  kind: Parser['kind'];
  extensions: readonly string[];
}

export const supportedFormats = (parsers: readonly Parser[] = PARSERS): SupportedFormat[] =>
  parsers.map((p) => ({
    id: p.id,
    version: p.version,
    label: p.label,
    kind: p.kind,
    extensions: p.extensions,
  }));

/**
 * Give the input a `workbook()` accessor that opens the spreadsheet at most once. A failure is
 * remembered too, so every parser sees the same result and the file is never read twice.
 */
function withWorkbook(input: ParserInput): ParserInput {
  if (input.workbook) return input;
  let result: { ok: Workbook } | { error: unknown } | null = null;
  return {
    ...input,
    workbook() {
      if (!result) {
        try {
          result = { ok: readWorkbook(input.bytes, DEFAULT_SHEET_LIMITS) };
        } catch (error) {
          result = { error };
        }
      }
      if ('error' in result) throw result.error;
      return result.ok;
    },
  };
}

/** Confidence of every parser for this file, highest first. Never throws. */
export function detectAll(input: ParserInput, parsers: readonly Parser[] = PARSERS): Detection[] {
  const prepared = withWorkbook(input);
  return parsers
    .map((p) => {
      let confidence = 0;
      try {
        confidence = Math.max(0, Math.min(1, p.detect(prepared)));
      } catch {
        confidence = 0; // a parser that cannot sniff the file simply does not claim it
      }
      return { parserId: p.id, version: p.version, confidence };
    })
    .sort((a, b) => b.confidence - a.confidence);
}

/** Why no parser took the file, in words that help the user fix it. Never quotes the file. */
function unknownFormat(input: ParserInput, parsers: readonly Parser[]): ImportError {
  const container = sniffContainer(input.bytes);
  const details = { supported: supportedFormats(parsers) };
  if (container === 'pdf') {
    return new ImportError(
      'UNKNOWN_FORMAT',
      'PDF statements are not supported yet. Use an Excel or CSV export, or the Kosh CSV template',
      details,
    );
  }
  if (container === 'xlsx' || container === 'xls') {
    // An Excel file nobody claimed: if it cannot even be opened, say that instead.
    try {
      input.workbook?.();
    } catch (e) {
      if (e instanceof ImportError) return e;
    }
    for (const p of parsers) {
      let hint: string | null = null;
      try {
        hint = p.explain?.(input) ?? null;
      } catch {
        hint = null;
      }
      if (hint) return new ImportError('UNKNOWN_FORMAT', hint, details);
    }
    return new ImportError(
      'UNKNOWN_FORMAT',
      'This Excel file is not a statement Kosh can read yet. Upload a supported holdings export, or use the Kosh CSV template',
      details,
    );
  }
  return new ImportError(
    'UNKNOWN_FORMAT',
    'Kosh does not recognise this file. Use one of the supported formats, or the Kosh CSV template',
    details,
  );
}

/**
 * Detect the format and parse the file, entirely in memory.
 *
 * Errors are always ImportError with a message that is safe to show and log. Whatever a parser
 * throws is replaced by a generic message, so file contents, the file name and a PDF password can
 * never leak through an error.
 */
export function runImport(
  input: ParserInput,
  ctx: ParseContext,
  parsers: readonly Parser[] = PARSERS,
): ParseResult {
  if (input.bytes.length === 0) throw new ImportError('EMPTY_FILE', 'The file is empty');
  if (input.bytes.length > MAX_FILE_BYTES) {
    throw new ImportError('FILE_TOO_LARGE', 'The file is larger than 4 MB');
  }
  const prepared = withWorkbook(input);
  const best = detectAll(prepared, parsers)[0];
  const parser = best && parsers.find((p) => p.id === best.parserId);
  if (!best || !parser || best.confidence < MIN_CONFIDENCE) {
    throw unknownFormat(prepared, parsers);
  }
  try {
    return parser.parse(prepared, ctx);
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError(
      'PARSER_FAILED',
      `Kosh could not read this ${parser.label} file. It may be damaged or in a newer layout`,
      { parser: `${parser.id}@${parser.version}` },
    );
  }
}
