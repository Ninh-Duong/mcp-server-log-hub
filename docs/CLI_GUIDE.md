# CLI guide

Run `npm run build`, then `npm run cli`. The first menu asks which log platform you want:

```text
1. Seq
2. Observe
3. Exit
```

Select **Seq** to enter its server URL and read-only API key, then run a log query. Select **Observe** to enter the OpenObserve URL, logging-account email, and account token. You can paste the raw token or a Basic credential; the CLI detects the email when a Basic credential is pasted. The secret is hidden while you type. The CLI saves the accounts separately in `config/seq.env` and `config/openobserve.env`, then connects to OpenObserve to list accessible Organizations and log streams. On a later run, you can reuse a saved account or enter a replacement.

At the token/API key prompt, paste with **Ctrl+Shift+V** or **Shift+Insert**, then press **Enter**. Asterisks confirm input was received; Backspace edits the value. The display stops at 32 asterisks, but the full token is accepted.

After choosing an OpenObserve stream, choose RCID search or SQL search. RCID search defaults to a field named `rcid`; enter the actual field name if your logs use another name. Both searches default to the last 15 minutes and at most 50 results. A query may return up to 500 results.

The credential files and the entire `logs/` and `log-work/` directories are ignored by Git. `logs/mcp-process.log` records provider endpoint, status, duration, result count, and failures without credentials, query values, or returned log contents. `npm run preflight` checks local configuration; selecting Observe in the CLI checks the real API connection. Start the MCP stdio server separately with `npm start`.

See [OpenObserve log access](OPENOBSERVE_GUIDE.md) for account-token creation and Organization permissions.
