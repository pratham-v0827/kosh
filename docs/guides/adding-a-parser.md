# Adding a statement parser

A parser turns one export format of one source (for example the Zerodha tradebook CSV) into Kosh's
normalised rows. Everything else — upload, preview, duplicate detection, confirm, undo — is the
import framework and needs no change.

**No parser is built from a guessed format.** Start from a real export, redacted.

## 1. Prepare a sample

1. Export the statement yourself. Do not send real files to anyone, and do not paste them in an
   issue or chat.
2. Redact it locally:

   ```bash
   pnpm fixture:redact "C:\path\to\export.csv"
   ```

   This replaces PAN, email, phone, demat/BO id, Aadhaar, IFSC and UPI values with consistent fakes
   and writes the result to `packages/parsers/fixtures/_incoming/`, which is git-ignored. It prints
   counts only, never the values.

3. Open the output and replace by hand what has no fixed shape: names, addresses, folio numbers,
   bank account numbers. Keep column headers, date and number formats and row order untouched.
4. When it is clean, move it to `packages/parsers/fixtures/<source>-<format>/sample.<ext>`.
   `pnpm check:pii` (also run by the tests and the pre-commit hook) must pass.

Install the pre-commit hook once with `pnpm hooks:install`.

## 2. Document the format

Write `docs/parsers/<source>-<format>.md`: where the export is in the broker's app, every column,
its date and number formats, and anything surprising (totals rows, merged headers, sign
conventions).

## 3. Write the parser

Add `packages/parsers/src/<source>-<format>.ts` exporting a `Parser`
([types](../../packages/parsers/src/types.ts)), and list it in `PARSERS` in
[`registry.ts`](../../packages/parsers/src/registry.ts). Use
[`kosh-csv.ts`](../../packages/parsers/src/kosh-csv.ts) as the model.

- `detect(input)` looks only at the header or file signature and returns 0…1. It must be at least
  0.8 on its own fixture and below 0.2 on every other fixture.
- `parse(input, ctx)` returns rows and issues. Validate each row with the shared schemas from
  `@kosh/contracts`, so imported data obeys the same limits and symbol rules as manual entry.
- Throw `ImportError` for problems with the whole file. Its message is shown to the user: write
  advice, never echo file contents, the file name or a password.
- Bump the **major** version when the source changes its layout; keep the old version if old
  exports are still in circulation.

## 4. Test it

In `packages/parsers/test/`:

- detection: ≥ 0.8 on its fixture, < 0.2 on all others;
- the normalised output of the fixture as a snapshot;
- bad rows become issues, good rows survive;
- importing the fixture twice plans 0 new rows (see `apps/web/test/import-plan.test.ts`).

Then run `pnpm lint && pnpm typecheck && pnpm test`.
