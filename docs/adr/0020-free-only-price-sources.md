# 0020. Free-only price sources: Yahoo (unofficial) and Alpha Vantage (BSE)

- Status: Accepted (owner decision)
- Date: 2026-11-09
- Supersedes: ADR-0019

## Context

The owner set three hard constraints:

- zero paid keys or services anywhere;
- an Alpha Vantage free key, used only for BSE symbols with a very small daily budget;
- Yahoo Finance's unofficial endpoint, enabled.

ADR-0019 had left Indian stocks manual because the exchanges' own files refuse automated clients.

## Decision

- **Routing** lives in one table (`packages/prices/src/routing.ts`):
  - NSE → Yahoo;
  - BSE → Alpha Vantage → Yahoo;
  - US → Finnhub → Twelve Data → Yahoo (the first two only with free keys);
  - MF → AMFI → mfapi.in;
  - crypto → CoinDCX;
  - FX → ECB via Frankfurter.
- **Alpha Vantage** has a daily budget shared across users and instances, enforced in a Firestore transaction (default 25, configurable), with at most 3 calls per refresh and ≤ 5/minute. HTTP-200 "Note/Information/Error Message" bodies are treated as failures, never prices, and a rate-limit body exhausts the day's budget. The key is server-only.
- **Yahoo** is on by default (`ENABLE_UNOFFICIAL_YAHOO`), labelled "unofficial" in code, docs, the UI and every snapshot (`yahoo-unofficial`). Responses are schema-validated with zod. Requests use an honest User-Agent, an 8 s timeout, 2 retries with backoff, a 400 ms gap and a 15-minute shared cache. Kosh never uses cookies, crumbs or browser disguises.
- **Outbound hosts are allow-listed**, redirects are refused, and symbols are restricted and URL-encoded.
- **Unlisted shares stay manual.** Every candidate site either blocks automated clients or its terms forbid copying its prices (docs/prices.md). The app links to public price lists instead.

## Consequences

- Indian and US stocks price automatically on a fresh self-hosted instance with no keys at all.
- Dependence on an unofficial endpoint: it can break or be disallowed. Mitigations are schema validation, last-known prices marked stale, the flag, and an easy routing change.
- The Alpha Vantage budget is small: with many BSE holdings most will come from Yahoo.

## Would change if

- Yahoo blocks identified clients or its terms are clarified against this use → turn the flag off by default.
- A free official Indian source appears (exchange or broker) → put it first in the routing table.
- An unlisted-share site grants written permission → add an `UNLISTED` provider.
