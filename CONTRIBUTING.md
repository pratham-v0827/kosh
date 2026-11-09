# Contributing to Kosh

Thanks for helping. This guide assumes you have never seen the project before.

## 1. Set up

Follow the README **Quick start**. It works on Windows, macOS and Linux. Windows notes:

- Line endings are LF everywhere (`.gitattributes`). Your editor should respect `.editorconfig`.
- The Firebase emulators need **JDK 21+** on `PATH` / `JAVA_HOME`.

## 2. Ground rules

1. **Never commit real financial data.** No real broker exports, CAS PDFs, screenshots with real numbers, PANs, emails, folio or account numbers.
   - Parser fixtures must be redacted, as described in [docs/PLAN.md §3](docs/PLAN.md#3-files-i-need-from-you).
   - `packages/parsers/fixtures/_incoming/` is git-ignored for raw files.
2. **Never handle broker passwords.** Use official OAuth or token flows, or file uploads.
3. **Integrations are read-only.** Order-placement endpoints must never be implemented.
4. **No secrets in code, docs, issues or PRs.** Use `.env.local` (git-ignored).
5. **Admins must never see personal or financial data.** Admin server code may only import the admin metadata repository.

## 3. Workflow

- Branch from `main`: `feat/…`, `fix/…`, `docs/…`.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat(core): add TWR`).
- Before opening a PR, run:
  ```bash
  pnpm lint && pnpm typecheck && pnpm test && pnpm test:rules && pnpm build
  ```
- Changes to maths in `packages/core` need tests with **known expected values** (cite the source, e.g. a spreadsheet result).
- Changes to `firebase/firestore.rules` need matching tests in `firebase/tests/`.
- Significant design changes need an ADR in `docs/adr/` (copy the template).

## 4. Adding a parser or price provider

Adding a price provider: see [docs/prices.md](docs/prices.md#adding-a-provider). The parser guide arrives with M3 (`docs/guides/adding-a-parser.md`).
Every parser is versioned (`zerodha.tradebook@1.0.0`) and implements `detect → validate → parse → normalise`.

## 5. Troubleshooting

- **The dev page reloads itself in a loop** after many files change at once (formatting, tests): stop `pnpm dev:all` and start it again.
- **Signed in but seeing an empty ledger** after restarting the emulators: emulator data is wiped on restart; Kosh signs you out on the next load. Use `pnpm seed` to recreate demo data.
- **Emulators fail to start**: they need JDK 21+ on `PATH`.

## 6. Code of conduct

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).
