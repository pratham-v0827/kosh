# 0017. Decimal arithmetic for money and quantities

- Status: Accepted
- Date: 2026-11-09
- Details: [docs/PLAN.md](../PLAN.md)

## Context

Floating-point drift is unacceptable in P&L.

## Decision

Use decimal.js for money and quantity, stored as strings. Rates (XIRR) use float64.

## Consequences

Exact sums. Slightly more verbose code.

## Would change if

Nothing foreseeable.
