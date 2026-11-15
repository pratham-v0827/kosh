# End-to-end tests (Playwright)

A recorded walkthrough of Kosh as a new user, plus a check of every signed-in page. Everything
runs against the **local Firebase emulators** (offline project `demo-kosh`); nothing touches a
real Firebase project, and with mock prices nothing touches a price source either.

```bash
pnpm --filter @kosh/web e2e          # walkthrough + page checks, mock market data
pnpm --filter @kosh/web e2e:live     # one run against the real free price sources (by hand, rarely)
```

First time on a machine: `pnpm --filter @kosh/web exec playwright install chromium`.

## What a run does

1. Starts the emulators if they are not already running (a running `pnpm dev:all` is reused),
   then builds the app and serves it on <http://127.0.0.1:3100>, next to `pnpm dev` on 3000.
2. **Global setup** clears the emulator's shared market data (prices, FX, index and price
   histories, ISIN cache) so real data from `pnpm dev` cannot mix with mock data, then deletes and
   recreates the user **`pratham_test`** (`pratham_test@kosh.test`) in the Auth emulator.
   Kosh signs in with email links, so the account's password is never used: it is `E2E_PASSWORD`
   from your local environment if set, else random for each run, and it is never printed or
   stored. The helpers refuse any project not named `demo-…` and any non-local emulator host.
3. **`walkthrough`**: signs in through the real email-link page (the link is read from the Auth
   emulator), imports the three INVENTED fixtures in `packages/parsers/fixtures` (Groww, INDmoney,
   Kosh CSV), and goes through the dashboard, holdings, a holding's price chart, privacy mode, the
   dollar view and the command palette.
4. **`pages`** and **`pages-mobile`** (1280 px and 360 px): every signed-in page, plus the
   dashboard in dark mode, is checked with axe (WCAG 2.2 A/AA), for horizontal scrolling, and
   against its screenshot baseline.
5. **Global teardown** clears the mock market data again, so `pnpm dev` fetches real data.

Every test fails on **any** console error, page error, failed request or HTTP 4xx/5xx response.
The one exception is a request the browser cancels because the page navigated away
(`net::ERR_ABORTED`, typically a Firestore listen channel).

## Mock market data

`KOSH_MOCK_PRICES=true` swaps the server's `fetch` for `createMockFetch()` from
`@kosh/prices` (`packages/prices/src/mock.ts`). It answers Yahoo, AMFI, mfapi, Frankfurter and
CoinDCX with invented, deterministic data that goes through the real parsers. Latest prices are
fixed and histories end at them today, so amounts stay the same from day to day. The switch only
works with the local emulators and never on Vercel (`mockPricesEnabled`, unit-tested).

## Screenshots

Baselines live in `e2e/__screenshots__/<platform>/`. Masked: dates and relative times, figures
marked `data-volatile` (returns that change as days pass), and charts drawn up to today.
After an intended UI change: `pnpm --filter @kosh/web e2e --update-snapshots`, then look at
every changed image before committing it. Fonts render differently per OS, so CI (Linux) does
not compare screenshots until Linux baselines are committed; it still runs every other check.

## Videos

Each test's recording is saved to `artifacts/videos/m3/<name>.webm` at the repository root.
That folder is git-ignored: recordings are never committed. They only ever show the invented
fixtures and mock prices.
