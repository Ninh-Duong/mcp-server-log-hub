import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { LogHubService, defaultLogHubService } from './service.js';
import { LogLevel } from './types.js';

export interface RegisterToolsOptions {
  /** Optional prefix for tool names (useful when mounted inside a Master MCP, e.g. "log_hub_") */
  prefix?: string;
  /** Custom LogHubService instance */
  service?: LogHubService;
}

/**
 * Registers Log Hub tools directly into any McpServer instance.
 * Enables both standalone operation and direct in-process embedding by a Master MCP.
 */
export function registerLogHubTools(server: McpServer, options: RegisterToolsOptions = {}): void {
  const prefix = options.prefix || '';
  const service = options.service || defaultLogHubService;

  // 1. Tool: list_log_providers
  server.tool(
    `${prefix}list_log_providers`,
    'List all supported log providers (Seq, Observe) and their configuration/connection status.',
    {},
    async () => {
      const providers = service.listProviders();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                count: providers.length,
                providers,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // 2. Tool: query_logs
  server.tool(
    `${prefix}query_logs`,
    'Query logs across one or all configured log backends (Seq, Observe). Supports filter text, time bounds, severity level, and limit.',
    {
      provider: z
        .string()
        .optional()
        .describe("Specific provider to query ('seq' or 'observe'). Omit to broadcast across all configured backends."),
      query: z
        .string()
        .optional()
        .describe("Search text or native query syntax (Seq filter syntax or Observe OPAL)."),
      from: z
        .string()
        .optional()
        .describe("Start time as ISO 8601 string or relative expression (e.g. '15m', '1h', '24h', '7d')."),
      to: z
        .string()
        .optional()
        .describe('End time as ISO 8601 string.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .default(50)
        .describe('Maximum number of log events to return (1-500, default: 50).'),
      level: z
        .enum(['Verbose', 'Debug', 'Information', 'Warning', 'Error', 'Fatal'])
        .optional()
        .describe('Filter logs by minimum severity level.'),
    },
    async (args) => {
      try {
        const logs = await service.queryLogs({
          provider: args.provider,
          query: args.query,
          from: args.from,
          to: args.to,
          limit: args.limit,
          level: args.level as LogLevel | undefined,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  total: logs.length,
                  query: args.query || '*',
                  provider: args.provider || 'all-configured',
                  logs,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Log query error: ${(err as Error).message}`,
            },
          ],
        };
      }
    }
  );
}
