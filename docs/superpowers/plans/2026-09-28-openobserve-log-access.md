# OpenObserve Log Access Implementation Plan

**Goal:** Replace the incorrect Observe by Snowflake adapter with OpenObserve account access, organization and stream discovery, SQL and RCID log search, CLI and MCP exposure, and usage documentation.

**Architecture:** Load separate Seq and OpenObserve account files from the project root. Reuse one OpenObserve provider for authenticated HTTP calls; expose it through the existing service to both CLI and MCP. Keep each query stateless with explicit organization and stream.

**Tech Stack:** TypeScript, Node.js built-in `fetch`, MCP SDK, Zod, Node test runner.

## Tasks

- [x] Add failing tests for OpenObserve organization discovery, stream discovery, bounded SQL search, RCID quoting, and invalid organization rejection.
- [x] Add separate account config files and loading; keep credentials out of Git.
- [x] Replace the Observe provider with OpenObserve Basic auth, organization and stream APIs, and `_search` JSON parsing.
- [x] Expose discovery and search in MCP tools and the CLI menu, reusing the provider registry for `query_logs`.
- [x] Document how to create a read-only OpenObserve service account, grant organization access, configure both providers, and use CLI/MCP.
- [x] Run the tests, `npm run build`, and inspect the final diff.

## Constraints

- Never use the browser session cookie in code or tests.
- Keep `stdout` reserved for MCP JSON-RPC in stdio mode.
- Require a time window and cap query results.
- Use organization identifiers returned by OpenObserve, never hardcode the screenshot list.
