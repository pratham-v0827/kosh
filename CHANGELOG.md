# Changelog

All notable changes are documented here. The project follows [Semantic Versioning](https://semver.org/).
Parsers are versioned independently (e.g. `zerodha.tradebook@1.0.0`).

## [Unreleased]

## [0.3.0] - 2026-11-15

M3: broker statements, a richer dashboard, and an end-to-end test suite.

### Added

- Holdings-statement imports (snapshots that replace the same broker's previous statement):
  - Groww stocks holdings statement (`groww.holdings@1`, .xlsx): ISINs matched to NSE/BSE
    tickers once and cached; unmatched holdings kept, valued at the statement price, and mapped
    later from Import
  - INDmoney US stocks holdings report (`indmoney.us-holdings@1`, .xls): USD lots with the ECB
    rate on the first-purchase date, marked approximate
  - Preview shows added, changed, unchanged and removed holdings and checks the file against its
    own totals; nothing is removed when any row could not be read; an older statement needs an
    explicit yes; only a SHA-256 of the file is kept
  - In-house, size-capped .xls and .xlsx readers (no spreadsheet dependency)
- Dashboard: current value with price-source badges, XIRR, value-over-time chart (1W to All, with
  a table view), allocation by asset type, broker, country, kind or market cap (AMFI's list,
  `pnpm data:market-cap`), insights (biggest moves, large positions, holding period), and a
  comparison of each market's XIRR with the Nifty 50, Sensex and S&P 500 on the same cash flows
- Holdings: one row per share across accounts and exchanges (NSE + BSE), per-account breakdown,
  combined XIRR, broker filter, column chooser; a holding's daily price (or NAV) chart with your
  average cost
- Privacy mode (Shift+H), US-dollar view (Shift+U), command palette (Ctrl/Cmd+K)
- Import page: a card per source with how to export the file and when it was last imported
- End-to-end tests (Playwright, apps/web/e2e): a recorded walkthrough as an emulator-only user
  and checks of every page at desktop and phone width with axe (WCAG 2.2 AA) and screenshots; a
  required CI check. Invented, deterministic market data for these runs (`KOSH_MOCK_PRICES`,
  emulators only)
- M3 import framework:
  - `@kosh/parsers`: parser interface and registry (detect → parse → normalise, in memory only),
    fingerprint de-duplication, and the first format, the Kosh CSV template (`kosh.csv@1`)
  - Import page: upload, preview with New / Already imported / Needs attention, untick rows,
    confirm, import history with undo
  - API: `POST /api/v1/imports` (preview), `POST /api/v1/imports/:id/confirm`,
    `DELETE /api/v1/imports/:id` (discard or undo)
  - Importing the same statement twice adds nothing; identical rows inside one file are kept
  - Limits: 4 MB and 450 rows per file, 30 uploads and 2,000 imported rows per user per day
  - Fixture tooling: `pnpm fixture:redact`, `pnpm check:pii`, optional pre-commit hook
    (`pnpm hooks:install`); docs/parsers/kosh-csv.md and docs/guides/adding-a-parser.md

### Fixed

- M3 bug audit (docs/audits/m3-bugs.md): 14 bugs fixed, each with a test that failed first,
  including:
  - dates with an impossible month or day were accepted (BUG-013, BUG-017)
  - confirming a statement preview after undoing the previous import dropped the holdings marked
    "unchanged" (BUG-018); two rows or a mapping onto an existing ticker double-counted a share
    (BUG-019, BUG-020)
  - one share bought on NSE and on BSE showed as two rows (BUG-016)
  - toasts and wide tables on phones failed WCAG checks (BUG-023, BUG-024)
  - on phones, Google's sign-in script loaded on every page (BUG-025)

### Security

- Shared price data can be read one document at a time but no longer listed, which revealed what
  other users of an instance hold (SEC-015)
- Two spreadsheet inputs that took quadratic time are now linear (BUG-015, SEC-014)
- Simultaneous requests fetch a day's price history once (BUG-021)

## [0.2.0] - 2026-11-14

### Security

- Security audit (docs/audits/phase3-security.md): 13 findings fixed, each with a test
  - Content-Security-Policy and cross-origin headers
  - Per-user edit limits (30 a minute, 500 a day) and portfolio size ceilings
  - Public health check is read-only and cached; no project details in the response
  - Daily job refuses weak or placeholder secrets; price step capped per run
  - Open redirect after sign-in closed; ids from URLs validated; request bodies capped while streaming
  - Emulator mode refused on every Vercel deployment
- CI: CodeQL analysis, dependency audit gate, actions pinned to commit SHAs, lint for all packages

### Fixed

- Bug audit (docs/audits/phase2-bugs.md): 11 bugs fixed, each with a test, including
  - a temporary network error no longer signs the user out
  - crypto quantities keep 8 decimals
  - a manual price set today is respected over a same-day provider quote
  - day change ignores price moves from before a purchase
  - the price-coverage API route was missing from the repository (hidden by `.gitignore`)

### Added

- Free price sources for stocks (ADR-0020): Yahoo Finance (unofficial, on by default) for NSE and US,
  Alpha Vantage free key for BSE with a shared daily budget; exchange picker for Indian stocks
- Bring-your-own-Firebase setup: `pnpm check-env`, `pnpm admin:grant`, docs/self-hosting.md
- M2 prices, refresh and snapshots:
  - `@kosh/prices`: pluggable providers (AMFI NAV file, mfapi.in, CoinDCX ticker, Finnhub, Twelve Data, Frankfurter/ECB FX), cache-first refresh with fallback, staleness rules
  - USD holdings: per-lot FX at trade date (ECB reference unless entered), INR P&L split into stock and currency effects
  - Day change (previous close / NAV / 24h for crypto, incl. FX move)
  - Refresh button with “Last refreshed … IST”, 5-minute cooldown and 30/day limit
  - Immutable snapshots on every refresh, yearly series, Refresh history page
  - Daily job `/api/cron/daily` (Vercel cron), paged and idempotent; `pnpm cron`, `pnpm seed`
  - Stale / missing price badges; Settings → Price sources
- NSE/BSE direct downloads refuse automated clients (ADR-0019, superseded by ADR-0020)

- M1 sign-in, app shell and manual holdings:
  - Google and email-link sign-in (no passwords); account created on first sign-in with consent record
  - App shell with desktop nav, mobile bottom nav, skip link, light/dark/system theme
  - Settings: Indian or international number format, theme, email-summary opt-in
  - Manual and unlisted holdings: buys, sells, dividends, charges, splits, bonuses, manual prices
  - Append-only ledger (edits keep history) with FIFO cost basis, realised/unrealised P&L and XIRR
  - Dashboard, holdings list (tabs, search, sort, mobile cards) and holding detail with lots
  - `@kosh/contracts` shared validation; `pnpm smoke` API checks
  - Terms and privacy notice templates

- M0 foundation:
  - pnpm + Turborepo monorepo
  - Next.js 16 web app with Tailwind 4 and shadcn/ui
  - Kosh design tokens and logo
  - `@kosh/core` with tested XIRR and CAGR
  - Firestore/Storage security rules with emulator tests
  - local Firebase emulators (offline `demo-kosh` project)
  - CI workflow
  - project plan and ADRs
