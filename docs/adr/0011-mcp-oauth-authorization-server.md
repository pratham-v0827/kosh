# 0011. Built-in OAuth 2.1 authorisation server for MCP

- Status: Accepted
- Date: 2026-11-09
- Details: [docs/PLAN.md](../PLAN.md)

## Context

MCP requires OAuth with protected-resource metadata. Firebase Auth is not a third-party OAuth server.

## Decision

Implement a minimal OAuth 2.1 AS: PKCE S256, DCR and client metadata documents, RFC 8707 audience binding, opaque hashed tokens.

## Consequences

No extra vendor. Works for self-hosters.

## Would change if

A preference for managed identity → WorkOS, Auth0 or Stytch.
