# 0002. MCP server as a route inside apps/web

- Status: Accepted
- Date: 2026-11-09
- Details: [docs/PLAN.md](../PLAN.md)

## Context

The MCP server needs the same OAuth issuer, Firebase session and domain code as the web app.

## Decision

Serve MCP at `/api/mcp` in apps/web. Tool logic lives in a transport-agnostic `packages/mcp-tools`.

## Consequences

One deployment and one secret set. The stateless MCP 2026-07-28 transport fits serverless functions.

## Would change if

MCP traffic dwarfing web traffic, or needing a different runtime/region → move to apps/mcp.
