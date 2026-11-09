# 0015. OpenAPI contract generated from Zod

- Status: Accepted
- Date: 2026-11-09
- Details: [docs/PLAN.md](../PLAN.md)

## Context

The Android app must reuse server logic, not duplicate it.

## Decision

Define API schemas in Zod (`packages/contracts`), generate OpenAPI 3.1, and generate typed TS and Kotlin clients.

## Consequences

One source of truth. Contract drift is caught in CI.

## Would change if

A switch to gRPC or GraphQL (unlikely).
