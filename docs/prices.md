# Prices, refresh and snapshots

How Kosh values holdings, what it sends to whom, and how to configure sources on your instance.

## What is sent to price sources

Only public instrument identifiers: an AMFI scheme code, a coin symbol, a ticker. Never your holdings, quantities, account, email or user ID. Quotes are cached globally per instrument (`prices/{instrumentId}`), so a source is asked once for everyone, not once per user.

Kosh accesses sources politely. It sends an honest `User-Agent`, caches results, and makes one download per file. It never spoofs browsers or works around bot protection.

## Sources by asset type

Routing lives in one place: `packages/prices/src/routing.ts`. Earlier sources win; later ones are fallbacks. Every source is free: either no key, or a free key you create.

| Holdings        | Source (in order)                          | Key                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | ------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| NSE stocks      | Yahoo Finance (**unofficial**)             | none                                   | Needs the exchange ticker (e.g. `RELIANCE`, not the ISIN).                                                                                                                                                                                                                                                                                                                                       |
| BSE stocks      | Alpha Vantage → Yahoo (unofficial)         | free `ALPHAVANTAGE_API_KEY` (optional) | Free tier ≈ 25 calls/day, ≈ 5/min (third-party figures, 2026). Kosh keeps a **shared daily budget** in Firestore (`providerBudgets/alphavantage_{UTC date}`), makes at most 3 Alpha Vantage calls per refresh, and stops for the day when the quota is used or the API says "rate limit"; the rest falls back to Yahoo (`.BO`). Symbol format `<TICKER>.BSE` is community-reported (unverified). |
| US stocks       | Finnhub → Twelve Data → Yahoo (unofficial) | free keys (optional)                   | Without keys, Yahoo is used.                                                                                                                                                                                                                                                                                                                                                                     |
| Mutual funds    | AMFI daily NAV file → mfapi.in             | none                                   | One ~1.5 MB file covers every scheme. Needs the AMFI scheme code (e.g. `120590`) or ISIN. Format re-verified 2026-11-09 (8 columns).                                                                                                                                                                                                                                                             |
| Crypto          | CoinDCX public ticker (INR markets)        | none                                   | Day change is the 24-hour move.                                                                                                                                                                                                                                                                                                                                                                  |
| USD/INR         | Frankfurter (ECB reference rates)          | none                                   | Trades use the ECB rate for the trade date (closest earlier business day) unless you enter your own.                                                                                                                                                                                                                                                                                             |
| Unlisted shares | manual                                     | —                                      | See below.                                                                                                                                                                                                                                                                                                                                                                                       |

### Yahoo Finance is unofficial

Kosh calls `query1.finance.yahoo.com/v8/finance/chart/{symbol}`, the endpoint Yahoo's website uses. On 2026-11-09 it answered an honest, identified client without cookies, a "crumb" or a browser disguise. Kosh would not add any of those.

- It is **not an official API**: no documentation, no SLA, and it can change or stop without notice.
- Yahoo's terms of service may not permit this use.

How Kosh keeps the load low:

- one request per symbol, serialised with a 400 ms gap;
- an 8-second timeout and two retries with backoff (429/5xx only);
- a 15-minute shared cache;
- a 10-minute back-off after a symbol fails everywhere;
- responses are schema-validated, so a format change becomes "no price", never a wrong price.

It is **on by default**. Self-hosters decide whether to keep it: `ENABLE_UNOFFICIAL_YAHOO=false` turns it off, and those holdings then need manual prices. Prices from it are labelled "Yahoo Finance (unofficial)" in the app and recorded as `yahoo-unofficial` in every snapshot.

### Why NSE/BSE files are not used

The exchanges' own end-of-day "bhavcopy" files refused automated downloads when tested on 2026-11-09. Getting past that would mean evading bot protection, which Kosh does not do (ADR-0019).

### Unlisted shares: why Kosh does not scrape price sites

Checked 2026-11-09:

| Site                             | robots.txt / response                         | Terms                                                                                                                                  | Result                                                                       |
| -------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| SharesCart, UnlistedZone, Altius | no response to an identified automated client | —                                                                                                                                      | not used: they don't serve automated clients, and Kosh won't disguise itself |
| InCred Money                     | robots allows                                 | forbids "any robot, spider, other automatic device… to monitor or copy our Website without our prior written permission"               | not used                                                                     |
| Precize                          | robots allows                                 | licence "does not include the right to copy or reproduce the information… on any other platform… without our prior written permission" | not used                                                                     |
| Planify                          | robots allows                                 | no data-use clause found                                                                                                               | not used without explicit permission                                         |

So unlisted prices stay **manual**. Each unlisted holding links to public price lists (SharesCart, UnlistedZone, Precize) so you can check a quote and update the price yourself. If a site grants written permission, an `UNLISTED` provider can be added to the routing table.

## Refresh

| Trigger                                                                       | Limits                                 | What happens                                                                                                                                                   |
| ----------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Refresh** button (header)                                                   | One per 5 minutes, 30 per day per user | Fetches quotes for the user's open holdings (cache-first), updates FX, recomputes the book, writes an immutable snapshot.                                      |
| Daily job (`/api/cron/daily`, Vercel cron `30 1 * * *` UTC ≈ 07:00–07:59 IST) | Once per user per day                  | Prices every tracked instrument once, then snapshots each user in pages within the function time limit. Re-running the same day snapshots nobody (idempotent). |

Cache lifetimes: crypto 5 min, Indian and US stocks 15 min, end-of-day sources 6 h, FX 6 h. Within one refresh each symbol is fetched once; concurrent refreshes on the same server share in-flight lookups. If every source fails, the last cached price is used and marked stale.

### Stale prices

| Type               | Stale after                                        |
| ------------------ | -------------------------------------------------- |
| Indian / US stocks | more than 1 weekday since the price date           |
| Mutual funds       | more than 2 weekdays (NAVs publish in the evening) |
| Crypto             | 60 minutes                                         |
| Manual prices      | 30 days                                            |
| USD/INR            | 4 days                                             |

Exchange holidays are not modelled yet, so a price can show as stale on the day after a market holiday.

## Snapshots and series

Every refresh writes `users/{uid}/snapshots/{id}`: time, trigger, FX used, totals, and one row per holding (price, currency, source, as-of, status, value, day change). Snapshots are never edited; clients cannot write them. Each refresh also updates `users/{uid}/series/{year}` with one point per day (value, invested, realised, dividends), which the trends charts in M5 read.

## Running the daily job locally

```bash
pnpm dev:all
```

```bash
pnpm cron
```

`pnpm cron` calls `/api/cron/daily` page by page with the local `CRON_SECRET` from `apps/web/.env.development`. In production, set your own random `CRON_SECRET` in Vercel; Vercel sends it automatically.

## Adding a provider

1. Implement `PriceProvider` in `packages/prices/src/providers/` (`supports`, `fetch`; set `requiresEnv` if it needs a key).
2. Add parser tests with a small fixture captured from the real source, and record the date you verified the format.
3. Insert it in `DEFAULT_PROVIDERS` in preference order.
4. Confirm the source's terms allow automated access and display, and document them here.
