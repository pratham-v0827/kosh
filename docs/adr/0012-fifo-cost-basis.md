# 0012. FIFO lot accounting for realised P&L

- Status: Accepted
- Date: 2026-11-09
- Details: [docs/PLAN.md](../PLAN.md)

## Context

Realised gains must be deterministic and explainable.

## Decision

Match sells against the oldest lots first. Display the average cost of open lots.

## Consequences

Matches common Indian practice for securities (descriptive only, not tax advice).

## Would change if

Users want broker-style average cost → add a display toggle; the maths is unchanged.
