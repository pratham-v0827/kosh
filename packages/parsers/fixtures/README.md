# Parser fixtures

Redacted sample statements, one folder per format. Parsers are built and tested against these.

- **Everything here is public.** A fixture must contain no real name, PAN, email, phone, address,
  demat or folio number, bank detail or wallet address.
- Put raw or half-redacted files only in `_incoming/` (create it if needed). That folder is
  git-ignored and is never scanned or committed.
- `pnpm fixture:redact <file>` writes a redacted copy into `_incoming/`.
- `pnpm check:pii` scans every committed fixture; the test suite runs the same scan.

See [docs/guides/adding-a-parser.md](../../../docs/guides/adding-a-parser.md).
