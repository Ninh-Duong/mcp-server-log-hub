/**
 * Core type definitions for mcp-server-log-hub
 */

/** Ordered from least to most severe. */
export const LOG_LEVELS = ['Verbose', 'Debug', 'Information', 'Warning', 'Error', 'Fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogQuery {
  /** Search text, keyword, or provider-native query filter */
  query?: string;
  /** ISO 8601 timestamp or relative expression (e.g. '15m', '1h', '24h', '7d') */
  from?: string;
  /** ISO 8601 timestamp or end bound */
  to?: string;
  /** Maximum number of records to return (default: 50, max: 500) */
  limit?: number;
  /** One level = minimum severity; an array = exactly those levels */
  level?: LogLevel | LogLevel[];
  /** OpenObserve organization identifier */
  organization?: string;
  /** OpenObserve log stream */
  stream?: string;
}

export interface LogEntry {
  /** ISO 8601 formatted event timestamp */
  timestamp: string;
  /** Standardized log level */
  level: LogLevel | string;
  /** Rendered human-readable log message */
  message: string;
  /** Identifier of the provider that produced this log (e.g. 'seq', 'openobserve') */
  provider: string;
  /** Raw or structured contextual properties */
  metadata?: Record<string, unknown>;
}

export interface ProviderStatus {
  name: string;
  configured: boolean;
  endpoint?: string;
  missingVariables?: string[];
  details?: string;
}

export interface LogProvider {
  readonly name: string;
  getStatus(): ProviderStatus;
  queryLogs(params: LogQuery): Promise<LogEntry[]>;
}
