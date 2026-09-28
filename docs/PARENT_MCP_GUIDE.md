# Master / Parent MCP Orchestration Guide

This document describes how a **Master MCP Server** or **Router MCP** can orchestrate and consume `mcp-server-log-hub` as a child feature.

---

## Pattern 1: Direct In-Process Module Mounting (Recommended)

When both the Master MCP and `mcp-server-log-hub` are part of the same Node.js project or monorepo, you can mount the tools directly into the Master MCP server instance.

### Advantages:
- Zero IPC (Inter-Process Communication) latency.
- No child process management or subprocess crashing.
- Shares the same process memory and execution context.

### Code Example:
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerLogHubTools, LogHubService } from 'mcp-server-log-hub';

// 1. Initialize your Master MCP Server
const masterServer = new McpServer({
  name: 'my-master-orchestrator',
  version: '2.0.0',
});

// 2. Mount Log Hub tools with an optional namespace prefix
registerLogHubTools(masterServer, {
  prefix: 'logs_', // Tools will be registered as 'logs_list_log_providers' and 'logs_query_logs'
});

// 3. Mount your other child features (e.g. database tools, metrics, deployment)
// registerDatabaseTools(masterServer);
// registerDeploymentTools(masterServer);

// 4. Connect Master Server
const transport = new StdioServerTransport();
await masterServer.connect(transport);
```

---

## Pattern 2: Subprocess MCP Router (Process Isolation)

When the Master MCP runs as a separate process or is implemented in another language (Python, Go, Rust), you can spawn `mcp-server-log-hub` as a child subprocess over stdio.

### Advantages:
- Language-agnostic.
- Complete process isolation: a crash in the child does not crash the Master.

### Code Example (TypeScript / Node.js):
```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// 1. Create client connection pointing to mcp-server-log-hub
const transport = new StdioClientTransport({
  command: 'node',
  args: ['./sub-mcps/mcp-server-log-hub/dist/index.js'],
  env: {
    ...process.env,
    SEQ_SERVER_URL: 'http://localhost:5341',
    SEQ_API_KEY: 'secret_key',
  },
});

const logHubClient = new Client({
  name: 'master-orchestrator-client',
  version: '1.0.0',
});

await logHubClient.connect(transport);

// 2. Forward tool calls from Master MCP down to child MCP
const availableTools = await logHubClient.listTools();
console.log('Discovered tools from Log Hub:', availableTools);

// 3. Call child tool
const result = await logHubClient.callTool({
  name: 'query_logs',
  arguments: {
    provider: 'seq',
    query: 'Level == "Error"',
    limit: 10,
  },
});

console.log('Logs retrieved from child:', result);
```

---

## Pattern 3: Programmatic Service Access (Bypassing Protocol)

If your Master MCP wants to process logs programmatically in TypeScript without encoding/decoding MCP tool envelopes:

```typescript
import { LogHubService } from 'mcp-server-log-hub';

const logService = new LogHubService();

// Check available providers
const providers = logService.listProviders();

// Query logs directly
const logs = await logService.queryLogs({
  provider: 'seq',
  query: 'TimeoutException',
  limit: 20,
});

for (const entry of logs) {
  console.log(`[${entry.timestamp}] ${entry.message}`);
}
```
