# Changelog

All notable changes are documented here. The project follows [Semantic Versioning](https://semver.org/).
Parsers are versioned independently (e.g. `zerodha.tradebook@1.0.0`).

## [Unreleased]

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
