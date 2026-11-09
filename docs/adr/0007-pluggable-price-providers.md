# 0007. Pluggable PriceProvider with a shared global cache

- Status: Accepted
- Date: 2026-11-09
- Details: [docs/PLAN.md](../PLAN.md)

## Context

Free price APIs have tight limits. Prices are the same for every user.

## Decision

A `PriceProvider` interface with primary/fallback chains and a per-instrument cache shared across users. Only symbols are ever sent.

## Consequences

API usage scales with unique instruments, not users.

## Would change if

A free official feed becomes available → put it first in packages/prices/src/routing.ts.
