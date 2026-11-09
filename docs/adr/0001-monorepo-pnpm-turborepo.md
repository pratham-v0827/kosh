# 0001. Monorepo with pnpm workspaces + Turborepo

- Status: Accepted
- Date: 2026-11-09
- Details: [docs/PLAN.md](../PLAN.md)

## Context

Web, MCP, shared domain logic, parsers and (later) Android contracts must evolve together.

## Decision

Use a single repository with pnpm workspaces and Turborepo task orchestration.

## Consequences

Shared TypeScript packages without publishing; first-class Vercel support; one CI pipeline.

## Would change if

An Android-only team would favour a Gradle-first repository split.
