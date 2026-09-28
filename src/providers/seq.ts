import { config } from '../config.js';
import { LogEntry, LogProvider, LogQuery, ProviderStatus } from '../types.js';
import { normalizeLogLevel, parseTimeBound } from './base.js';
import { logger } from '../utils/logger.js';

export class SeqProvider implements LogProvider {
  public readonly name = 'seq';

  public getStatus(): ProviderStatus {
    const configured = Boolean(config.seq.serverUrl && config.seq.apiKey);
    const missing: string[] = [];
    if (!config.seq.serverUrl) missing.push('SEQ_SERVER_URL');
    if (!config.seq.apiKey) missing.push('SEQ_API_KEY');

    return {
      name: this.name,
      configured,
      endpoint: config.seq.serverUrl || undefined,
      missingVariables: missing.length ? missing : undefined,
      details: configured
        ? `Configured for Seq server at ${config.seq.serverUrl} (connection not verified)`
        : `Seq is unconfigured (${missing.join(', ')} missing)`,
    };
  }

  public async queryLogs(params: LogQuery): Promise<LogEntry[]> {
    const status = this.getStatus();
    if (!status.configured) {
      throw new Error(`Seq provider is not configured: ${status.details}`);
    }

    const count = Math.min(Math.max(params.limit || 50, 1), 500);
    const url = new URL(`${config.seq.serverUrl}/api/events`);
    url.searchParams.set('count', count.toString());
    url.searchParams.set('render', 'true');

    if (params.query) {
      url.searchParams.set('filter', params.query);
    }
    const fromIso = parseTimeBound(params.from);
    if (fromIso) {
      url.searchParams.set('fromDateUtc', fromIso);
    }
    const toIso = parseTimeBound(params.to);
    if (toIso) {
      url.searchParams.set('toDateUtc', toIso);
    }

    logger.debug(`Querying Seq API: ${url.toString()}`);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'X-Seq-ApiKey': config.seq.apiKey,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`Seq API returned HTTP ${response.status}: ${errorText}`);
      }

      const events = (await response.json()) as Array<{
        Timestamp?: string;
        Level?: string;
        RenderedMessage?: string;
        MessageTemplate?: string;
        Properties?: Record<string, unknown> | Array<{ Name: string; Value: unknown }>;
      }>;

      if (!Array.isArray(events)) {
        return [];
      }

      return events.map((ev) => {
        let metadata: Record<string, unknown> | undefined;
        if (ev.Properties) {
          if (Array.isArray(ev.Properties)) {
            metadata = {};
            for (const prop of ev.Properties) {
              if (prop && prop.Name) metadata[prop.Name] = prop.Value;
            }
          } else if (typeof ev.Properties === 'object') {
            metadata = ev.Properties as Record<string, unknown>;
          }
        }

        return {
          timestamp: ev.Timestamp || new Date().toISOString(),
          level: normalizeLogLevel(ev.Level),
          message: ev.RenderedMessage || ev.MessageTemplate || 'No message provided',
          provider: this.name,
          metadata,
        };
      });
    } catch (err) {
      logger.error(`Seq query failed: ${(err as Error).message}`);
      throw err;
    }
  }
}
