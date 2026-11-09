# Prices, refresh and snapshots

How Kosh values holdings, what it sends to whom, and how to configure sources on your instance.

## What is sent to price sources

Only public instrument identifiers: an AMFI scheme code, a coin symbol, a ticker. Never your holdings, quantities, account, email or user ID. Quotes are cached globally per instrument (`prices/{instrumentId}`), so a source is asked once for everyone, not once per user.

Kosh accesses sources politely. It sends an honest `User-Agent`, caches results, and makes one download per file. It never spoofs browsers or works around bot protection.

## Sources by asset type

| Asset type      | Source (in order)                   | Key needed | Notes                                                                                                                                                              |
| --------------- | ----------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mutual funds    | AMFI daily NAV file → mfapi.in      | No         | One ~1.5 MB file covers every scheme. Needs the AMFI scheme code (e.g. `120590`) or ISIN as the holding's symbol. Format re-verified 2026-11-09 (8 columns).       |
| Crypto          | CoinDCX public ticker (INR markets) | No         | Day change is the 24-hour move, derived from CoinDCX's 24h %.                                                                                                      |
| US stocks       | Finnhub → Twelve Data               | Yes (free) | Set `FINNHUB_API_KEY` and/or `TWELVEDATA_API_KEY`. Free tiers may delay quotes and may be personal-use only (check their terms). Without a key, use manual prices. |
| USD/INR         | Frankfurter (ECB reference rates)   | No         | Daily. Trades use the ECB rate for the trade date (closest earlier business day) unless you enter your own.                                                        |
| Indian stocks   | none (manual)                       | —          | See below.                                                                                                                                                         |
| Unlisted shares | manual                              | —          | Public quotes are indicative dealer prices that vary between sites.                                                                                                |

### Why Indian stocks are manual (for now)

The plan's primary source was the NSE/BSE end-of-day "bhavcopy" files. When this was tested on 2026-11-09, both exchanges refused automated downloads, and getting past that would mean evading their bot protection. Kosh does not do that. The other options:

- **Kite Connect (Zerodha):** the free Personal plan has no market data. The paid Connect plan (₹500/month) includes quotes, but Zerodha says displaying Kite data on other platforms can breach exchange data-vending rules. It may still suit a _personal_ instance; to be decided in M4.
- **Alpha Vantage:** BSE symbols (`RELIANCE.BSE`) are reported to work on the free tier, but at about 25 calls/day and with unverified coverage.
- **Unofficial Yahoo Finance:** terms unverified. Kept off by default (`ENABLE_UNOFFICIAL_YAHOO=false`); not implemented.
- **Licensed data vendors:** paid.

Until a permitted source is chosen, set Indian stock prices manually. Prices older than one trading day are flagged as stale. A provider can be added later without data changes (see "Adding a provider").

## Refresh

| Trigger                                                                       | Limits                                 | What happens                                                                                                                                                   |
| ----------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Refresh** button (header)                                                   | One per 5 minutes, 30 per day per user | Fetches quotes for the user's open holdings (cache-first), updates FX, recomputes the book, writes an immutable snapshot.                                      |
| Daily job (`/api/cron/daily`, Vercel cron `30 1 * * *` UTC ≈ 07:00–07:59 IST) | Once per user per day                  | Prices every tracked instrument once, then snapshots each user in pages within the function time limit. Re-running the same day snapshots nobody (idempotent). |

Cache lifetimes: crypto 5 min, US 15 min, end-of-day sources 6 h, FX 6 h. If every source fails, the last cached price is used and marked stale.

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
