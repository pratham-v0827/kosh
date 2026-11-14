import { toEpochDay } from '@kosh/core';

/**
 * Statement date → ISO date. Accepts YYYY-MM-DD and day-first DD-MM-YYYY / DD/MM/YYYY (the Indian
 * convention; month-first dates are NOT accepted, so 03/04/2025 is always 3 April).
 * Returns null when the text is not a real calendar date.
 */
export function parseDate(text: string): string | null {
  const s = text.trim();
  let iso: string | null = null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) iso = `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  if (!iso) return null;
  try {
    toEpochDay(iso);
    return iso;
  } catch {
    return null;
  }
}

/**
 * Statement number → plain decimal string ("1,23,456.50" → "123456.5", "₹ 2,410.00" → "2410").
 * Thousands separators (Indian or international), currency symbols and spaces are removed.
 * Returns null for anything else, including negatives, exponents and formulas.
 */
export function parseDecimal(text: string): string | null {
  // No real amount is this long; refusing early keeps a huge cell from costing any work.
  if (text.length > MAX_NUMBER_CHARS) return null;
  const s = text.replace(/[₹$,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return canonicalDecimal(s);
}

/** Longest cell accepted as a number, including separators and a currency symbol. */
const MAX_NUMBER_CHARS = 64;

/**
 * "0010.500" → "10.5", "10.00" → "10", "0.0" → "0". Makes equal amounts compare equal.
 * Zeros are trimmed with plain loops, never a regular expression: /0+$/ takes quadratic time on a
 * long run of zeros that does not reach the end of the string.
 */
export function canonicalDecimal(s: string): string {
  const dot = s.indexOf('.');
  const int = dot === -1 ? s : s.slice(0, dot);
  const frac = dot === -1 ? '' : s.slice(dot + 1);

  let start = 0;
  while (start < int.length - 1 && int[start] === '0') start++;
  let end = frac.length;
  while (end > 0 && frac[end - 1] === '0') end--;

  const i = int.slice(start) || '0';
  const f = frac.slice(0, end);
  return f ? `${i}.${f}` : i;
}

/** "1:5" or "1/5" → { from: 1, to: 5 }. */
export function parseRatio(text: string): { from: number; to: number } | null {
  const m = /^(\d{1,4})\s*[:/]\s*(\d{1,4})$/.exec(text.trim());
  if (!m) return null;
  return { from: Number(m[1]), to: Number(m[2]) };
}
