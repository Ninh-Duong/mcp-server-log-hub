# AI Agent Setup: connect log-hub to yourself

> **You are an AI agent and the user gave you this file.** Follow it top to bottom to install `mcp-server-log-hub`, register it as an MCP server in **the client you are running in**, and verify the connection. Ask the user only where a step says *Ask*.

Client paths and commands were checked against each client's official docs on 2026-10-17. Clients change quickly: if a path in §4 does not exist on this machine, look up the client's current MCP docs and use the same server entry (§2).

---

## 0. For the human: the one prompt

Paste this into any AI agent (Antigravity, Claude Code, Cursor, Copilot, Codex, …), replacing `<LOG_HUB_PATH>` with the clone's absolute path (forward slashes) and `<ENV>` with `dev`, `stg` or `prod`:

```text
Read the file <LOG_HUB_PATH>/docs/AI_AGENT_SETUP.md and follow it to connect log-hub to yourself
for the <ENV> environment. The repo is already cloned at <LOG_HUB_PATH>.
Register it in your global MCP config, then verify with list_openobserve_organizations.
```

Not cloned yet: `Clone <REPO_URL>, then read docs/AI_AGENT_SETUP.md in it and follow it …`. Variations: *"for dev and prod"*, *"with Seq too"*, *"only for this workspace"*. More prompts: [README → Copy-paste prompts](../README.md#-copy-paste-prompts).

---

## 1. Rules for the agent

- **Placeholders**: `<LOG_HUB_PATH>`, `<REPO_URL>` and `<ENV>` in this file stand for the values the user gives you. Substitute them; if one is missing, *ask*. Never write them back into this repository's tracked files.
- **Credentials**: never invent, guess, print or log them. *Ask* the user, or let them fill the file themselves. Write them only to `config/openobserve.<env>.env` / `config/seq.env` of the clone, never to a tracked file or your chat summary.
- **Never commit** `config/*.env`, `.env`, `ai-context/` or `logs/`. They are Git-ignored; keep it that way.
- **Merge, don't overwrite**: MCP config files usually already hold other servers. Read the file, back it up (`<file>.bak`), add only the `log-hub-<env>` entry, keep valid JSON/TOML/YAML.
- **Ask before writing global/user config.** If the user wants log-hub only in the current workspace, use the client's project scope.
- **Absolute paths, forward slashes** in JSON: `<LOG_HUB_PATH>/start.mjs`. No `~`, `%USERPROFILE%` or `$HOME` inside `args` (most clients do not expand them). Quote the path in shell commands (it may contain spaces).
- **One entry per environment**: name `log-hub-<env>`, `OPENOBSERVE_ENV=<env>`. Each entry is its own process (~120 MB idle), so register only the environments the user asked for.
- Do not add anything to the server that writes to stdout: in MCP mode stdout is JSON-RPC.

---

## 2. The server entry (every client maps to this)

| Field | Value |
|---|---|
| transport | stdio (local process) |
| command | `node` (or the absolute node path, see step 3) |
| args | `["<LOG_HUB_PATH>/start.mjs"]` where `<LOG_HUB_PATH>` is the clone's absolute path |
| env | `OPENOBSERVE_ENV=<env>` (`dev`, `stg` or `prod`); optional `SEQ_SERVER_URL`, `SEQ_API_KEY` |

`start.mjs` installs dependencies, rebuilds when `src/` changed, then starts the server, so the entry never needs `npm` or `npx`.

JSON form (most clients):

```json
{
  "mcpServers": {
    "log-hub-dev": {
      "command": "node",
      "args": ["<LOG_HUB_PATH>/start.mjs"],
      "env": { "OPENOBSERVE_ENV": "dev" }
    }
  }
}
```

TOML form (Codex): see §4.12.

---

## 3. Steps

Each step ends with **Done when**. Stop and tell the user if a step cannot be done.

### Step 1: Identify your client and OS
Know which client you are running in (your own system prompt or product name usually says it). If unsure, *ask* the user. Detect the OS (`win32`, `darwin`, `linux`) and the shell (PowerShell vs bash) so you use the right commands.
**Done when** you have picked one subsection of §4.

### Step 2: Find or clone the repository
1. If the user named a local clone, or `start.mjs` + `package.json` with `"name": "mcp-server-log-hub"` exist in a folder you know of, use it.
2. Otherwise *ask* where to put it (suggest a sibling of the current workspace) and clone:
   ```bash
   git clone <REPO_URL>
   ```
3. Record `<LOG_HUB_PATH>`, the absolute path of the clone, with forward slashes.

**Done when** `<LOG_HUB_PATH>/start.mjs` exists.

### Step 3: Check Node.js 22+
```bash
node -v
```
If it is older than 22, or missing, stop: ask the user to install Node 22 LTS or newer (https://nodejs.org).
Also record the absolute path of node (`where node` on Windows, `which node` elsewhere). GUI apps (Claude Desktop, Cursor, JetBrains, …) started from the Start menu or Dock may not see a node that nvm/fnm/volta put on your shell PATH. Use the absolute path as `command` if the server fails to spawn (§6).
**Done when** the version is 22 or newer.

### Step 4: Install, build and create the account files
```bash
cd "<LOG_HUB_PATH>"
node start.mjs --preflight
```
The first run takes a minute or two (`npm ci`, then `npm run build`). It creates `config/openobserve.dev.env`, `config/openobserve.stg.env`, `config/openobserve.prod.env` and `config/seq.env` from the examples when they are missing, then prints a table:

```text
[PASS] Node.js Runtime           : Node.js v22.x detected (>= 22 required).
[PASS] Logs Storage              : Write access confirmed for logs folder: …
[WARN] Seq Provider              : Unconfigured (…)
[WARN] OpenObserve Provider      : Unconfigured for DEV (OPENOBSERVE_URL, OPENOBSERVE_EMAIL or OPENOBSERVE_TOKEN missing; …)
```

Running this before registering also avoids a client timeout on the first start.
**Done when** the table prints and Node / Logs are `PASS`.

### Step 5: Fill in the account
1. *Ask* which environments (`dev`, `stg`, `prod`) and whether Seq is needed.
2. For each environment, open `<LOG_HUB_PATH>/config/openobserve.<env>.env`. Values that are still example placeholders (starting `your_` or ending `@example.com`) count as empty. If it is not filled, *ask* the user for:
   - `OPENOBSERVE_URL`: the OpenObserve base URL (HTTPS)
   - `OPENOBSERVE_EMAIL`: the **service account** email
   - `OPENOBSERVE_TOKEN`: that account's token (a pasted `Basic …` credential also works; the browser session cookie does not)

   Write the file, or let the user write it if they prefer not to paste secrets into chat:
   ```text
   OPENOBSERVE_URL=https://observe.example.org
   OPENOBSERVE_EMAIL=logging-reader@company.com
   OPENOBSERVE_TOKEN=<token>
   ```
   How to create the token and enable the account for an organization: [OPENOBSERVE_GUIDE.md](OPENOBSERVE_GUIDE.md).
3. Seq (optional): `SEQ_SERVER_URL` and a read-only `SEQ_API_KEY` in `<LOG_HUB_PATH>/config/seq.env`, or in the entry's `env`.
4. Re-run the preflight for each environment:
   ```bash
   # bash / zsh
   OPENOBSERVE_ENV=dev node start.mjs --preflight
   ```
   ```powershell
   # PowerShell
   $env:OPENOBSERVE_ENV='dev'; node start.mjs --preflight
   ```

**Done when** `OpenObserve Provider` is `PASS … [DEV]` (it only checks the values are present; step 7 checks the connection).

### Step 6: Register the server in your client
Go to your client's subsection in §4 and add one entry per environment (§2). Prefer the client's own CLI command when it has one; otherwise merge into its config file.
**Done when** the entry is saved and the file still parses.

### Step 7: Reload and verify
1. Reload as your client's subsection says. Some clients must be restarted by the user; if so, tell them exactly what to click, and continue after they confirm.
2. Call `list_log_providers`. Expect `openobserve` with `configured: true` (and `seq` if set up). This reads the config only.
3. Call `list_openobserve_organizations`. This connects to OpenObserve. A list of organizations means the account works.
4. Report to the user: server name(s), environment(s), the config file you changed, and the result of step 3.

**Done when** `list_openobserve_organizations` returns organizations.

---

## 4. Client reference

Every subsection uses `log-hub-dev` and `<LOG_HUB_PATH>` = the clone's absolute path. Add `log-hub-prod` etc. the same way.

### 4.1 Google Antigravity (IDE and `agy` CLI)
- **Files**: global `~/.gemini/config/mcp_config.json` (Windows: `%USERPROFILE%\.gemini\config\mcp_config.json`); workspace `.agents/mcp_config.json`. Older builds used `~/.gemini/antigravity/mcp_config.json`; if that file exists and the new one does not, use it.
- **Shape**: `mcpServers` exactly as §2. Optional `cwd`, `disabled`.
- **IDE**: Agent panel → `…` → **MCP Servers** → **Manage MCP Servers** → **View raw config**, paste, save, then **Refresh**.
- **CLI**: `/mcp` opens the MCP Manager (status and reload).

### 4.2 Claude Code (CLI, VS Code and JetBrains extensions)
```bash
claude mcp add --transport stdio --scope user --env OPENOBSERVE_ENV=dev log-hub-dev -- node "<LOG_HUB_PATH>/start.mjs"
```
- Scopes: `local` (default, this project only, in `~/.claude.json`), `project` (writes `.mcp.json` at the repo root, shared via Git), `user` (all projects).
- Keep the name after the options; a name right after `--env` is parsed as `KEY=value`.
- Project file shape: `{"mcpServers":{"log-hub-dev":{"type":"stdio","command":"node","args":["<LOG_HUB_PATH>/start.mjs"],"env":{"OPENOBSERVE_ENV":"dev"}}}}`.
- **Verify**: `claude mcp list`, `claude mcp get log-hub-dev`, or `/mcp` in a session. `.mcp.json` servers ask for approval in the next interactive session.

### 4.3 Claude Desktop
- **File**: Windows `%APPDATA%\Claude\claude_desktop_config.json`; macOS `~/Library/Application Support/Claude/claude_desktop_config.json`; Linux `~/.config/Claude/claude_desktop_config.json`. Opened by Settings → Developer → **Edit Config**.
- Windows Store (MSIX) builds read `%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\claude_desktop_config.json` instead; if your edit has no effect, check there.
- **Shape**: §2, no `type`. Use the absolute node path if spawning fails.
- **Reload**: quit Claude Desktop completely (tray icon → Quit) and reopen. Logs: `%APPDATA%\Claude\logs\mcp-server-log-hub-dev.log` or `~/Library/Logs/Claude/`.

### 4.4 Cursor (editor and CLI)
- **Files**: global `~/.cursor/mcp.json`; project `.cursor/mcp.json`.
- **Shape**: §2 plus `"type": "stdio"`.
- **UI**: Settings → MCP, toggle per server. Logs: Output panel → **MCP Logs**. CLI: `agent mcp list`.

### 4.5 Devin Desktop (formerly Windsurf)
- **Files**: `~/.config/devin/mcp_config.json` (Windows `%APPDATA%\devin\mcp_config.json`); project `.devin/mcp_config.json`. Older Windsurf builds: `~/.codeium/windsurf/mcp_config.json`.
- **Shape**: §2, no `type`.
- **CLI**: `devin mcp add -s user log-hub-dev -- node "<LOG_HUB_PATH>/start.mjs"`, then add `env` in the file.
- **UI**: Cascade panel `…` → MCPs → refresh / toggle.

### 4.6 VS Code + GitHub Copilot
- **Files**: workspace `.vscode/mcp.json`; user profile `mcp.json` (Command Palette → **MCP: Open User Configuration**).
- **Shape**: top-level key is **`servers`**, not `mcpServers`:
  ```json
  {
    "servers": {
      "log-hub-dev": {
        "type": "stdio",
        "command": "node",
        "args": ["<LOG_HUB_PATH>/start.mjs"],
        "env": { "OPENOBSERVE_ENV": "dev" }
      }
    }
  }
  ```
- **Reload**: Command Palette → **MCP: List Servers** → `log-hub-dev` → Start (or Restart). Accept the trust prompt. Use Copilot Chat in **Agent** mode.

### 4.7 GitHub Copilot CLI
```bash
copilot mcp add log-hub-dev --env OPENOBSERVE_ENV=dev -- node "<LOG_HUB_PATH>/start.mjs"
```
- **Files**: user `~/.copilot/mcp-config.json`; project `.mcp.json` or `.github/mcp.json`.
- **Shape**: `mcpServers` with `"type": "local"`, `command`, `args`, `env`, `"tools": ["*"]`.
- **Verify**: `/mcp list` or `copilot mcp list`. Project servers load after you trust the folder.

### 4.8 Cline
- **File**: `~/.cline/data/settings/cline_mcp_settings.json` (or `$CLINE_MCP_SETTINGS_PATH`). Older VS Code installs: `<VS Code user dir>/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`. Easiest: Cline pane → MCP Servers icon → **Configure MCP Servers** opens the right file.
- **Shape**: `mcpServers` with **`"type": "stdio"`** (without it, Cline assumes SSE), `command`, `args`, `env`, `"disabled": false`.
- **Reload**: restart button on the server in the MCP Servers view.

### 4.9 Roo Code
- **Files**: project `.roo/mcp.json` (wins on a name clash); global `mcp_settings.json` (Roo pane → MCP icon → **Edit Global MCP**).
- **Shape**: §2 (`type` defaults to stdio). Optional `timeout` in seconds.
- **Reload**: restart button / toggle per server in the MCP view.

### 4.10 Continue
- **File**: `.continue/mcpServers/log-hub.yaml` in the workspace:
  ```yaml
  name: Log Hub
  version: 0.0.1
  schema: v1
  mcpServers:
    - name: log-hub-dev
      type: stdio
      command: node
      args: ["<LOG_HUB_PATH>/start.mjs"]
      env:
        OPENOBSERVE_ENV: dev
  ```
  Or the same `mcpServers` list in `~/.continue/config.yaml`.
- MCP tools work in **Agent** mode only. Saving the file reloads it.

### 4.11 Gemini CLI (being replaced by Antigravity CLI, §4.1)
```bash
gemini mcp add -s user -e OPENOBSERVE_ENV=dev log-hub-dev node "<LOG_HUB_PATH>/start.mjs"
```
- **Files**: `~/.gemini/settings.json` or project `.gemini/settings.json`, key `mcpServers` (§2).
- **Verify**: `gemini mcp list` or `/mcp`. Stdio servers connect only in trusted folders.

### 4.12 OpenAI Codex (CLI, IDE extension and desktop app share one config)
```bash
codex mcp add log-hub-dev --env OPENOBSERVE_ENV=dev -- node "<LOG_HUB_PATH>/start.mjs"
```
- **Files**: `~/.codex/config.toml`; project `.codex/config.toml` (trusted projects only).
- **Shape** (raise the startup timeout: the default 10 s can be too short for the first start):
  ```toml
  [mcp_servers.log-hub-dev]
  command = "node"
  args = ['<LOG_HUB_PATH>/start.mjs']
  startup_timeout_sec = 120

  [mcp_servers.log-hub-dev.env]
  OPENOBSERVE_ENV = "dev"
  ```
  Use single-quoted TOML strings for Windows paths (no escaping).
- **Verify**: `codex mcp list` or `/mcp`. IDE: gear → Restart extension.

### 4.13 Zed
- **Files**: `~/.config/zed/settings.json` (Windows `%APPDATA%\Zed\settings.json`); project `.zed/settings.json`.
- **Shape**: key **`context_servers`**:
  ```json
  "context_servers": {
    "log-hub-dev": {
      "command": "node",
      "args": ["<LOG_HUB_PATH>/start.mjs"],
      "env": { "OPENOBSERVE_ENV": "dev" }
    }
  }
  ```
- **Verify**: Agent panel settings, the green dot "Server is active". Reloads automatically.

### 4.14 JetBrains AI Assistant and Junie
- **AI Assistant** (UI only): Settings → Tools → AI Assistant → **Model Context Protocol (MCP)** → Add → STDIO → paste the §2 JSON. Choose Global or Project level. Status column shows the connection; **Reconnect** reloads.
- **Junie**: files `~/.junie/mcp/mcp.json` (global) and `.junie/mcp/mcp.json` (project), key `mcpServers` (§2). IDE: Settings → Tools → Junie → MCP Settings. CLI: `/mcp`.

### 4.15 Kiro (IDE and `kiro-cli`, which replaced the Amazon Q Developer CLI)
- **Files**: user `~/.kiro/settings/mcp.json`; workspace `.kiro/settings/mcp.json`.
- **Shape**: §2. Optional `disabled`, `autoApprove`.
- **CLI**: `kiro-cli mcp add --name log-hub-dev --command node --args "<LOG_HUB_PATH>/start.mjs" --env OPENOBSERVE_ENV=dev` (check `kiro-cli mcp add --help` for the scope flag).
- **Reload**: saving the file reconnects. Status: Kiro panel → MCP servers. Logs: Output → **Kiro - MCP Logs**.

### 4.16 Amazon Q Developer (IDE plugin)
- **UI**: Q Chat → tools icon → `+` → scope Global (`~/.aws/amazonq/default.json`) or Local (`.amazonq/default.json`) → transport stdio, command `node`, argument `<LOG_HUB_PATH>/start.mjs`, env `OPENOBSERVE_ENV=dev`.
- Legacy `~/.aws/amazonq/mcp.json` (key `mcpServers`, §2) is still read. For the CLI, use Kiro (§4.15).

### 4.17 OpenCode
- **Files**: global `~/.config/opencode/opencode.json`; project `opencode.json`.
- **Shape**: key `mcp`, `command` is one array, env key is `environment`:
  ```json
  {
    "$schema": "https://opencode.ai/config.json",
    "mcp": {
      "log-hub-dev": {
        "type": "local",
        "command": ["node", "<LOG_HUB_PATH>/start.mjs"],
        "environment": { "OPENOBSERVE_ENV": "dev" },
        "enabled": true,
        "timeout": 60000
      }
    }
  }
  ```
- **Verify**: `opencode mcp list`. Restart OpenCode after editing.

### 4.18 Goose
- **File**: `~/.config/goose/config.yaml` (Windows `%APPDATA%\Block\goose\config\config.yaml`):
  ```yaml
  extensions:
    log-hub-dev:
      name: log-hub-dev
      type: stdio
      cmd: node
      args: ["<LOG_HUB_PATH>/start.mjs"]
      envs:
        OPENOBSERVE_ENV: dev
      enabled: true
      timeout: 300
  ```
- Or `goose configure` → Add Extension → Command-line Extension. Desktop: Extensions → Add custom extension → Standard IO. Applies to new sessions.

### 4.19 Any other MCP client
Find its "stdio" / "local" / "command" server config (*ask* the user if you cannot), and map §2 onto it: a name, the command `node`, one argument `<LOG_HUB_PATH>/start.mjs`, one environment variable `OPENOBSERVE_ENV`. Watch for the three common variations: the top-level key (`mcpServers`, `servers`, `context_servers`, `mcp`, `extensions`), whether `type` is required (`stdio` or `local`), and whether command and args are one array.

---

## 5. Several environments, and Seq

```json
{
  "mcpServers": {
    "log-hub-dev": {
      "command": "node",
      "args": ["<LOG_HUB_PATH>/start.mjs"],
      "env": { "OPENOBSERVE_ENV": "dev", "SEQ_SERVER_URL": "https://seq.example.com", "SEQ_API_KEY": "<read-only key>" }
    },
    "log-hub-prod": {
      "command": "node",
      "args": ["<LOG_HUB_PATH>/start.mjs"],
      "env": { "OPENOBSERVE_ENV": "prod" }
    }
  }
}
```

- `OPENOBSERVE_ENV` picks `config/openobserve.<env>.env`; that file wins over `OPENOBSERVE_*` variables in `env`.
- `SEQ_*` variables in `env` win over `config/seq.env`. Prefer the file so the key is not in the client config.
- Same clone, several entries: each starts its own process. Account details: [README](../README.md#-quick-start).

---

## 6. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `[start] Node … is too old` | Install Node 22+; point `command` at the new `node` absolute path. |
| `'npm ci' failed` | Network / proxy / registry problem. Run `node start.mjs --preflight` in a terminal, fix the npm error shown, retry. |
| Server not listed in the client | Wrong file or key (§4), invalid JSON after the edit, backslashes not escaped, client not reloaded. Restore the `.bak` if needed. |
| `spawn node ENOENT` / server fails to start in a GUI app | The app does not see your shell PATH. Use the absolute node path from step 3 as `command`. |
| Timeout on first start | The first run installs and builds. Run step 4 first, or raise the client's startup timeout (Codex `startup_timeout_sec`, OpenCode `timeout`). |
| `configured: false` / `WARN Unconfigured` | Placeholders still in `config/openobserve.<env>.env`, or `OPENOBSERVE_ENV` in the entry names another environment. |
| 401 / 403 from `list_openobserve_organizations` | Wrong email/token, or the service account is not enabled for the organization. See [OPENOBSERVE_GUIDE.md](OPENOBSERVE_GUIDE.md). |
| `OpenObserve URL must use HTTPS` | Use the `https://` URL (plain HTTP is accepted only for localhost). |
| Anything else | Server log: `<LOG_HUB_PATH>/logs/mcp-process.log`. Client log: see your §4 subsection. |

---

## 7. After connecting

- Start with the prompts `investigate_api_bug` (bug report → live log search) or `analyze_ai_context` (question → read an export → compare with source).
- ai-context exports are read **only** through `list_ai_context_snapshots` and `read_ai_context`: `SUMMARY.lhub` first, then the `file:line` it points to, then the request's `rcid/` file. Never open `.lhub` files or the `ai-context/` folder with file tools.
- The server sends these rules as MCP server instructions on connect. Optional rule for the consuming repository: see [README](../README.md#using-it-from-another-repository-eg-antigravity-on-your-backend-repo).
- Full tool list: [AGENTS.md §4](../AGENTS.md#4-mcp-tools-reference).
