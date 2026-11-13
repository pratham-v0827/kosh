# Phase 5 — go / no-go (2026-11-14)

## Verdict

**GO** for publishing the repository and merging to `main`.
**GO, with two conditions,** for inviting people you do not know onto a hosted instance
(see "Before opening to strangers").

## What was checked

| Check                                                                          | Result                                                               |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Fresh clone of the branch in an empty folder, `pnpm install --frozen-lockfile` | passes                                                               |
| `pnpm format:check`                                                            | passes                                                               |
| `pnpm lint` (web app, all shared packages, rules tests, scripts)               | passes, 0 warnings                                                   |
| `pnpm typecheck` (TypeScript strict)                                           | passes                                                               |
| Unit tests                                                                     | 183 pass: core 67, contracts 12, prices 39, web 65                   |
| Firestore rules tests (emulator)                                               | 23 pass                                                              |
| `pnpm build` (production)                                                      | passes; all 10 API routes are request-time                           |
| `pnpm audit --audit-level high`                                                | passes: 0 critical, 0 high (4 moderate, 1 low accepted, see Phase 3) |
| API smoke test against the emulators, live free price sources                  | 68 checks pass                                                       |
| Production build served locally with the strict CSP                            | sign-in and live dashboard work, no CSP violations                   |
| `pnpm check-env --file .env.example`                                           | fails as it should, naming each missing value and where to get it    |
| Secrets scan, tree and full history                                            | nothing to rotate                                                    |
| Paid services or keys                                                          | none; every source is free tier or key-less                          |

The fresh clone matters because of BUG-011: a route that existed on this machine had never been
committed. That class of problem is now caught by a test and by the clone run.

## Phase summary

| Phase                                         | Outcome                                                                       | Record                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------- |
| 1 Free price sources, bring-your-own-Firebase | Done                                                                          | `docs/prices.md`, `docs/self-hosting.md`, ADR-0020 |
| 2 Bug audit                                   | 11 bugs fixed, 1 follow-up (BUG-012), each with a test                        | `docs/audits/phase2-bugs.md`                       |
| 3 Security audit                              | 13 findings fixed, each with a test; accepted risks listed                    | `docs/audits/phase3-security.md`                   |
| 4 CI                                          | Workflows ready: verify, dependency audit, CodeQL, Dependabot; actions pinned | `.github/workflows/`                               |
| 5 Dry run                                     | This document                                                                 | —                                                  |

## Not verified (cannot be, before publishing)

- **The GitHub workflows have never run on GitHub.** They mirror the commands that pass locally,
  but the first real run happens on the pull request.
- **CodeQL results.** Analysis only runs on GitHub.
- **Google sign-in on a real Firebase project.** The emulator covers email-link sign-in and the
  popup flow's local stand-in; the CSP entries for Google sign-in (`apis.google.com`, the auth
  domain frame) follow Firebase's documented needs but have not been exercised against Google.
  Check this on your first preview deployment.
- **Vercel cron and limits.** Tested locally through `pnpm cron`; not on Vercel.

## Before opening to strangers

1. **Sign-up control.** Limits are per account and accounts are free to create. Add an invite
   list or a sign-up cap first (planned with the admin milestone).
2. **App Check** on the Firebase project, so the project's API key cannot be scripted from
   outside the app (docs/self-hosting.md §6).

Neither blocks personal use or use by people you trust.

## Known limits carried forward

- CSP allows inline scripts, a Next.js constraint for prerendered pages (Phase 3, accepted risk 1).
- No per-IP rate limit for signed-out traffic (accepted risk 2).
- Unlisted-share prices are entered by hand; the sites that publish them forbid automated access.
- More than 40 Yahoo-priced stocks take two refreshes to update fully.

## Next

1. Publish and merge (needs your explicit yes; exact steps are listed in the hand-over message).
2. M3, imports and parsers. The import framework, preview/confirm flow, de-duplication and the
   fixture tooling can start right away. Each parser (CAS, Zerodha, Groww, INDmoney, CoinDCX) needs
   a redacted sample file from you in `packages/parsers/fixtures/_incoming/` (git-ignored).
