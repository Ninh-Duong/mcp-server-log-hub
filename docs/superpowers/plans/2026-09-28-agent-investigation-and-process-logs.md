# Agent Investigation and Process Logs Implementation Plan

> **For agentic workers:** Implement the checked tasks in order. Keep provider credentials and returned application logs out of process diagnostics.

**Goal:** Let an AI agent discover OpenObserve fields, create bounded SQL from its source-code investigation, retrieve evidence through MCP, and diagnose failures from useful process logs.

**Architecture:** MCP tools remain deterministic data access. An MCP prompt teaches the agent the investigation sequence and required query rules. The calling agent stores case evidence in its own repository. Provider requests write structured, redacted lifecycle events to the existing process log.

**Tech Stack:** TypeScript, Node.js standard library, MCP SDK already installed, existing node:test suite.

**Spec:** Current agreed plan in the conversation; OpenObserve stream schema API reference.

## Global Constraints

- Do not add npm dependencies.
- Keep MCP stdout reserved for JSON-RPC; process diagnostics go to the existing file and stderr.
- Never log credentials, authorization headers, raw log rows, or unredacted RCID/query values.
- Bound every OpenObserve search by time and result count.
- Keep investigation artifacts in the calling agent's repository, not Log Hub's filesystem.

---

### Task 1: Expose OpenObserve stream schema

**Files:** `src/providers/openobserve.ts`, `src/tools.ts`, `src/tests/openobserve.test.ts`, `docs/OPENOBSERVE_GUIDE.md`.

- [x] Add a failing provider test for `GET /api/{organization}/streams/{stream}/schema?type=logs` and field normalization.
- [x] Add `getStreamSchema` with organization and stream access checks.
- [x] Register `list_openobserve_stream_schema` with field names/types in its response.
- [x] Run the focused test and build.

### Task 2: Give agents a complete investigation contract

**Files:** `src/tools.ts`, `src/tests/tools.test.ts` (or the existing MCP test file), `docs/OPENOBSERVE_GUIDE.md`.

- [x] Add a failing registration/prompt test.
- [x] Register `investigate_api_bug` MCP Prompt with case inputs and the inspect-source → discover org/stream/schema → compose bounded SELECT → search → save evidence → correlate source flow sequence.
- [x] Make OpenObserve tool descriptions self-contained: provider, required identifiers, time units/limits, field discovery, quoting, errors, and result format.
- [x] Include executed SQL and search bounds in the tool result without placing raw SQL values in process logs.
- [x] Document that the caller saves `log-work/<case-id>/` in its own project and cites log timestamps plus source file/line in its analysis.

### Task 3: Make process logs explain each request

**Files:** `src/providers/openobserve.ts`, `src/providers/seq.ts`, `src/service.ts`, `src/cli/menu.ts`, `src/tools.ts`, `src/tests/openobserve.test.ts`.

- [x] Add a failing test proving a failed provider request is written with operation, endpoint, HTTP status, and duration, without authorization data.
- [x] Emit structured lifecycle events for provider request start/result/failure and result count.
- [x] Keep endpoint paths and status details; omit auth headers, response bodies, raw SQL/RCID, and returned log messages.
- [x] Route CLI/MCP failures through the process logger while keeping stdout clean in MCP mode.

### Task 4: Update operator/agent documentation

**Files:** `docs/OPENOBSERVE_GUIDE.md`, `docs/CLI_GUIDE.md`, `docs/ARCHITECTURE.md`, `docs/PARENT_MCP_GUIDE.md`.

- [x] Document the MCP prompt, schema tool, end-to-end agent flow, process log fields, and privacy boundaries.
- [x] Verify descriptions match registered MCP tool names and actual response shapes.
