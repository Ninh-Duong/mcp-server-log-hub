import { LogEntry, LogQuery, ProviderStatus } from './types.js';
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
      logger.info(`Querying provider '${provider.name}' with query: "${params.query || '*'}"`);
      const logs = await provider.queryLogs({ ...params, limit });
      return this.filterAndSort(logs, params.level, limit);
    }

    // Multi-provider query across all configured backends
    const configuredProviders = getAllProviders().filter((p) => p.getStatus().configured);
    if (configuredProviders.length === 0) {
      logger.warn('No log providers are currently configured with valid credentials.');
      return [];
    }

    logger.info(
      `Broadcasting log query across ${configuredProviders.length} configured providers: ${configuredProviders.map((p) => p.name).join(', ')}`
    );

    const queryPromises = configuredProviders.map(async (provider) => {
      try {
        return await provider.queryLogs({ ...params, limit });
      } catch (err) {
        logger.error(`Error querying provider '${provider.name}': ${(err as Error).message}`);
        return [];
      }
    });

    const results = await Promise.all(queryPromises);
    const combined = results.flat();
    return this.filterAndSort(combined, params.level, limit);
  }

  private filterAndSort(logs: LogEntry[], levelFilter?: string, limit: number = 50): LogEntry[] {
    let filtered = logs;
    if (levelFilter) {
      const targetLevel = levelFilter.toLowerCase();
      filtered = logs.filter((log) => log.level.toLowerCase() === targetLevel);
    }

    // Sort descending by timestamp (newest first)
    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return filtered.slice(0, limit);
  }
}

export const defaultLogHubService = new LogHubService();
