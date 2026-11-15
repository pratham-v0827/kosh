import { ImportError } from './errors';
import { koshCsvParser } from './kosh-csv';
import type { Detection, NormalisedImport, ParseContext, Parser, ParserInput } from './types';

/** Every parser Kosh ships. Order does not matter: the most confident one wins. */
export const PARSERS: readonly Parser[] = [koshCsvParser];

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
  extensions: readonly string[];
}

export const supportedFormats = (parsers: readonly Parser[] = PARSERS): SupportedFormat[] =>
  parsers.map((p) => ({
    id: p.id,
    version: p.version,
    label: p.label,
    extensions: p.extensions,
  }));

/** Confidence of every parser for this file, highest first. Never throws. */
export function detectAll(input: ParserInput, parsers: readonly Parser[] = PARSERS): Detection[] {
  return parsers
    .map((p) => {
      let confidence = 0;
      try {
        confidence = Math.max(0, Math.min(1, p.detect(input)));
      } catch {
        confidence = 0; // a parser that cannot sniff the file simply does not claim it
      }
      return { parserId: p.id, version: p.version, confidence };
    })
    .sort((a, b) => b.confidence - a.confidence);
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
): NormalisedImport {
  if (input.bytes.length === 0) throw new ImportError('EMPTY_FILE', 'The file is empty');
  if (input.bytes.length > MAX_FILE_BYTES) {
    throw new ImportError('FILE_TOO_LARGE', 'The file is larger than 4 MB');
  }
  const best = detectAll(input, parsers)[0];
  const parser = best && parsers.find((p) => p.id === best.parserId);
  if (!best || !parser || best.confidence < MIN_CONFIDENCE) {
    throw new ImportError(
      'UNKNOWN_FORMAT',
      'Kosh does not recognise this file. Use one of the supported formats, or the Kosh CSV template',
      { supported: supportedFormats(parsers) },
    );
  }
  try {
    return parser.parse(input, ctx);
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError(
      'PARSER_FAILED',
      `Kosh could not read this ${parser.label} file. It may be damaged or in a newer layout`,
      { parser: `${parser.id}@${parser.version}` },
    );
  }
}
