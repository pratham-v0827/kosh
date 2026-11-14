/**
 * Personal-data patterns found in Indian broker and registrar statements. Used to redact sample
 * files before they become fixtures, and to stop un-redacted data from being committed.
 */
export interface PiiPattern {
  kind: 'PAN' | 'EMAIL' | 'PHONE' | 'AADHAAR' | 'DEMAT' | 'IFSC' | 'UPI';
  regex: RegExp;
  /** Replacement for the nth distinct value (1-based), same shape as the original. */
  fake: (n: number) => string;
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

export const PII_PATTERNS: readonly PiiPattern[] = [
  // Order matters: more specific shapes first.
  {
    kind: 'EMAIL',
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    fake: (n) => `user${n}@example.test`,
  },
  {
    kind: 'UPI',
    regex: /\b[A-Za-z0-9._-]{2,}@(?:ok[a-z]+|ybl|upi|paytm|ibl|axl|apl)\b/g,
    fake: (n) => `user${n}@upi`,
  },
  { kind: 'PAN', regex: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, fake: () => 'ABCDE1234F' },
  // NSDL demat account: IN + 6 digits (DP id) then 8 digits (client id), with or without a dash.
  { kind: 'DEMAT', regex: /\bIN[0-9]{6}[- ]?[0-9]{8}\b/g, fake: (n) => `IN000000-${pad(n, 8)}` },
  // CDSL BO id: 16 digits.
  { kind: 'DEMAT', regex: /\b[0-9]{16}\b/g, fake: (n) => pad(n, 16) },
  {
    kind: 'AADHAAR',
    regex: /\b[2-9][0-9]{3}[ -][0-9]{4}[ -][0-9]{4}\b/g,
    fake: () => '0000 0000 0000',
  },
  { kind: 'IFSC', regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, fake: () => 'KOSH0000001' },
  // Indian mobile numbers, with an optional +91 / 91 / 0 prefix.
  {
    kind: 'PHONE',
    regex: /(?<![0-9])(?:\+91[- ]?|91[- ]?|0)?[6-9][0-9]{9}(?![0-9])/g,
    fake: (n) => `90000${pad(n, 5)}`,
  },
];

/** Values that look like personal data but are the documented fakes, so they are allowed. */
const ALLOWED = [
  /^ABCDE1234F$/,
  /@example\.(test|com|org)$/i,
  /^user\d+@upi$/,
  /^IN000000-?\d{8}$/,
  /^0{8,}\d*$/,
  /^0000 0000 0000$/,
  /^KOSH0000001$/,
  /^90000\d{5}$/,
  /^noreply@/i,
];
const isAllowed = (value: string) => ALLOWED.some((a) => a.test(value));

export interface PiiFinding {
  kind: PiiPattern['kind'];
  line: number;
  /** Masked so that reports never repeat the value: first two characters, then asterisks. */
  masked: string;
}

const mask = (v: string) => `${v.slice(0, 2)}${'*'.repeat(Math.max(3, v.length - 2))}`;

/** Find personal-data patterns in text. Documented fake values are ignored. */
export function scanPii(text: string): PiiFinding[] {
  const findings: PiiFinding[] = [];
  text.split(/\r?\n/).forEach((lineText, i) => {
    const claimed: [number, number][] = [];
    for (const p of PII_PATTERNS) {
      for (const m of lineText.matchAll(p.regex)) {
        const start = m.index;
        const end = start + m[0].length;
        if (claimed.some(([s, e]) => start < e && end > s)) continue; // part of an earlier match
        claimed.push([start, end]);
        if (!isAllowed(m[0])) findings.push({ kind: p.kind, line: i + 1, masked: mask(m[0]) });
      }
    }
  });
  return findings;
}

/**
 * Replace personal data with consistent fakes: the same real value always becomes the same fake,
 * and different real values stay different (so folio or account columns keep their meaning).
 */
export function redactPii(text: string): { text: string; replaced: Record<string, number> } {
  const maps = new Map<string, Map<string, string>>();
  const replaced: Record<string, number> = {};
  let out = text;
  for (const p of PII_PATTERNS) {
    const byValue = maps.get(p.kind) ?? new Map<string, string>();
    maps.set(p.kind, byValue);
    out = out.replace(p.regex, (value) => {
      if (isAllowed(value)) return value;
      let fake = byValue.get(value);
      if (!fake) {
        fake = p.fake(byValue.size + 1);
        byValue.set(value, fake);
      }
      replaced[p.kind] = (replaced[p.kind] ?? 0) + 1;
      return fake;
    });
  }
  return { text: out, replaced };
}
