#!/usr/bin/env node
// Redact a sample statement before it is used to build a parser.
//
//   pnpm fixture:redact "C:\Users\you\Downloads\tradebook.csv"
//
// Reads a TEXT file (CSV/TSV/TXT) from anywhere on this computer, replaces PAN, email, phone,
// demat/BO ids, Aadhaar, IFSC and UPI ids with consistent fakes, and writes the result to
// packages/parsers/fixtures/_incoming/ (git-ignored). Nothing leaves this computer.
// It prints how many values of each kind were replaced, never the values themselves.
//
// Names, addresses and folio numbers have no fixed shape, so this cannot catch them:
// open the output and replace those by hand before sharing or committing it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactPii, scanPii } from '../src/pii.ts';

const TEXT_EXTENSIONS = new Set(['.csv', '.tsv', '.txt', '.json']);
const MAX_BYTES = 4 * 1024 * 1024;

const file = process.argv[2];
if (!file) {
  console.error('Usage: pnpm fixture:redact <path-to-statement.csv>');
  process.exit(2);
}
const ext = extname(file).toLowerCase();
if (!TEXT_EXTENSIONS.has(ext)) {
  console.error(
    `Only text files are supported for now (${[...TEXT_EXTENSIONS].join(', ')}).\n` +
      'For an Excel file, use "Save as → CSV UTF-8" first. PDF support arrives with the CAS parser.',
  );
  process.exit(2);
}

const bytes = readFileSync(resolve(file));
if (bytes.length > MAX_BYTES) {
  console.error('The file is larger than 4 MB. Export a shorter date range.');
  process.exit(2);
}
if (bytes.includes(0)) {
  console.error('This looks like a binary file, not text. Save it as CSV UTF-8 first.');
  process.exit(2);
}

const { text, replaced } = redactPii(bytes.toString('utf8'));
const outDir = fileURLToPath(new URL('../fixtures/_incoming/', import.meta.url));
mkdirSync(outDir, { recursive: true });
// The original name often contains a client id, so the output gets a neutral one.
const out = join(outDir, `sample-${Date.now()}.redacted${ext}`);
writeFileSync(out, text);

const kinds = Object.entries(replaced);
console.log(`Read the file (${bytes.length} bytes).`);
console.log(
  kinds.length
    ? `Replaced: ${kinds.map(([k, n]) => `${n} × ${k}`).join(', ')}`
    : 'No PAN, email, phone, demat, Aadhaar, IFSC or UPI values were found.',
);
const left = scanPii(text);
if (left.length > 0) {
  console.error(`Warning: ${left.length} value(s) still look personal. Check the output by hand.`);
}
console.log(`\nWritten to:\n  ${out}`);
console.log(
  '\nBefore using it: open the file and replace names, addresses and folio numbers by hand\n' +
    '(keep the column headers, date formats, number formats and row order exactly as they are).',
);
