# 0019. Indian equity prices are manual until a permitted source is chosen

- Status: Accepted (pending owner decision on a source)
- Date: 2026-11-09
- Supersedes: the Indian-equity row of ADR-0007 / docs/PLAN.md §6.1

## Context

The plan named the NSE/BSE end-of-day "bhavcopy" files as the primary source for Indian stock prices. In M2 testing, both exchanges' download endpoints refused automated clients. Fetching them would require spoofing a browser to get past bot protection, which Kosh does not do (docs/PLAN.md §6.1, ADR-0007).

No free, official, permitted alternative was found:

- The Kite Connect Personal plan has no market data, and Zerodha warns that redistributing Kite data can breach exchange data-vending rules.
- Alpha Vantage's BSE coverage is limited and unverified.
- Yahoo Finance is unofficial.

## Decision

Indian equities are priced manually for now. The UI says so plainly (Settings → Price sources, the add-holding form, and stale badges). The provider chain has an open slot, so a source can be added without data migration.

## Consequences

- Honest, terms-respecting behaviour; no breakage when the exchanges change their bot protection.
- Users with Indian stocks must update prices by hand until a source is chosen.
- Broker syncs in M4 (Kite/Groww holdings) may carry a last price for the user's own holdings. Whether that may be displayed is to be checked against each broker's terms.

## Would change if

- The owner picks a source: BYOK paid Kite Connect quotes for a personal instance, an Alpha Vantage key, a licensed vendor, or an explicitly opted-in unofficial source.
- NSE/BSE publish an access path for automated clients.
