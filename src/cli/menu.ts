import { createInterface } from 'node:readline';
import { runPreflightChecks } from '../utils/preflight.js';
import { defaultLogHubService } from '../service.js';
import { logger } from '../utils/logger.js';
import { startMcpServer } from '../index.js';

export async function runCliMenu(): Promise<void> {
  logger.setCliMode(true);
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (query: string): Promise<string> =>
    new Promise((resolve) => rl.question(query, resolve));

  const showBanner = () => {
    console.clear();
    console.log('\x1b[36m========================================================\x1b[0m');
    console.log('\x1b[1m\x1b[32m           MCP SERVER LOG HUB - CLI CONTROLLER          \x1b[0m');
    console.log('\x1b[36m========================================================\x1b[0m');
    console.log('Unified multi-provider log observability for AI Agents & Humans');
    console.log('--------------------------------------------------------\n');
  };

  let keepRunning = true;

  while (keepRunning) {
    showBanner();
    console.log('\x1b[33m[MENU OPTIONS]\x1b[0m');
    console.log('  1. Run Environment Preflight Diagnostics');
    console.log('  2. List Supported Log Providers & Status');
    console.log('  3. Execute Live Test Query');
    console.log('  4. View Recent Process Logs (logs/mcp-process.log)');
    console.log('  5. Launch MCP Server in Stdio Mode');
    console.log('  6. Exit');
    console.log('--------------------------------------------------------');

    const choice = (await prompt('\x1b[1mSelect an option (1-6): \x1b[0m')).trim();

    switch (choice) {
      case '1': {
        runPreflightChecks(true);
        await prompt('\nPress Enter to return to menu...');
        break;
      }
      case '2': {
        console.log('\n--- Configured Log Providers ---');
        const providers = defaultLogHubService.listProviders();
        for (const p of providers) {
          const statusIcon = p.configured ? '\x1b[32m[READY]\x1b[0m' : '\x1b[33m[UNCONFIGURED]\x1b[0m';
          console.log(`\n• Provider: \x1b[1m${p.name.toUpperCase()}\x1b[0m ${statusIcon}`);
          console.log(`  Details : ${p.details}`);
          if (p.endpoint) console.log(`  Endpoint: ${p.endpoint}`);
          if (p.missingVariables) console.log(`  Missing : ${p.missingVariables.join(', ')}`);
        }
        await prompt('\nPress Enter to return to menu...');
        break;
      }
      case '3': {
        console.log('\n--- Live Query Test ---');
        const providerInput = (await prompt('Target Provider (seq/observe or leave blank for all): ')).trim();
        const queryInput = (await prompt('Query filter (e.g., Error or *): ')).trim();
        const limitInput = (await prompt('Max count (default: 10): ')).trim();
        const limit = parseInt(limitInput || '10', 10);

        console.log('\nFetching logs...');
        try {
          const startTime = Date.now();
          const results = await defaultLogHubService.queryLogs({
            provider: providerInput || undefined,
            query: queryInput || undefined,
            limit: isNaN(limit) ? 10 : limit,
          });
          const duration = Date.now() - startTime;

          console.log(`\nFound ${results.length} events in ${duration}ms:`);
          for (const ev of results) {
            console.log(`[${ev.timestamp}] [${ev.level}] (${ev.provider}) ${ev.message}`);
          }
        } catch (err) {
          console.error(`\x1b[31mQuery Error:\x1b[0m ${(err as Error).message}`);
        }
        await prompt('\nPress Enter to return to menu...');
        break;
      }
      case '4': {
        console.log('\n--- Recent MCP Process Logs ---');
        const recent = logger.getRecentLogs(25);
        if (recent.length === 0) {
          console.log('No logs recorded yet in logs/mcp-process.log');
        } else {
          for (const line of recent) {
            console.log(line);
          }
        }
        await prompt('\nPress Enter to return to menu...');
        break;
      }
      case '5': {
        rl.close();
        keepRunning = false;
        console.log('\nSwitching to MCP Stdio transport mode...');
        logger.setCliMode(false);
        await startMcpServer();
        return;
      }
      case '6': {
        console.log('\nExiting Log Hub CLI. Goodbye!\n');
        rl.close();
        keepRunning = false;
        process.exit(0);
        break;
      }
      default: {
        console.log('\x1b[31mInvalid selection. Please choose 1 to 6.\x1b[0m');
        await new Promise((r) => setTimeout(r, 1000));
        break;
      }
    }
  }
}
