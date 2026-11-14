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
  const s = text.replace(/[₹$,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return canonicalDecimal(s);
}

/** "0010.500" → "10.5", "10.00" → "10", "0.0" → "0". Makes equal amounts compare equal. */
export function canonicalDecimal(s: string): string {
  const [int = '0', frac = ''] = s.split('.');
  const i = int.replace(/^0+(?=\d)/, '');
  const f = frac.replace(/0+$/, '');
  return f ? `${i}.${f}` : i;
}

/** "1:5" or "1/5" → { from: 1, to: 5 }. */
export function parseRatio(text: string): { from: number; to: number } | null {
  const m = /^(\d{1,4})\s*[:/]\s*(\d{1,4})$/.exec(text.trim());
  if (!m) return null;
  return { from: Number(m[1]), to: Number(m[2]) };
}
