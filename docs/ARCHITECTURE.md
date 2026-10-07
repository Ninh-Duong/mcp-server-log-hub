# Architecture & Design Overview

## 1. System Topology

`mcp-server-log-hub` operates as a unified adapter layer bridging AI Agent interfaces and heterogeneous logging platforms.

```mermaid
flowchart TD
    subgraph Clients["Consumers"]
        CLI["Human via Terminal (npm run cli)"]
        AI["AI Agent (Claude / Antigravity / Cursor)"]
        MasterMCP["Parent / Master MCP Orchestrator"]
    end

    subgraph CoreHub["mcp-server-log-hub"]
        Router["CLI & MCP Transport Router\n(src/index.ts)"]
        Tools["MCP Tools and Prompts: search, schema, bug investigation\n(src/tools.ts)"]
        Service["Log Hub Service\n(src/service.ts)"]
        Registry["Provider Registry\n(src/providers/index.ts)"]
        Preflight["Startup Preflight Diagnostics\n(src/utils/preflight.ts)"]
        Logger["Provider request lifecycle diagnostics\n(src/utils/logger.ts)"]
    end

    subgraph Providers["Log Backends"]
        SeqAPI["Seq REST API\n(/api/events)"]
        ObserveAPI["OpenObserve API / SQL\n(/api/{org}/_search)"]
        FutureAPI["Future Providers\n(Loki, Datadog, etc.)"]
    end

    subgraph Storage["Local Storage"]
        LogFile["logs/mcp-process.log"]
    end

    CLI -->|Interactive Menu| Router
    AI -->|Stdio JSON-RPC| Router
    MasterMCP -->|Subprocess or Direct Import| Router

    Router --> Tools
    Tools --> Service
    Service --> Registry
    Registry --> SeqAPI
    Registry --> ObserveAPI
    Registry --> FutureAPI

    Router --> Preflight
    Router --> Logger
    Logger --> LogFile
```

The `investigate_api_bug` MCP Prompt guides the caller through inspecting source code, discovering Organization/stream/schema, running bounded SELECT searches, saving evidence in the caller's own `log-work/` directory, and citing log timestamps with source locations. Provider request logs record endpoint paths, status, duration, and result counts without credentials, query values, or returned application log contents.

---

## 2. Core Architectural Pillars

### Pillar A: Dual-Mode Operation (Standalone vs Embedded Child)
1. **Standalone MCP Server**:
   - Run directly via `node dist/index.js` or `npx mcp-server-log-hub`.
   - Communicates over standard input/output (`StdioServerTransport`).
2. **Embedded Child Feature Module**:
   - Master MCPs can import `registerLogHubTools` and mount log querying capabilities directly into the master server without subprocess overhead.

### Pillar B: Stdio Transport Integrity
In the Model Context Protocol, any data written to standard output (`stdout`) that is not valid JSON-RPC breaks the client connection.
- **Rule**: `process.stdout` is exclusively reserved for `@modelcontextprotocol/sdk`.
- **Diagnostics & Errors**: Routed to `process.stderr` and appended to `logs/mcp-process.log`.
- **Interactive UI**: Only rendered when explicitly started in CLI mode (`--cli`).

### Pillar C: Provider Adapter Pattern
Every log backend implements the common `LogProvider` interface:
```typescript
export interface LogProvider {
  readonly name: string;
  getStatus(): ProviderStatus;
  queryLogs(params: LogQuery): Promise<LogEntry[]>;
}
```
Each provider encapsulates its own authentication, endpoint URL structure, and native query format. OpenObserve also discovers accessible Organizations and log streams.

---

## 3. Environment Portability
- All file paths (logs, configurations) are computed using `new URL('..', import.meta.url)` and `node:path.resolve`.
- No operating system-specific path separators or drive letters are hardcoded.
- Runs identically on Windows (PowerShell/CMD), Linux, macOS, and containerized Docker environments.
