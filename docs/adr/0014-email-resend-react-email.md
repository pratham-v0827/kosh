# 0014. Email via Resend and React Email

- Status: Accepted
- Date: 2026-11-09
- Details: [docs/PLAN.md](../PLAN.md)

## Context

Opt-in summaries must render well in Gmail (mobile and dark mode) and fit free tiers.

## Decision

Use React Email templates and Resend behind a `Mailer` interface (SMTP for self-hosters).

## Consequences

Free tier is about 3,000 per month and 100 per day; sends are capped and spread.

## Would change if

Volume above the free tier → Resend Pro or another provider.
