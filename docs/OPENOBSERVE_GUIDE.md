# OpenObserve log access

This repository connects to **OpenObserve**. The Organizations in the top-bar dropdown are the environments you can choose. Each Organization has log streams; searches run against one Organization at a time. The old Observe by Snowflake configuration is no longer used.

## 1. Create a logging account and token

In OpenObserve Enterprise, ask an administrator to create a dedicated service account in **IAM → Service Accounts → Add Service Account**. Save its email and the token shown at creation. The token is shown only once. Assign the service account a read-only role (Viewer or an equivalent custom role) in each Organization it should search. Its Organization list is based on its own permissions, so it can differ from your personal browser account. An ingestion token cannot search logs. See the [OpenObserve service account guide](https://openobserve.ai/docs/user-guide/account-administration/identity-and-access-management/service-accounts/) and [RBAC guide](https://openobserve.ai/docs/user-guide/account-administration/identity-and-access-management/role-based-access-control/).

If your deployment does not provide service accounts, ask its administrator for an API-capable read-only logging identity. Do not copy the browser `session` cookie into this repository. If a session cookie was exposed, sign out to invalidate it.

## 2. Configure separate accounts

Edit the existing `config/openobserve.env` and fill in the service account email and token. Its URL is the instance URL you supplied; change it if your deployment moves. Set a separate Seq API key in `config/seq.env`. The tracked `.env.example` files show the expected variables. Both real `.env` files are ignored by Git. Environment variables override file values. The root `.env` is still read for generic settings such as `LOG_LEVEL`.

Restart the CLI or MCP process after editing an account file. Never paste tokens, cookies, or full authenticated curl commands into tickets or chat.

## 3. Use the CLI

Run `npm run build`, then `npm run cli`. Choose **OpenObserve Log Processing**. The CLI verifies credentials by fetching accessible Organizations, asks you to select one, then lists its log streams. Select a stream and choose either:

- **RCID:** enter the field name (`rcid` by default) and the RCID value. This performs an exact match. Check the stream schema or a sample log if the real RCID field has another name.
- **SQL:** enter OpenObserve SQL for the selected Organization. For example, `SELECT * FROM "wecrm_ape_prod" ORDER BY _timestamp DESC`.

Both searches default to the last 15 minutes and 50 results. The maximum result limit is 500. Time inputs support ISO timestamps or relative values such as `15m`, `1h`, `24h`, and `7d`.

## 4. Use from an AI Agent

Run `npm start` as an MCP stdio server or mount `registerLogHubTools()` in a parent MCP. The agent can call `list_openobserve_organizations`, `list_openobserve_streams`, `find_openobserve_logs_by_rcid`, and `search_openobserve_logs`. Each search takes an explicit Organization identifier and time window; the agent does not inherit a CLI menu selection. `query_logs` also accepts `provider: "openobserve"` with `organization` and either `stream` or a SQL `query`. The old `provider: "observe"` spelling remains an alias, but now calls OpenObserve rather than Observe by Snowflake.

Grant the logging account only the Organizations and streams the agent may read. The OpenObserve API uses HTTP Basic authentication with `email:token`, and the repository sends it over HTTPS. It calls `GET /api/organizations`, `GET /api/{organization}/streams?type=logs`, and `POST /api/{organization}/_search`. See the [OpenObserve API reference](https://openobserve.ai/docs/reference/api/), [stream API](https://openobserve.ai/docs/reference/api/stream/list/), and [search API](https://openobserve.ai/docs/reference/api/search/search/).

The OpenObserve UI may call `_search_stream` for streaming results. This MCP currently uses the documented `_search` JSON API, which is simpler for CLI and agent calls.
