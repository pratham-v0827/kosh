# 0004. Clients read Firestore directly; all writes go through the server

- Status: Accepted
- Date: 2026-11-09
- Details: [docs/PLAN.md](../PLAN.md)

## Context

Validation, ledger recomputation and audit logging must happen in one trusted place.

## Decision

Security rules allow owners to read their own data. Writes go through API routes using the Admin SDK, except a validated settings update.

## Consequences

Simple rules and consistent writes. The Admin SDK bypasses rules, so server-side boundaries are enforced by lint and tests.

## Would change if

Offline-first Android writes → add narrowly scoped client write rules.
