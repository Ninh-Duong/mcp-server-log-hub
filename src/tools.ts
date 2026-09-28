import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { LogHubService, defaultLogHubService } from './service.js';
import { LogLevel } from './types.js';
import { openObserveProvider } from './providers/index.js';

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
    'List supported log providers (Seq, OpenObserve) and their configuration status. This does not verify a network connection.',
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
    'Query logs from Seq or OpenObserve. OpenObserve requires organization and either stream or SQL query.',
    {
      provider: z
        .string()
        .optional()
        .describe("Specific provider to query ('seq' or 'openobserve')."),
      organization: z.string().optional().describe('OpenObserve organization identifier.'),
      stream: z.string().optional().describe('OpenObserve log stream.'),
      query: z
        .string()
        .optional()
        .describe('Seq filter expression or OpenObserve SQL.'),
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
          organization: args.organization,
          stream: args.stream,
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

  server.tool(`${prefix}list_openobserve_organizations`, 'Connect to OpenObserve and list organizations accessible to its configured logging account.', {}, async () => {
    try {
      const organizations = await openObserveProvider.listOrganizations();
      return { content: [{ type: 'text', text: JSON.stringify({ organizations }) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: (err as Error).message }] };
    }
  });

  server.tool(`${prefix}list_openobserve_streams`, 'List log streams in an accessible OpenObserve organization.', {
    organization: z.string().min(1),
  }, async ({ organization }) => {
    try {
      const streams = await openObserveProvider.listStreams(organization);
      return { content: [{ type: 'text', text: JSON.stringify({ organization, streams }) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: (err as Error).message }] };
    }
  });

  server.tool(`${prefix}find_openobserve_logs_by_rcid`, 'Find OpenObserve logs with an exact RCID in one accessible log stream.', {
    organization: z.string().min(1), stream: z.string().min(1), rcid: z.string().min(1),
    field: z.string().min(1).default('rcid').describe('Name of the RCID field in the stream.'),
    from: z.string().default('15m'), to: z.string().optional(), limit: z.number().int().min(1).max(500).default(50),
  }, async (args) => {
    try {
      const logs = await openObserveProvider.findByRcid(args);
      return { content: [{ type: 'text', text: JSON.stringify({ total: logs.length, logs }) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: (err as Error).message }] };
    }
  });

  server.tool(`${prefix}search_openobserve_logs`, 'Run a bounded SQL search within an accessible OpenObserve organization.', {
    organization: z.string().min(1), sql: z.string().min(1),
    from: z.string().default('15m'), to: z.string().optional(), limit: z.number().int().min(1).max(500).default(50),
  }, async (args) => {
    try {
      const logs = await openObserveProvider.searchLogs(args);
      return { content: [{ type: 'text', text: JSON.stringify({ total: logs.length, logs }) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: (err as Error).message }] };
    }
  });
}
