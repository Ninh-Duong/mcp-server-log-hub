# CLI Menu & Diagnostics Guide

`mcp-server-log-hub` features an interactive terminal interface designed for human operators, devops engineers, and developers to verify server health, test queries, and inspect logs before attaching AI clients.

---

## 1. Quick Start Commands

```bash
# Launch interactive terminal controller
npm run cli

# Run preflight diagnostics check only
npm run preflight

# Start server directly in MCP Stdio mode (for AI clients)
npm start
```

---

## 2. Interactive Menu Navigation

When running `npm run cli`, you are greeted with the interactive controller:

```
========================================================
           MCP SERVER LOG HUB - CLI CONTROLLER          
========================================================
Unified multi-provider log observability for AI Agents & Humans
--------------------------------------------------------

[MENU OPTIONS]
  1. Run Environment Preflight Diagnostics
  2. List Supported Log Providers & Status
  3. Execute Live Test Query
  4. View Recent Process Logs (logs/mcp-process.log)
  5. Launch MCP Server in Stdio Mode
  6. Exit
--------------------------------------------------------
Select an option (1-6):
```

### Option 1: Run Environment Preflight Diagnostics
Runs automated checks:
- **Node.js Runtime**: Confirms Node version is >= 18.0.0.
- **Logs Storage**: Verifies write permissions on `logs/`.
- **MCP SDK & Core Modules**: Verifies protocol bindings.
- **Provider Credentials**: Checks presence of `SEQ_SERVER_URL`, `SEQ_API_KEY`, `OBSERVE_CUSTOMER_ID`, `OBSERVE_TOKEN`.

### Option 2: List Supported Log Providers & Status
Displays the connection status of each registered log provider (`[READY]` or `[UNCONFIGURED]`).

### Option 3: Execute Live Test Query
Prompts you for:
- Target Provider (`seq`, `observe`, or blank for all)
- Query text (e.g. `Error`, `Timeout`, `*`)
- Result limit (default: 10)
Directly queries the selected backend and renders output in the terminal.

### Option 4: View Recent Process Logs
Prints the last 25 lines from `logs/mcp-process.log` without leaving the terminal.

### Option 5: Launch MCP Server in Stdio Mode
Transitions from interactive mode into headless JSON-RPC stdio transport mode.

---

## 3. Troubleshooting Common Preflight Warnings

| Symptom | Root Cause | Solution |
| :--- | :--- | :--- |
| `[WARN] Seq Provider: Unconfigured` | `SEQ_SERVER_URL` or `SEQ_API_KEY` is missing in `.env` | Copy `.env.example` to `.env` and fill in your Seq server URL and API key. |
| `[WARN] Observe Provider: Unconfigured` | `OBSERVE_CUSTOMER_ID` or `OBSERVE_TOKEN` is missing | Set customer ID and bearer token in `.env`. |
| `[FAIL] Logs Storage: Cannot write` | Permissions issue on `logs/` folder | Ensure current user has write permissions in the repo directory. |
