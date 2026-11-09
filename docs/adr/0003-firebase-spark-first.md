# 0003. Firebase Spark-first: no Cloud Functions, no Cloud Storage

- Status: Accepted
- Date: 2026-11-09
- Details: [docs/PLAN.md](../PLAN.md)

## Context

Scheduled functions require the Blaze plan. Storage buckets reportedly need billing since Feb 2026.

## Decision

Run all server compute on Vercel. Use Firestore + Auth only.

## Consequences

The free tier is enough for personal and small instances. Scheduling uses Vercel cron.

## Would change if

Accepting Blaze with budget alerts → Cloud Scheduler and KMS become options.
