# Security Policy

Kosh handles people's financial data, so we take security reports seriously.

## Reporting a vulnerability

**Do not open a public issue.** Report privately through
**GitHub → Security → Advisories → "Report a vulnerability"** on this repository.

Please include:

- what is affected
- steps to reproduce
- the impact
- any suggested fix

**Never include real personal or financial data** in a report. Use the emulator or fake data.

## What to expect

- Acknowledgement within **3 working days**.
- An initial assessment within **10 working days**.
- Coordinated disclosure: we aim to fix critical issues within **30 days** and publish an advisory. We ask reporters to wait up to **90 days** before public disclosure.
- Credit in the advisory if you want it.

## Scope

In scope:

- this repository's code
- Firestore/Storage rules
- the MCP server and its OAuth flow
- broker token handling
- admin privacy boundaries

Out of scope:

- vulnerabilities in third-party services (report those to the vendor)
- self-hosted instances misconfigured by their operators
- social engineering

## Supported versions

Until v1.0, only the latest `main` is supported.
