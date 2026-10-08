# CLI guide

Run `npm run cli` (it installs dependencies and builds on first run). The first menu asks which log platform you want:

```text
1. Seq
2. Observe
3. Exit
```

Select **Seq** to enter its server URL and read-only API key, then run a log query. The Seq key is hidden while you type and saved in `config/seq.env`; on a later run you can reuse it or enter a replacement. Select **Observe**, then choose the environment (**DEV**, **STG** or **PROD**). The CLI does not ask for an Observe account: it reads `config/openobserve.<dev|stg|prod>.env` and connects to list accessible Organizations and log streams. If that file is missing or incomplete, it reports `Connect failed` with the file path and missing variables.

At the token/API key prompt, paste with **Ctrl+Shift+V** or **Shift+Insert**, then press **Enter**. Asterisks confirm input was received; Backspace edits the value. The display stops at 32 asterisks, but the full token is accepted.

After choosing an OpenObserve stream, choose **Service & level**, RCID search, or SQL search, then a time range: Last 15 minutes / 1 hour / 6 hours / 24 hours / 7 days, or **Custom** with From/To as local time (`2026-10-07 09:00`), ISO 8601, or a relative value (`30m`). Up to 5,000 rows are fetched (paged 500 at a time); the terminal shows the newest 50. Afterwards answer `Save to ai-context? (Y/n)` to keep all rows as an AI-readable snapshot (see [OpenObserve guide](OPENOBSERVE_GUIDE.md#ai-context-snapshots)). Service & level lists the services in the stream (default last 1 hour) with log counts, then lets you pick a service and levels such as Error and Warning. RCID search defaults to a field named `rcid`; enter the actual field name if your logs use another name. Both searches default to the last 15 minutes and at most 50 results. A query may return up to 500 results.

The credential files and the entire `logs/` and `log-work/` directories are ignored by Git. `logs/mcp-process.log` records provider endpoint, status, duration, result count, and failures without credentials, query values, or returned log contents. `npm run preflight` checks local configuration; selecting Observe in the CLI checks the real API connection. Start the MCP stdio server separately with `npm start`.

See [OpenObserve log access](OPENOBSERVE_GUIDE.md) for account-token creation and Organization permissions.
