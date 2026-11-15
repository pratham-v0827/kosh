#!/usr/bin/env node
// Fail if any committed parser fixture (or the public CSV template) contains something that looks
// like personal data. Run by the pre-commit hook and by `pnpm check:pii`; the same scan also runs
// in the test suite, so CI enforces it even where the hook is not installed.
// Findings are printed masked. `fixtures/_incoming/` is git-ignored and is not scanned.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanPii } from '../src/pii.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    if (name === '_incoming' || name === 'node_modules') return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const files = [
  ...walk(join(root, 'packages/parsers/fixtures')),
  join(root, 'apps/web/public/templates/kosh-import-template.csv'),
];

let problems = 0;
let skipped = 0;
for (const f of files) {
  const bytes = readFileSync(f);
  if (bytes.includes(0)) {
    // Spreadsheets are binary or compressed: this quick script cannot open them. The test suite
    // does (test/registry-pii.test.ts reads every cell), so they are still checked before merge.
    skipped++;
    continue;
  }
  for (const hit of scanPii(bytes.toString('utf8'))) {
    problems++;
    console.error(`${relative(root, f)}:${hit.line}  ${hit.kind}  ${hit.masked}`);
  }
}
if (problems > 0) {
  console.error(
    `\n${problems} value(s) look like personal data. Redact them (pnpm fixture:redact) before committing.`,
  );
  process.exit(1);
}
console.log(
  `Fixtures clean: ${files.length - skipped} text file(s) scanned` +
    (skipped
      ? `; ${skipped} spreadsheet(s) are scanned cell by cell by the test suite (pnpm test).`
      : '.'),
);
