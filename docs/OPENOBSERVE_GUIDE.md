# OpenObserve log access

This repository connects to **OpenObserve**. The Organizations in the top-bar dropdown are the environments you can choose. Each Organization has log streams; searches run against one Organization at a time. The old Observe by Snowflake configuration is no longer used.

## 1. Create a logging account and token

In OpenObserve Enterprise, ask an administrator to create a dedicated service account in **IAM → Service Accounts → Add Service Account**. Save its email and the token shown at creation. The token is shown only once. Assign the service account a read-only role (Viewer or an equivalent custom role) in each Organization it should search. Its Organization list is based on its own permissions, so it can differ from your personal browser account. An ingestion token cannot search logs. See the [OpenObserve service account guide](https://openobserve.ai/docs/user-guide/account-administration/identity-and-access-management/service-accounts/) and [RBAC guide](https://openobserve.ai/docs/user-guide/account-administration/identity-and-access-management/role-based-access-control/).

If your deployment does not provide service accounts, ask its administrator for an API-capable read-only logging identity. Do not copy the browser `session` cookie into this repository. If a session cookie was exposed, sign out to invalidate it.

## 2. Configure separate accounts

For each environment you use, copy `config/openobserve.env.example` to `config/openobserve.dev.env`, `config/openobserve.stg.env` and/or `config/openobserve.prod.env` and fill in that environment's URL, service-account email and token (a Basic credential in `OPENOBSERVE_TOKEN` is split into email and token automatically). Then run `npm run cli`, choose **2. Observe** and pick **DEV**, **STG** or **PROD**; the CLI connects with that file and never prompts for or saves an Observe account. MCP mode uses the account named by `OPENOBSERVE_ENV` (e.g. `"OPENOBSERVE_ENV": "dev"` in the MCP client `env`). Choose **1. Seq** to enter its own URL and API key, saved separately in `config/seq.env`. You can also edit those files manually; the tracked `.env.example` files show the expected variables. The real account files are ignored by Git. Environment variables override file values. The root `.env` is still read for generic settings such as `LOG_LEVEL`.

Restart the CLI or MCP process after editing an account file. Never paste tokens, cookies, or full authenticated curl commands into tickets or chat.

## 3. Use the CLI

Run `npm run build`, then `npm run cli`. Choose **2. Observe**. The CLI verifies credentials by fetching accessible Organizations, asks you to select one, then lists its log streams. Select a stream and choose either:

- **Service & level:** lists the services that logged in the stream since `From` (default `1h`) with their log counts — plus Error/Warning counts for structured streams. Pick a service (or `0` for all), then one or more levels (`1` Error+Fatal/Critical, `2` Warning, `3` Information, `4` Debug/Verbose, `5` All; e.g. `1,2`). Structured streams use `service_name` (or `applicationname`) and `severity`. Kubernetes streams use the deployment name from `kubernetes_pod_name` (pod hash removed) and read the level from the log text, so results may be fewer than the limit.
- **RCID:** enter the field name (`rcid` by default) and the RCID value. This performs an exact match. Check the stream schema or a sample log if the real RCID field has another name.
- **SQL:** enter OpenObserve SQL for the selected Organization. For example, `SELECT * FROM "wecrm_ape_prod" ORDER BY _timestamp DESC`.

Both searches default to the last 15 minutes and 50 results. The maximum result limit is 500. Time inputs support ISO timestamps or relative values such as `15m`, `1h`, `24h`, and `7d`.

## 4. Use from an AI Agent

Run `npm start` as an MCP stdio server or mount `registerLogHubTools()` in a parent MCP. Start an investigation with the `investigate_api_bug` MCP Prompt. It guides the agent to inspect the source first, discover accessible Organizations and streams, inspect stream schema, write bounded SQL, retrieve evidence, and correlate the result with source code. The calling agent saves case evidence under `log-work/<case-id>/` in its own repository and keeps raw evidence Git-ignored; Log Hub does not write files into that repository.

The agent tools are `list_openobserve_organizations`, `list_openobserve_streams`, `list_openobserve_stream_schema`, `list_openobserve_services`, `get_openobserve_service_logs`, `export_openobserve_logs`, `find_openobserve_logs_by_rcid`, and `search_openobserve_logs`. Use `list_openobserve_services` and `get_openobserve_service_logs` to filter a service by level without writing SQL; Kubernetes streams have no level field. Schema discovery returns field names and types, so the agent can use actual fields rather than guessing. SQL search accepts one SELECT statement, applies explicit `from`/`to` API bounds, and caps results at 500. Start with a narrow time range and limit of 100 or less. Each successful search returns the executed SQL, bounds, and log rows for the agent's evidence file. Each search takes an explicit Organization identifier; it does not inherit a CLI selection. The schema tool uses OpenObserve's [`GET /api/{organization}/streams/{stream}/schema?type=logs`](https://openobserve.ai/docs/reference/api/stream/schema/) endpoint.

The process log at `logs/mcp-process.log` records provider request start, endpoint path, HTTP status, duration, result counts, and failures. It omits authorization headers, SQL/RCID values, and returned log contents. The old `provider: "observe"` spelling remains an alias, but now calls OpenObserve rather than Observe by Snowflake.

Grant the logging account only the Organizations and streams the agent may read. The OpenObserve API uses HTTP Basic authentication with `email:token`, and the repository sends it over HTTPS. It calls `GET /api/organizations`, `GET /api/{organization}/streams?type=logs`, and `POST /api/{organization}/_search`. See the [OpenObserve API reference](https://openobserve.ai/docs/reference/api/), [stream API](https://openobserve.ai/docs/reference/api/stream/list/), and [search API](https://openobserve.ai/docs/reference/api/search/search/).

The OpenObserve UI may call `_search_stream` for streaming results. This MCP currently uses the documented `_search` JSON API, which is simpler for CLI and agent calls.

## ai-context snapshots

Saving from the CLI (or the `export_openobserve_logs` MCP tool) writes a Git-ignored snapshot under `ai-context/` (override with `AI_CONTEXT_DIR`). It is laid out so an AI agent reads a small summary first and opens raw logs only where needed:

```
ai-context/
  INDEX.md                                   one line per snapshot, newest first
  openobserve/<env>/<org>/<stream>/<UTC stamp>_<service>_<levels>/
    SUMMARY.md       read first: source, range, row count (and truncation), counts by service x level,
                     top 20 message patterns (most severe first) with first/last seen and an example file:line
    patterns.json    every pattern; ids, numbers, timestamps and quoted values are normalized so repeats group,
                     and an exception message is appended to show the root cause behind generic messages
    manifest.json    query parameters, to reproduce or compare snapshots
    logs/<service>/<level>.jsonl   one log per line, oldest first: ts, level, service, message, ids, attrs
    flows/<field>-<id>.jsonl       full request timeline of one failing request (all services, all levels)
```

**Request flows.** After saving, the CLI asks `Fetch full request flows (rcid/trace_id) for N sampled errors? (Y/n)` (the MCP export tool does this by default, `include_flows`). It takes every distinct correlation id of the Error/Fatal logs (`rcid`, then `correlationid`, `trace_id`, `traceid`; 200 at most, most frequent bug first), then runs one SELECT per id (5 in parallel) for every log in the stream carrying that id on any of those fields, with the window widened by 15 minutes on each side. The same id logged as `rcid` by one sink and `trace_id` by another is one flow. Flows over 500 lines keep 400 lines before the first error and 100 from it. `SUMMARY.md` has a **Bugs** table: one row per error pattern with its request count, the first failing step (service + message of the first error in the newest flow, often upstream of the logged error) and its flow files; `manifest.json` → `flows` lists every flow with its bug #, service path, rows and duration. Errors without any correlation id (for example background jobs) have no flow.

**One RCID.** `export_openobserve_logs` with `rcid` (or CLI search mode `2. RCID`) saves just that request's flow as a snapshot, so an agent can read the timeline and see which step failed. Widen `from` (e.g. `7d`) if nothing is found.

**Bug list for a service.** `export_openobserve_logs` with `service` and `level: 'Error'` for the day, then read the SUMMARY Bugs table.

`ids` holds correlation fields (rcid, correlationId, traceId, requestId); `attrs` holds the remaining non-empty fields. Snapshots contain real log data, possibly personal data, and are never committed; delete old snapshot folders by hand.
