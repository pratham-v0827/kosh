# Phase 3 — security audit (2026-11-09 → 2026-11-14)

**Scope (as agreed):** this codebase, the local Firebase emulators, and a production build served
on localhost. No third-party service (Yahoo, Alpha Vantage, Google, Vercel) was probed, load
tested or attacked. No secret values appear in this document.

**Method:** attack-surface map (10 API routes, Firestore rules, client auth flows, outbound price
requests), review against the OWASP Top 10 (2021) and the OWASP API Security Top 10 (2023),
secrets scan of the tree and the full git history, dependency audit, then for every confirmed
finding: a failing test, the fix, the test passing. Live checks ran through `pnpm smoke` and the
browser pane.

Severity: **High** = one user (or anyone) can harm other users or the whole instance ·
**Medium** = abuse needs an account, or impact is limited · **Low** = hardening / defence in depth.

## Findings

| ID      | OWASP      | Finding                                                                                                                                                                          | Severity                                    | How it could be abused                                                                                                                                         | Fix                                                                                                                                                                                             | Test                                                                                                        |
| ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| SEC-001 | A01        | Open redirect after sign-in: `?next=/%09/evil.example` passed the prefix check.                                                                                                  | Medium                                      | A sign-in link that lands the user on an attacker's site right after a real Kosh sign-in (phishing). Browsers strip tab/CR/LF and read `\` as `/`.             | `safeNext` rejects control characters and backslashes, then requires the resolved URL to stay on the same origin.                                                                               | `apps/web/test/safe-next.test.ts` (13 cases)                                                                |
| SEC-002 | API4       | No limit on ledger edits. Every edit re-reads the user's whole ledger in a transaction.                                                                                          | High                                        | One free account loops edits and burns the instance's Firestore free-tier quota (50k reads / 20k writes a day), stopping the app for everyone.                 | Per-user limits inside the same transaction: 30 edits a minute, 500 a day; ceilings of 5,000 active transactions and 500 holdings.                                                              | `apps/web/test/limits.test.ts`; smoke "burst of edits → 429"                                                |
| SEC-003 | A01 / API3 | `PUT /instruments/:id/price` accepted any id, including ones the caller does not hold and path-like ids.                                                                         | Medium                                      | Unlimited junk `manualPrices` documents (each one read on every later edit), and writes to unintended paths under the caller's own tree. No cross-user access. | The id must be one of the caller's instruments, checked in the transaction.                                                                                                                     | smoke "bob pricing alice's instrument → 404, nothing written"                                               |
| SEC-004 | API4       | Manual price history grew without bound (`arrayUnion`).                                                                                                                          | Low                                         | A document creeping to Firestore's 1 MiB limit, after which price updates fail.                                                                                | History keeps the newest 50 entries.                                                                                                                                                            | `limits.test.ts`; smoke "history is bounded"                                                                |
| SEC-005 | API4       | Request bodies were buffered whole before the size check when `Content-Length` was absent (chunked).                                                                             | Low                                         | Memory pressure on a function with a stream of large bodies.                                                                                                   | Bodies are read as a stream and cut off at 32 KiB → 413.                                                                                                                                        | `apps/web/test/read-json.test.ts`; smoke "oversized body → 413"                                             |
| SEC-006 | API4       | Per-symbol price lookups had no per-run cap and unknown tickers were retried on every run.                                                                                       | High                                        | One account adds a few hundred fake tickers; the shared daily job spends its 60 s on them and never snapshots anyone.                                          | Providers declare `maxPerRun` (Yahoo: 40); instruments that already have a price go first, never-priced ones last; price step and snapshots share one time budget.                              | `packages/prices/test/fairness.test.ts`; `cron-auth.test.ts` (budget)                                       |
| SEC-007 | API4 / A05 | Public `/api/health` wrote to Firestore on every call and returned the project id and raw error text.                                                                            | High                                        | Anyone, without an account, exhausts the daily write quota with ~20k requests; error text can leak configuration.                                              | Read-only check, cached 60 s per instance (failures 5 s); on a real project the body is only `ok` / `degraded`.                                                                                 | `apps/web/test/health.test.ts`; smoke "health"                                                              |
| SEC-008 | A07 / A05  | The daily job accepted any configured secret, including the placeholder published in `.env.development`.                                                                         | Medium                                      | If a self-hoster copied the local value to production, anyone could trigger the job.                                                                           | On a real project the secret must be ≥ 32 characters and not the placeholder, else the endpoint answers 503.                                                                                    | `apps/web/test/cron-auth.test.ts`                                                                           |
| SEC-009 | A03        | Ids from the URL went to Firestore paths unvalidated; a bad escape (`%zz`) caused a 500.                                                                                         | Low                                         | Error noise, and path-shaped ids reaching document references (within the caller's own tree only).                                                             | `instrumentIdParam` / `docIdParam` validate shape → 404.                                                                                                                                        | `apps/web/test/params.test.ts`; smoke "malformed or path-like ids"                                          |
| SEC-010 | A05        | Emulator mode (which accepts **unsigned** tokens) was refused only on Vercel _production_, and had no test.                                                                      | Medium                                      | A preview deployment with a stray emulator variable would trust forged tokens.                                                                                 | Refused on every Vercel deployment; now under test.                                                                                                                                             | `apps/web/test/emulator-guard.test.ts`                                                                      |
| SEC-011 | A05        | No Content-Security-Policy; no cross-origin isolation headers.                                                                                                                   | Medium                                      | Any future injection bug could load scripts from, or send data to, any site.                                                                                   | CSP limited to this site plus the Firebase/Google sign-in endpoints; `frame-ancestors 'none'`, `object-src 'none'`, `base-uri`/`form-action 'self'`; COOP, CORP and a wider Permissions-Policy. | `apps/web/test/security-headers.test.ts`; smoke "security headers"; production build checked in the browser |
| SEC-012 | A01        | The client-writable `settings.staleness` map had no shape or size limit.                                                                                                         | Low                                         | A user bloats their own profile document from the browser.                                                                                                     | Rules allow only the five asset-class keys with 1–3650 day integers.                                                                                                                            | `firebase/tests/rules.test.ts` (3 new tests)                                                                |
| SEC-013 | A06        | `@grpc/grpc-js` 1.9.16 (high-severity advisory) via the Firebase client SDK's Node build.                                                                                        | Low (not reachable from the browser bundle) | —                                                                                                                                                              | pnpm override to ≥ 1.13.6 (resolves to 1.14.7).                                                                                                                                                 | `pnpm audit`: 0 high, 0 critical                                                                            |
| BUG-012 | —          | Regression from BUG-001: a dead session with `auth/invalid-refresh-token` showed an empty dashboard instead of returning to sign-in. No data was exposed (the token is invalid). | Medium                                      | —                                                                                                                                                              | Code added to the dead-session list.                                                                                                                                                            | `apps/web/test/auth-errors.test.ts`; checked live                                                           |

## Verified, no finding

- **Cross-user isolation (API1/A01).** Every route takes the user id from the verified token,
  never from input. Smoke: Bob cannot delete, edit, sell or price Alice's data (404 each) and her
  book is unchanged. Rules tests: no client can read another user's documents, list `users`, run
  collection-group queries across users, or read server-only collections; admins cannot read
  `/users/**`.
- **Authentication (A07).** No token, garbage, an unsigned (`alg: none`) token, a tampered
  signature and the wrong scheme all return 401. Tokens are verified with revocation checks;
  blocked users get 403. There are no passwords and no session cookies, so CSRF does not apply.
- **Mass assignment (API3).** Extra fields (`uid`, `accountId`, `status`, `role`) are dropped;
  `role` cannot be self-assigned.
- **Injection / XSS (A03).** Holding names and notes containing `<img onerror>`, `<script>` and
  `javascript:` render as text; nothing executes; no `dangerouslySetInnerHTML`; external links use
  `rel="noopener noreferrer"`.
- **SSRF (A10).** Outbound requests go only to an allow-list of provider hosts, with redirects
  refused and symbols restricted to a safe character set (tests in `packages/prices`).
- **Errors and logs (A09).** Unexpected errors return a reference id only; logs carry no tokens,
  emails or user ids.
- **CORS.** No `Access-Control-Allow-Origin` is sent; other origins cannot read API responses.
- **Secrets (A02).** Pattern scan of the tree and of every commit: one match, the
  `CRON_SECRET` line in `apps/web/.env.development`. It is the documented local placeholder
  (also printed in the scripts), not a real secret; SEC-008 now refuses it on a real project.
  Nothing to rotate. Real values live only in `.env.local` (git-ignored) or the host's settings.
- **Emulators** bind to 127.0.0.1 only. Cloud Storage rules deny everything.

## Dependency audit (`pnpm audit`, 2026-11-13)

After the override: **0 critical, 0 high, 4 moderate, 1 low.** None is reachable in the deployed
app:

| Package                               | Severity | Where it comes from                                         | Why it is accepted                                                                    |
| ------------------------------------- | -------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `uuid` < 11.1.1                       | moderate | `firebase-tools` (dev tooling)                              | Never deployed; the fix is a major version the tool does not support yet.             |
| `@opentelemetry/core` < 2.8.0         | moderate | `firebase-tools` (dev tooling)                              | Never deployed.                                                                       |
| `glob` 9–14.0.1, `minimatch` < 11.0.1 | moderate | `google-gax` → `rimraf` under `firebase-admin`; also ESLint | Listed as a dependency but never loaded by the built server code; ESLint is dev-only. |
| `deepmerge` 4.2–4.3.1                 | low      | `shadcn` CLI (dev tooling)                                  | Never deployed; no patched version exists.                                            |

Dependabot (Phase 4) will raise these as fixes are released.

## Accepted risks and limits (decide before public launch)

1. **CSP allows inline scripts (`'unsafe-inline'`).** Kosh's pages are prerendered, and Next.js
   cannot add per-request nonces to prerendered pages (stated in the Next.js CSP guide). Removing
   it means rendering every page on the server per request. The policy still blocks foreign
   scripts, framing, plugins and foreign form targets.
2. **No per-IP rate limit for signed-out traffic.** Everything expensive needs a valid token and
   is limited per user; signed-out requests fail at token verification without touching the
   database. A per-IP limiter would need a paid or external store. Vercel's platform protection
   is the outer layer.
3. **Free accounts are unlimited.** Limits are per user, so many accounts multiply them. An
   invite list or sign-up cap is the fix if the instance is opened to the public (planned for the
   admin milestone).
4. **Shared tracked-instrument list is never pruned.** Fake tickers stay listed after their owner
   leaves; they are now tried last and capped per run, so they only cost a few requests a day.
5. **A user with more than 40 Yahoo-priced stocks** gets the rest on the next refresh (prices are
   cached 15 minutes, so two refreshes cover 80).
