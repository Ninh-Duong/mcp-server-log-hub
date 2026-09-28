import { config } from '../config.js';
import { LogEntry, LogProvider, LogQuery, ProviderStatus } from '../types.js';
import { normalizeLogLevel, parseTimeBound } from './base.js';
import { logger } from '../utils/logger.js';

export class ObserveProvider implements LogProvider {
  public readonly name = 'observe';

  public getStatus(): ProviderStatus {
    const configured = Boolean(config.observe.customerId && config.observe.token);
    const missing: string[] = [];
    if (!config.observe.customerId) missing.push('OBSERVE_CUSTOMER_ID');
    if (!config.observe.token) missing.push('OBSERVE_TOKEN');

    const domain = config.observe.domain || 'observeinc.com';
    const endpoint = config.observe.customerId
      ? `https://${config.observe.customerId}.${domain}`
      : undefined;

    return {
      name: this.name,
      configured,
      endpoint,
      missingVariables: missing.length ? missing : undefined,
      details: configured
        ? `Configured for Observe customer ${config.observe.customerId} on ${domain}`
        : `Observe is unconfigured (${missing.join(', ')} missing)`,
    };
  }

  public async queryLogs(params: LogQuery): Promise<LogEntry[]> {
    const status = this.getStatus();
    if (!status.configured) {
      throw new Error(`Observe provider is not configured: ${status.details}`);
    }

    const domain = config.observe.domain || 'observeinc.com';
    const baseUrl = `https://${config.observe.customerId}.${domain}`;
    const url = new URL(`${baseUrl}/v1/query`);

    const limit = Math.min(Math.max(params.limit || 50, 1), 500);
    const fromIso = parseTimeBound(params.from) || parseTimeBound('1h');
    const toIso = parseTimeBound(params.to) || new Date().toISOString();

    // Construct OPAL or query payload for Observe
    const opalQuery = params.query ? params.query : 'filter true';
    const body = {
      query: opalQuery,
      startTime: fromIso,
      endTime: toIso,
      limit,
    };

    logger.debug(`Querying Observe API: ${url.toString()}`, { query: opalQuery, from: fromIso, to: toIso });

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.observe.token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`Observe API returned HTTP ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as {
        rows?: Array<Record<string, unknown>>;
        events?: Array<Record<string, unknown>>;
        data?: Array<Record<string, unknown>>;
      };

      const items = data.rows || data.events || data.data || [];
      if (!Array.isArray(items)) {
        return [];
      }

      return items.map((row) => {
        const timestamp =
          typeof row.timestamp === 'string'
            ? row.timestamp
            : typeof row.valid_from === 'string'
              ? row.valid_from
              : new Date().toISOString();

        const level =
          typeof row.level === 'string'
            ? row.level
            : typeof row.severity === 'string'
              ? row.severity
              : 'Information';

        const message =
          typeof row.message === 'string'
            ? row.message
            : typeof row.log === 'string'
              ? row.log
              : JSON.stringify(row);

        const { timestamp: _t, level: _l, message: _m, log: _log, ...metadata } = row;

        return {
          timestamp,
          level: normalizeLogLevel(level),
          message,
          provider: this.name,
          metadata: Object.keys(metadata).length ? metadata : undefined,
        };
      });
    } catch (err) {
      logger.error(`Observe query failed: ${(err as Error).message}`);
      throw err;
    }
  }
}
