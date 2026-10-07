import { LogEntry, LogLevel, LogQuery, ProviderStatus } from './types.js';
import { normalizeLogLevel, resolveLevels } from './providers/base.js';
import { getAllProviders, getProvider, listProviders } from './providers/index.js';
import { logger } from './utils/logger.js';

export class LogHubService {
  /**
   * Returns configuration status of all available log providers
   */
  public listProviders(): ProviderStatus[] {
    return listProviders();
  }

  /**
   * Queries logs from a specific provider, or all configured providers if none specified
   */
  public async queryLogs(params: LogQuery & { provider?: string }): Promise<LogEntry[]> {
    const limit = Math.min(Math.max(params.limit || 50, 1), 500);

    // Single provider query
    if (params.provider) {
      const provider = getProvider(params.provider);
      if (!provider) {
        throw new Error(
          `Unknown provider '${params.provider}'. Available: ${getAllProviders().map((p) => p.name).join(', ')}`
        );
      }
      logger.info('log_query_started', {
        provider: provider.name, limit, queryProvided: Boolean(params.query),
        organization: params.organization, stream: params.stream, level: params.level,
      });
      const logs = await provider.queryLogs({ ...params, limit });
      const results = this.filterAndSort(logs, params.level, limit);
      logger.info('log_query_completed', { provider: provider.name, returned: results.length });
      return results;
    }

    // Multi-provider query across all configured backends
    const configuredProviders = getAllProviders().filter((p) => p.getStatus().configured && (p.name !== 'openobserve' || (params.organization && (params.query || params.stream))));
    if (configuredProviders.length === 0) {
      logger.warn('No log providers are currently configured with valid credentials.');
      return [];
    }

    logger.info(
      `Broadcasting log query across ${configuredProviders.length} configured providers: ${configuredProviders.map((p) => p.name).join(', ')}`
    );

    const queryPromises = configuredProviders.map(async (provider) => {
      try {
        logger.info('log_query_started', { provider: provider.name, limit, queryProvided: Boolean(params.query) });
        const logs = await provider.queryLogs({ ...params, limit });
        logger.info('log_query_completed', { provider: provider.name, returned: logs.length });
        return logs;
      } catch (err) {
        logger.error('log_query_failed', { provider: provider.name, errorType: err instanceof Error ? err.name : 'UnknownError' });
        return [];
      }
    });

    const results = await Promise.all(queryPromises);
    const combined = results.flat();
    return this.filterAndSort(combined, params.level, limit);
  }

  private filterAndSort(logs: LogEntry[], levelFilter?: LogLevel | LogLevel[], limit: number = 50): LogEntry[] {
    const levels = resolveLevels(levelFilter);
    const filtered = levels ? logs.filter((log) => levels.includes(normalizeLogLevel(log.level))) : logs;

    // Sort descending by timestamp (newest first)
    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return filtered.slice(0, limit);
  }
}

export const defaultLogHubService = new LogHubService();
