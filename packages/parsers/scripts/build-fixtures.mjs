#!/usr/bin/env node
// Writes the statement fixtures from the INVENTED data in test/support/fixture-data.ts.
//
//   pnpm fixtures:build
//
// The fixtures mirror the layout of real broker exports (label rows, header text, cell types,
// number quirks) but every identity, holding, quantity and amount is made up. A test checks that
// the committed files still match what this script produces.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GROWW_SHEET_NAME,
  growwSheet,
  INDMONEY_SHEET_NAME,
  indmoneySheet,
} from '../test/support/fixture-data.ts';
import { writeXls } from '../test/support/write-xls.ts';
import { writeXlsx } from '../test/support/write-xlsx.ts';

const out = (rel) => fileURLToPath(new URL(`../fixtures/${rel}`, import.meta.url));

mkdirSync(out('groww-holdings/'), { recursive: true });
mkdirSync(out('indmoney-us-holdings/'), { recursive: true });

// Stored (uncompressed) so the bytes do not depend on the zlib version that built them.
const groww = writeXlsx([{ name: GROWW_SHEET_NAME, rows: growwSheet() }], { store: true });
writeFileSync(out('groww-holdings/holdings.xlsx'), groww);

const indmoney = writeXls([{ name: INDMONEY_SHEET_NAME, rows: indmoneySheet() }]);
writeFileSync(out('indmoney-us-holdings/holdings.xls'), indmoney);

console.log(`groww-holdings/holdings.xlsx          ${groww.length} bytes`);
console.log(`indmoney-us-holdings/holdings.xls     ${indmoney.length} bytes`);
