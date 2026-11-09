# 0018. Scheduling with Vercel cron plus an optional GitHub Actions driver

- Status: Accepted
- Date: 2026-11-09
- Details: [docs/PLAN.md](../PLAN.md)

## Context

Hobby cron runs at most daily (±59 min). Functions are time-limited.

## Decision

Daily Vercel cron for EOD prices, snapshots and emails, with paged, cursor-based handlers. Optional GitHub Actions schedule for intraday.

## Consequences

Free and works within function limits.

## Would change if

Vercel Pro → per-minute cron; drop the GitHub Actions driver.
