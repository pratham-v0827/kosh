<p align="center">
  <img src="brand/kosh-mark.svg" width="72" height="72" alt="Kosh logo">
</p>

<h1 align="center">Kosh</h1>
<p align="center"><strong>Every investment. One ledger.</strong></p>
<p align="center">
  An open-source, multi-user investment tracker for Indian investors: Indian and US stocks,
  mutual funds, unlisted shares and crypto in one dashboard, with a private MCP server so you
  can ask Claude about your own portfolio.
</p>

> **Status: pre-alpha (Milestone 0: foundation).** Nothing here tracks real money yet.
> See the [roadmap](docs/PLAN.md#12-roadmap--milestones).

> **Disclaimer:** Kosh is **not investment advice** and is **not affiliated with** Zerodha, Groww,
> INDmoney, CAMS, KFintech, MFCentral, CoinDCX, NSE, BSE or AMFI. Prices may be delayed or wrong.

## Planned features

- Portfolio dashboard: net worth, invested, P&L, day change, allocation, value over time
- Latest prices with a visible **Last refreshed** time and stale-price badges
- Immutable snapshot on every refresh; returns over 1W / 1M / 3M / 6M / 1Y / All
- XIRR, CAGR, FIFO realised vs. unrealised P&L, FX attribution for US holdings
- Imports: Zerodha (Kite Connect + tradebook), Groww, INDmoney, CAMS/KFintech CAS, CoinDCX
- Manual and unlisted holdings
- Remote MCP server (OAuth, read-only by default) for Claude
- Admin console that **cannot** see anyone's financial data
- Opt-in weekly or monthly email summary
- **Never asks for your broker password**

## Supported sources and file formats

| Source          | Method                                                   | Status          |
| --------------- | -------------------------------------------------------- | --------------- |
| Zerodha         | Kite Connect (your own free app) + Console tradebook CSV | Planned (M3–M4) |
| Groww           | Holdings / order history export                          | Planned (M3)    |
| INDmoney        | Holding statement / US account statement                 | Planned (M3)    |
| Mutual funds    | CAMS/KFintech detailed CAS PDF                           | Planned (M3)    |
| CoinDCX         | Trade history export                                     | Planned (M3)    |
| Unlisted shares | Manual entry                                             | Planned (M1)    |

Parsers are built from real, redacted sample files only. See [docs/PLAN.md §3](docs/PLAN.md#3-files-i-need-from-you).

## Quick start (local, no cloud account needed)

Prerequisites:

- **Node.js 24+**
- **pnpm 12** (`npm install -g pnpm@12.18.0`)
- **Java JDK 21+**, needed by the Firebase emulators. On Windows, check with `java -version`. If that shows an older version, point `JAVA_HOME` (and `PATH`) at a JDK 21 install.
- **Git**

```bash
git clone <this repo> kosh
cd kosh
pnpm install
pnpm dev:all        # Firebase emulators (auth, firestore) + Next.js on http://localhost:3000
```

The app uses the offline Firebase project `demo-kosh`, so no Firebase or Vercel account is required for development.
The emulator UI is at http://127.0.0.1:4000.

## Scripts

| Command                             | What it does                                        |
| ----------------------------------- | --------------------------------------------------- |
| `pnpm dev:all`                      | Emulators + web app                                 |
| `pnpm dev`                          | Web app only (expects emulators running)            |
| `pnpm emulators`                    | Auth + Firestore emulators only                     |
| `pnpm build`                        | Production build of every package                   |
| `pnpm lint` / `pnpm typecheck`      | Static checks                                       |
| `pnpm test`                         | Unit tests (portfolio maths)                        |
| `pnpm test:rules`                   | Firestore security-rules tests against the emulator |
| `pnpm format` / `pnpm format:check` | Prettier                                            |

## Repository layout

```text
apps/web          Next.js app (UI, API routes, admin, MCP endpoint later)
packages/core     Domain model and portfolio maths (pure, fully tested)
packages/ui       Design tokens shared with the future Android app
firebase/         Firestore & Storage rules + rules tests
brand/            Logo and brand sheet
docs/             Plan, architecture decision records (ADRs)
```

More packages (parsers, prices, integrations, email, MCP tools) arrive with their milestones.

## Self-hosting

A full guide (Firebase project, Vercel, environment variables, budget alerts) ships with M9.
Every variable is documented in [.env.example](.env.example).

## Contributing and security

- [CONTRIBUTING.md](CONTRIBUTING.md): setup, conventions, and the rule that **real statements are never committed**
- [SECURITY.md](SECURITY.md): how to report a vulnerability privately
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## Licence

[AGPL-3.0-only](LICENSE). If you run a modified Kosh as a service for others, you must share your changes.
