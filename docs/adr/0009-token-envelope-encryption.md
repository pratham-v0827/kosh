# 0009. AES-256-GCM encryption for broker tokens

- Status: Accepted
- Date: 2026-11-09
- Details: [docs/PLAN.md](../PLAN.md)

## Context

Broker access tokens can carry trading permission.

## Decision

Encrypt with AES-256-GCM, a random IV per record, AAD = uid:connectionId, and versioned keys from environment secrets.

## Consequences

Auditable, rotation-ready, no extra vendor.

## Would change if

Moving to Blaze → Google Cloud KMS.
