# 0005. Event-sourced ledger with a per-user book read model

- Status: Accepted
- Date: 2026-11-09
- Details: [docs/PLAN.md](../PLAN.md)

## Context

Holdings, cost basis and cash flows must be reproducible and auditable.

## Decision

Transactions are the source of truth. A derived `book/current` document holds positions and cash flows.

## Consequences

Dashboards read 1–3 documents. The book can always be rebuilt from transactions.

## Would change if

Portfolios beyond roughly 2,000 positions → shard the book document.
