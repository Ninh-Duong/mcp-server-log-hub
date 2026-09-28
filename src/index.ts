#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerLogHubTools } from './tools.js';
import { runPreflightChecks } from './utils/preflight.js';
import { logger } from './utils/logger.js';

// Library exports for Master / Router MCP integration
export { registerLogHubTools, type RegisterToolsOptions } from './tools.js';
export { LogHubService, defaultLogHubService } from './service.js';
export { getProvider, getAllProviders, listProviders, openObserveProvider } from './providers/index.js';
export { runPreflightChecks, type PreflightResult } from './utils/preflight.js';
export { logger } from './utils/logger.js';
export * from './types.js';

/**
 * Initializes and starts the MCP server over stdio transport
 */
export async function startMcpServer(): Promise<McpServer> {
  logger.info('Initializing mcp-server-log-hub in stdio mode...');

  // Run silent preflight checks and log warnings to stderr/file
  const preflight = runPreflightChecks(false);
  if (!preflight.ok) {
    logger.warn('Preflight checks detected issues; some providers may be unavailable.');
  }

  const server = new McpServer({
    name: 'mcp-server-log-hub',
    version: '1.0.0',
  });

  // Register Log Hub tools into the MCP server
  registerLogHubTools(server);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('mcp-server-log-hub is running and connected via stdio.');
  return server;
}

// Execution dispatch: CLI menu, Preflight check, or MCP Stdio server
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--cli') || args.includes('-c')) {
    const { runCliMenu } = await import('./cli/menu.js');
    await runCliMenu();
  } else if (args.includes('--preflight')) {
    const result = runPreflightChecks(true);
    process.exit(result.ok ? 0 : 1);
  } else {
    // Default mode: MCP Server over stdio
    await startMcpServer();
  }
}

// Only auto-run if directly executed as a script
if (process.argv[1] && (process.argv[1].endsWith('index.js') || process.argv[1].endsWith('index.ts'))) {
  main().catch((err) => {
    logger.error(`Fatal startup error: ${(err as Error).message}`, err);
    process.exit(1);
  });
}
