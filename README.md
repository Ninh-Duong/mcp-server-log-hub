# mcp-server-log-hub

> **Model Context Protocol (MCP) server for Seq and OpenObserve log search.**

Built for **100% AI Vibe-Coding**, maximum portability, zero supply-chain bloat, and seamless integration as either a **standalone MCP server** or a **child feature inside a Master MCP Orchestrator**.

---

## 🌟 Key Highlights

- **Multi-Provider Hub**: Query logs from **Seq** and **OpenObserve** through a unified interface.
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
Requires Node.js 18.17+. Pick one:

```bash
# From source (any OS): start.mjs checks Node, runs `npm ci` when node_modules is missing or
# older than package-lock.json, rebuilds when src/ changed, then starts the server.
git clone https://github.com/your-org/mcp-server-log-hub.git
cd mcp-server-log-hub
node start.mjs            # same as `npm start`; add --cli or --preflight

# As a package: build a tarball and install it anywhere
npm pack                  # -> mcp-server-log-hub-1.0.0.tgz (dist + config examples only)
npm i -g ./mcp-server-log-hub-1.0.0.tgz
mcp-server-log-hub --preflight
```

`OPENOBSERVE_ENV` (`dev`, `stg` or `prod`) picks the saved `config/openobserve.<env>.env` account; register one MCP server entry per environment if you need several. Alternatively set `OPENOBSERVE_URL` / `OPENOBSERVE_EMAIL` / `OPENOBSERVE_TOKEN` directly. Installed as a package, credentials come from the `env` block of your MCP client config (environment variables take precedence over `config/*.env`).

### 2. Configure Credentials
Keep a separate logging account for each provider. For Seq, run `npm run cli`, choose **1. Seq** and enter the connection details; they are saved in the Git-ignored `config/seq.env`. For OpenObserve, copy `config/openobserve.env.example` to `config/openobserve.dev.env`, `config/openobserve.stg.env` and/or `config/openobserve.prod.env` and fill in that environment's URL, service-account email and token (a Basic credential in `OPENOBSERVE_TOKEN` is split into email and token automatically). The CLI only reads these files: choosing **2. Observe** → **DEV / STG / PROD** connects with that file, or fails if it is missing or incomplete. OpenObserve uses a service-account email and token, not the browser session cookie. See [the OpenObserve guide](docs/OPENOBSERVE_GUIDE.md) for token creation, Organization permissions, CLI use, and MCP tools.

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
      "args": ["d:/VisualStudioCode/mcp-server-log-hub/start.mjs"],
      "env": {
        "SEQ_SERVER_URL": "http://localhost:5341",
        "SEQ_API_KEY": "your_api_key",
        "OPENOBSERVE_ENV": "dev"
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
- [docs/OPENOBSERVE_GUIDE.md](docs/OPENOBSERVE_GUIDE.md) - OpenObserve account, token, Organization, stream, and search setup.

---

## 📄 License
MIT
