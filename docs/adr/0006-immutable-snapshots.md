# 0006. Immutable refresh snapshots plus yearly series rollups

- Status: Accepted
- Date: 2026-11-09
- Details: [docs/PLAN.md](../PLAN.md)

## Context

Every refresh must be recorded. Charts must not read hundreds of documents.

## Decision

Write one immutable snapshot per refresh and update a compact `series/{yyyy}` document.

## Consequences

Full audit trail. A one-year chart costs one read.

## Would change if

Intraday charts → add per-day intraday series.
