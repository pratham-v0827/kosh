# 0008. Zero file retention: parse uploads in memory

- Status: Accepted
- Date: 2026-11-09
- Details: [docs/PLAN.md](../PLAN.md)

## Context

Broker statements and CAS PDFs contain highly sensitive personal data.

## Decision

Parse uploads in the request, drop the bytes (and any PDF password) immediately, and keep only normalised rows.

## Consequences

Strong privacy story. No Storage bill or deletion jobs.

## Would change if

Files above the platform request-size limit → short-lived signed uploads with a one-hour lifecycle.
