# mcp-server-log-hub

> **Unified Model Context Protocol (MCP) server for multi-provider log observability (Seq, Observe, and beyond).**

Built for **100% AI Vibe-Coding**, maximum portability, zero supply-chain bloat, and seamless integration as either a **standalone MCP server** or a **child feature inside a Master MCP Orchestrator**.

---

## 🌟 Key Highlights

- **Multi-Provider Hub**: Query logs across **Seq** and **Observe (OBS)** through a single unified interface, or query backends individually.
- **Dual-Mode Architecture**:
  - **Standalone Mode**: Runs over stdio JSON-RPC or interactive terminal CLI.
  - **Parent MCP Integration**: Can be mounted in-process into a Master MCP orchestrator via `registerLogHubTools()` with custom namespaces.
- **Strict Stdio Safety**: `stdout` is 100% reserved for JSON-RPC; diagnostics and errors are isolated to `process.stderr` and `logs/mcp-process.log`.
- **Zero-Bloat Engineering (Ponytail)**: Only 2 dependencies (`@modelcontextprotocol/sdk` and `zod`). Uses native `fetch`, native `node:readline`, and stdlib file streaming.
- **Preflight Diagnostics**: Automated startup health scanner checking Node version, directory write permissions, and provider credentials.
- **Universal Portability**: Strictly uses relative path resolution. Deploy anywhere (Windows, macOS, Linux, Docker).

---

## 🚀 Quick Start

### 1. Installation
```bash
# Clone the repository and install minimal dependencies
git clone https://github.com/your-org/mcp-server-log-hub.git
cd mcp-server-log-hub
npm install
npm run build
```

### 2. Configure Credentials
Copy `.env.example` to `.env` and set your credentials:
```bash
cp .env.example .env
```
Edit `.env`:
```env
# Seq Configuration
SEQ_SERVER_URL=http://localhost:5341
SEQ_API_KEY=your_seq_api_key_here

# Observe Configuration
OBSERVE_CUSTOMER_ID=your_customer_id
OBSERVE_TOKEN=your_observe_token
```

### 3. Verify Health & Test Interactively
Run the interactive CLI menu:
```bash
npm run cli
```
Or run the non-interactive preflight check:
```bash
npm run preflight
```

---

## 🤖 Connecting to AI Clients (Claude Desktop / Antigravity / Cursor)

Add `mcp-server-log-hub` to your `claude_desktop_config.json` or Antigravity MCP settings:

```json
{
  "mcpServers": {
    "log-hub": {
      "command": "node",
      "args": ["d:/VisualStudioCode/mcp-server-log-hub/dist/index.js"],
      "env": {
        "SEQ_SERVER_URL": "http://localhost:5341",
        "SEQ_API_KEY": "your_api_key",
        "OBSERVE_CUSTOMER_ID": "your_customer_id",
        "OBSERVE_TOKEN": "your_token"
      }
    }
  }
}
```

---

## 🧩 Master MCP / Router Orchestrator Integration

To consume this repository inside a Master MCP without subprocess overhead:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerLogHubTools } from 'mcp-server-log-hub';

const masterMcp = new McpServer({ name: 'master-orchestrator', version: '1.0.0' });

// Mount Log Hub tools with an optional namespace prefix
registerLogHubTools(masterMcp, { prefix: 'logs_' });
```

See [docs/PARENT_MCP_GUIDE.md](docs/PARENT_MCP_GUIDE.md) for full instructions and examples.

---

## 📚 Documentation Index

- [AGENTS.md](AGENTS.md) - Master manual and prompt guidelines for AI Agents (Vibe-Coding).
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - High-level system design, provider pattern, and stdio data flow.
- [docs/PARENT_MCP_GUIDE.md](docs/PARENT_MCP_GUIDE.md) - Integration guide for Master / Orchestrator MCPs.
- [docs/STANDARDS.md](docs/STANDARDS.md) - Coding standards, type normalization, and error handling.
- [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) - Complete package catalog and architectural justification.
- [docs/CLI_GUIDE.md](docs/CLI_GUIDE.md) - CLI menu walkthrough and preflight troubleshooting.

---

## 📄 License
MIT
