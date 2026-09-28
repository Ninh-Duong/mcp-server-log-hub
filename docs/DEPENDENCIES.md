# Dependency Catalog & Architectural Rationale

This document tracks all external libraries used in `mcp-server-log-hub` and provides the engineering rationale for each choice, strictly adhering to the **Ponytail Principle** (minimalism, zero bloat, standard library first).

---

## 1. Production Dependencies

| Package | Version | Purpose | Why It Cannot Be Omitted |
| :--- | :--- | :--- | :--- |
| `@modelcontextprotocol/sdk` | `^1.6.1` | Core MCP Protocol implementation | Official reference SDK implementing JSON-RPC 2.0, stdio transport, and MCP tool registration. |
| `zod` | `^3.24.2` | Schema validation for tool arguments | Required by `@modelcontextprotocol/sdk` to define strongly typed tool input contracts and generate JSON Schemas. |

**Total Production Dependencies**: Exactly 2 packages.

---

## 2. Development Dependencies

| Package | Version | Purpose |
| :--- | :--- | :--- |
| `typescript` | `^5.8.2` | Static type checking and compiler (`tsc`) |
| `@types/node` | `^22.13.10` | Type definitions for Node.js standard APIs (`node:fs`, `node:path`, `node:readline`) |

---

## 3. Deliberately Excluded Libraries (Ponytail Rationale)

| Excluded Package | Typical Usage | Why Rejected | Standard Library Alternative Used Instead |
| :--- | :--- | :--- | :--- |
| `axios` / `got` | HTTP client | Adds 30+ transitive dependencies, extra bundle weight, potential security CVEs. | **Native `fetch`** (built into Node 18/24) with `AbortSignal.timeout()`. |
| `winston` / `pino` | Logging framework | Heavy abstractions, complex transport pipelines, high overhead for an MCP server. | **Native `node:fs` append stream** in `src/utils/logger.ts` (~35 lines). |
| `inquirer` / `commander` | CLI menus & flags | Introduces 40+ dependencies just to prompt 6 options. | **Native `node:readline`** in `src/cli/menu.ts` (~100 lines, instant startup). |
| `dotenv` | `.env` file loader | Unnecessary in modern Node; adds unnecessary package. | **Stdlib `.env` parser** in `src/config.ts` or native Node `--env-file=.env`. |
| `lodash` / `ramda` | Utility functions | Heavyweight, standard ES2022 array methods cover all needs. | Built-in JavaScript methods: `map`, `filter`, `sort`, `flat`. |
