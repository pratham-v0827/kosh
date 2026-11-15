# M3 exit report: go / no-go (2026-11-15)

## Verdict

**GO** for merging M3 into `main` and tagging **v0.3.0**, once the pull request's CI (including the
new `e2e` job) is green on GitHub.

**GO, with two checks on your first preview deployment,** for deploying it:

1. **Google sign-in.** BUG-025 changed how the Google popup and redirect are started. Email-link
   sign-in is covered end to end; Google's own pages cannot be reached from the emulator, so sign
   in with Google once on the preview.
2. **Deploy the Firestore rules** (`pnpm firebase:deploy-rules`). SEC-015 (shared price data can no
   longer be listed) only takes effect on your project once the rules are deployed.

## What M3 delivered

| Phase                       | Outcome                                                                                                                                                                  | Record                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 1 File analysis, spec       | Both real exports analysed; layouts, quirks and reconciliation rules written down                                                                                        | `docs/parsers/m3-holdings-spec.md`                            |
| 2 Parsers                   | Groww holdings (.xlsx) and INDmoney US holdings (.xls) parsers on in-house, size-capped readers; invented, redacted fixtures                                             | `docs/parsers/groww-holdings.md`, `…/indmoney-us-holdings.md` |
| 3 UI/UX upgrade             | Dashboard (XIRR, value chart, allocation incl. market cap, insights, index comparison), holdings consolidation, price charts, privacy mode, dollar view, command palette | `docs/m3/phase3-gap-analysis.md`                              |
| 4 Bug audit                 | 5 bugs and 1 privacy issue found and fixed                                                                                                                               | `docs/audits/m3-bugs.md`                                      |
| 5 End-to-end                | Playwright walkthrough as `pratham_test` + page checks; found and fixed 4 more bugs                                                                                      | `apps/web/e2e/README.md`                                      |
| 6 CI, release (this report) | `e2e` CI job; changelog and README for v0.3.0                                                                                                                            | `.github/workflows/ci.yml`, `CHANGELOG.md`                    |

Across M3, 14 bugs (BUG-013 to BUG-026) and 2 security issues (SEC-014, SEC-015) were fixed, each
with a test that failed before the fix.

Deviations from the plan, all agreed or reported: allocation uses ranked bars rather than a donut;
the treemap and sector allocation are deferred; CoinDCX and CAS parsers move to M4.

## Evidence

| Check                                                                          | Result                                                                                                       |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Fresh clone of the branch in an empty folder, `pnpm install --frozen-lockfile` | passes                                                                                                       |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` (in the clone)              | pass                                                                                                         |
| Unit tests (in the clone)                                                      | 428 pass, 2 skipped (the local-only real-file test): core 108, contracts 12, parsers 115, prices 70, web 123 |
| `pnpm build` (in the clone)                                                    | passes                                                                                                       |
| `pnpm audit --audit-level high` (in the clone)                                 | passes: 0 critical, 0 high (4 moderate, 1 low, accepted in Phase 3)                                          |
| Firestore rules tests (emulator)                                               | 26 pass                                                                                                      |
| API smoke test against the emulators, live free price sources                  | 123 checks pass                                                                                              |
| End-to-end, mock prices (walkthrough + 14 page checks at 1280 and 360 px)      | 4 consecutive full runs, 15/15 each; 0 console errors, 0 failed requests, 0 axe violations                   |
| End-to-end in CI mode, inside the fresh clone                                  | 15/15 pass                                                                                                   |
| End-to-end, live free price sources (one run)                                  | passes                                                                                                       |
| Real Groww and INDmoney exports (local only, statuses printed, nothing kept)   | both parse and reconcile                                                                                     |
| Secrets in everything M3 adds; real export files or their names in git         | none                                                                                                         |
| Fixture PII check (`pnpm check:pii`, spreadsheets cell by cell in tests)       | clean                                                                                                        |
| Paid services or keys                                                          | none: every source is free or key-less; E2E uses invented data                                               |

## Data handling (the M3 brief's rules)

- Your real files were never committed; `.gitignore` covers spreadsheets, PDFs, export file names
  and any uploads folder. Fixtures are invented copies with the same structure (summary shown and
  approved in Phase 2).
- Real data was used only in the local emulator and in the local-only test, which prints statuses
  only. No screenshot, video or log contains it: all recordings use the invented fixtures and mock
  prices. Videos live in `artifacts/videos/m3/`, which is git-ignored.
- Uploaded files are parsed in memory and dropped; only normalised holdings and a SHA-256 of the
  file are stored, per user.
- `pratham_test` exists only in the Auth emulator; its password comes from `E2E_PASSWORD` or is
  random per run, and is never printed or stored.

## Not verified (cannot be, before the pull request)

- **The `e2e` job has never run on GitHub.** It passed in CI mode in a fresh clone on Windows; the
  first Linux run is the pull request's.
- **Screenshot baselines on Linux.** CI runs every other end-to-end check but does not compare
  screenshots until Linux baselines are committed (the Windows ones are in
  `apps/web/e2e/__screenshots__/win32/`).
- **Google sign-in against Google** (see Verdict).
- **Menu paths in the brokers' apps** ("Profile → Reports → …") come from third-party guides and are
  marked unverified in the app.

## Known limits carried forward

- Undoing a statement import does not bring back the statement before it (documented).
- Index history covers ten years; older purchases get no index comparison (the card says so).
- Market cap uses AMFI's half-yearly list; newer listings count as small cap until the next one.
- Unlisted shares are priced by hand (with links to price lists); scraping them was declined because
  those sites refuse automated clients or forbid it in their terms.
- Sign-up control and App Check are still needed before inviting strangers (Phase 5 report, M2).
