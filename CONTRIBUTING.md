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

Guides arrive with M2/M3 (`docs/guides/adding-a-parser.md`, `docs/guides/adding-a-price-provider.md`).
Every parser is versioned (`zerodha.tradebook@1.0.0`) and implements `detect → validate → parse → normalise`.

## 5. Code of conduct

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).
