# AGENTS.md - Master Operating Manual for AI Agents

> **Primary Objective**: This repository (`mcp-server-log-hub`) is designed for **100% AI Vibe-Coding**. Any AI Agent (Claude, Gemini, GPT, Cursor, Copilot) reading this repository MUST follow the architectural invariants, standards, and rules described herein.

---

## 1. Core Engineering Philosophy: Ponytail & Minimalism

- **Stdlib First**: Always prefer Node.js standard libraries (`node:fs`, `node:path`, `node:readline`, `node:url`, native `fetch`) over adding npm packages.
- **Zero Supply-Chain Bloat**: Never install packages like `axios`, `winston`, `pino`, `inquirer`, `lodash`, or `dotenv`. The codebase already has lean, battle-tested native implementations for all these.
- **Stdio Integrity**: When operating in MCP mode, `process.stdout` is strictly reserved for JSON-RPC messages. **NEVER use `console.log()`** inside providers, services, or tools. Use `logger.info()`, `logger.warn()`, or `logger.error()`, which redirect to `logs/mcp-process.log` and `process.stderr`.
- **Universal Portability**: Never hardcode absolute system paths (e.g. `C:\...` or `/home/...`). Always resolve directories relative to project root using `PROJECT_ROOT` from `src/config.ts`.

---

## 2. Model-Specific Prompting & Execution Guidelines

### For Anthropic Claude (Sonnet / Opus)
- **Tool Calling**: When invoking `query_logs`, specify `provider` if the user refers to a specific system (e.g. "check Seq"), or omit it to broadcast across all configured backends.
- **Code Edits**: Keep changes surgical. When adding a provider, only create the provider file in `src/providers/<name>.ts` and register it in `src/providers/index.ts`. Do not re-architect existing modules.

### For Google Gemini (Flash / Pro)
- **Type Safety**: Respect strict TypeScript typings in `src/types.ts`. All provider outputs must be normalized into `LogEntry`.
- **Time Bounds**: Use standard ISO strings or supported relative formats: `'15m'`, `'1h'`, `'24h'`, `'7d'`.

### For OpenAI GPT-4o / Reasoning Models
- **Preflight Diagnostics**: Always run `npm run build` after making modifications to verify zero type regressions before reporting completion.

---

## 3. How to Add a New Log Provider in 3 Steps

When instructed to add support for a new log provider (e.g., Loki, Datadog, Elasticsearch, CloudWatch):

### Step 1: Define Environment Variables in a provider account example
Add connection variables in `config/<provider>.env.example` and load them from `config/<provider>.env`.

### Step 2: Implement the Provider Class in `src/providers/<provider>.ts`
Implement the `LogProvider` interface:
```typescript
import { LogProvider, ProviderStatus, LogQuery, LogEntry } from '../types.js';
import { normalizeLogLevel, parseTimeBound } from './base.js';

export class NewProvider implements LogProvider {
  public readonly name = 'newprovider';

  public getStatus(): ProviderStatus {
    // Check required env variables
    return { name: this.name, configured: true };
  }

  public async queryLogs(params: LogQuery): Promise<LogEntry[]> {
    // Use native fetch() to call provider API
    // Normalize into LogEntry[]
    return [];
  }
}
```

### Step 3: Register in `src/providers/index.ts`
Import and add an instance of the provider to `ProviderRegistry`:
```typescript
this.register(new NewProvider());
```

---

## 4. MCP Tools Reference

### Tool: `list_log_providers`
- **Purpose**: Lists all known log backends, whether their credentials are configured, and endpoint URLs.
- **Parameters**: None.

### Tool: `query_logs`
- **Purpose**: Retrieves logs with filtering, time range bounding, and level filtering.
- **Parameters**:
  - `provider` *(optional string)*: `'seq'`, `'openobserve'`, or omit for compatible configured backends.
  - `organization` *(optional string)*: OpenObserve Organization identifier; required for OpenObserve queries.
  - `stream` *(optional string)*: OpenObserve log stream when `query` is omitted.
  - `query` *(optional string)*: Search text or native filter expression.
  - `from` *(optional string)*: ISO timestamp or `'15m'`, `'1h'`, `'24h'`, `'7d'`.
  - `to` *(optional string)*: ISO timestamp.
  - `limit` *(optional number, 1-500, default 50)*: Maximum records to return.
  - `level` *(optional string or string[])*: `'Verbose' | 'Debug' | 'Information' | 'Warning' | 'Error' | 'Fatal'`. One level = minimum severity (`'Warning'` → Warning, Error, Fatal); an array = exactly those levels.

OpenObserve also exposes `list_openobserve_organizations`, `list_openobserve_streams`, `list_openobserve_services`, `get_openobserve_service_logs`, `export_openobserve_logs` (writes an `ai-context/` snapshot; read its `SUMMARY.md` first; `skip_duplicates`, default true, drops rows already saved by an overlapping snapshot), `find_openobserve_logs_by_rcid`, and `search_openobserve_logs`. See `docs/OPENOBSERVE_GUIDE.md`.

---

## 5. Master / Parent MCP Orchestration Rule

This repository is designed to be consumed as a feature by a Master MCP.
- If integrating inside a parent server in the same Node process, use:
  ```typescript
  import { registerLogHubTools } from 'mcp-server-log-hub';
  registerLogHubTools(parentServer, { prefix: 'log_hub_' });
  ```
- If running as a child subprocess, spawn `node start.mjs` (auto-installs and builds) using `StdioClientTransport`.

Refer to `docs/PARENT_MCP_GUIDE.md` for comprehensive integration examples.
