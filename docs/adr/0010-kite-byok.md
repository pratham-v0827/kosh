# 0010. Kite Connect: bring your own (free Personal) app

- Status: Accepted
- Date: 2026-11-09
- Details: [docs/PLAN.md](../PLAN.md)

## Context

The Kite Connect Personal plan is free for personal use. Multi-user use of one operator app may need approval.

## Decision

Each user registers their own Kite Connect app. Kosh stores its credentials encrypted and calls read-only endpoints only.

## Consequences

Free and compliant with the personal plan. No operator-wide trading-capable credential.

## Would change if

Zerodha confirming multi-user Connect terms → offer an operator app as an option.
