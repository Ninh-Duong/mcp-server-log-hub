# Coding & Engineering Standards

## 1. Language & Runtime Conventions
- **Language**: TypeScript 5.8+ targetting `ES2022`.
- **Module System**: ESM (`"type": "module"` with `NodeNext` resolution). All imports must include `.js` extension (e.g. `import ... from './types.js'`).
- **Strict Typing**: No `any` unless explicitly wrapping unknown external JSON shapes. Every provider output must strictly conform to `LogEntry`.

---

## 2. Standardized Log Schema

Regardless of whether logs originate from Seq, OpenObserve, or future providers, they MUST normalize into the unified `LogEntry` interface:

```typescript
export interface LogEntry {
  timestamp: string;                      // ISO 8601 UTC (e.g. 2026-09-28T05:00:00.000Z)
  level: LogLevel | string;               // Normalized severity level
  message: string;                        // Rendered, human-readable log message
  provider: string;                       // Backend name ('seq', 'openobserve')
  metadata?: Record<string, unknown>;    // Optional key-value context attributes
}
```

### Severity Normalization Rules:
| Raw Provider Level | Normalized `LogLevel` |
| :--- | :--- |
| `fatal`, `critical`, `emerg`, `panic` | `Fatal` |
| `error`, `err`, `severe` | `Error` |
| `warn`, `warning` | `Warning` |
| `info`, `notice`, `information` | `Information` |
| `debug` | `Debug` |
| `trace`, `verbose` | `Verbose` |

---

## 3. Time Filtering Conventions

All tools and providers must accept both ISO 8601 timestamps and human-friendly relative duration strings:
- `'15m'` -> 15 minutes before now
- `'1h'` -> 1 hour before now
- `'24h'` or `'1d'` -> 24 hours before now
- `'7d'` or `'1w'` -> 7 days before now
- Standard ISO strings: `2026-09-28T00:00:00Z`

---

## 4. Error Handling & Resilience Contract

1. **Provider Isolation**: If one provider is unreachable or returns an HTTP 500 error during a multi-provider broadcast query, it must NOT fail the entire request. The error is logged to `logs/mcp-process.log` and results from healthy providers are returned.
2. **Timeouts**: Every external HTTP query MUST specify a timeout using `AbortSignal.timeout(15000)`. Never leave an HTTP connection open indefinitely.
3. **Graceful Unconfigured State**: If environment variables for a provider are missing, the server must mark that provider as `unconfigured` during preflight and continue running for other providers.
