import { createInterface } from 'node:readline';
import { runPreflightChecks } from '../utils/preflight.js';
import { defaultLogHubService } from '../service.js';
import { logger } from '../utils/logger.js';
import { startMcpServer } from '../index.js';
import { openObserveProvider } from '../providers/index.js';

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
    console.log('  3. Execute Seq Live Test Query');
    console.log('  4. View Recent Process Logs (logs/mcp-process.log)');
    console.log('  5. OpenObserve Log Processing');
    console.log('  6. Launch MCP Server in Stdio Mode');
    console.log('  7. Exit');
    console.log('--------------------------------------------------------');

    const choice = (await prompt('\x1b[1mSelect an option (1-7): \x1b[0m')).trim();

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
          const statusIcon = p.configured ? '\x1b[32m[CONFIGURED]\x1b[0m' : '\x1b[33m[UNCONFIGURED]\x1b[0m';
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
        const queryInput = (await prompt('Query filter (e.g., Error or *): ')).trim();
        const limitInput = (await prompt('Max count (default: 10): ')).trim();
        const limit = parseInt(limitInput || '10', 10);

        console.log('\nFetching logs...');
        try {
          const startTime = Date.now();
          const results = await defaultLogHubService.queryLogs({
            provider: 'seq',
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
        try {
          const organizations = await openObserveProvider.listOrganizations();
          if (!organizations.length) {
            console.log('This account has no accessible organizations.');
            break;
          }
          console.log('\nOpenObserve Organizations:');
          organizations.forEach((org, index) => console.log(`  ${index + 1}. ${org.name} (${org.identifier})`));
          const orgChoice = Number((await prompt('Choose organization number: ')).trim());
          const organization = organizations[orgChoice - 1];
          if (!organization) throw new Error('Invalid organization selection');
          const streams = await openObserveProvider.listStreams(organization.identifier);
          if (!streams.length) {
            console.log('This organization has no accessible log streams.');
            break;
          }
          console.log('\nLog streams:');
          streams.forEach((stream, index) => console.log(`  ${index + 1}. ${stream}`));
          const streamChoice = Number((await prompt('Choose stream number: ')).trim());
          const stream = streams[streamChoice - 1];
          if (!stream) throw new Error('Invalid stream selection');
          const mode = (await prompt('Search by (1) RCID or (2) SQL? ')).trim();
          const from = (await prompt('From (default 15m): ')).trim() || '15m';
          const limitText = (await prompt('Maximum results (default 50): ')).trim();
          const limit = limitText ? Number(limitText) : 50;
          if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Limit must be 1-500');
          const common = { organization: organization.identifier, from, limit };
          const logs = mode === '1'
            ? await (async () => {
                const field = (await prompt('RCID field (default rcid): ')).trim() || 'rcid';
                const rcid = (await prompt('RCID: ')).trim();
                return openObserveProvider.findByRcid({ ...common, stream, field, rcid });
              })()
            : mode === '2'
              ? await openObserveProvider.searchLogs({ ...common, sql: (await prompt('SQL: ')).trim() })
              : (() => { throw new Error('Choose 1 or 2'); })();
          console.log(`\nFound ${logs.length} logs:`);
          for (const log of logs) console.log(`[${log.timestamp}] [${log.level}] ${log.message}`);
        } catch (err) {
          console.error(`OpenObserve error: ${(err as Error).message}`);
        }
        await prompt('\nPress Enter to return to menu...');
        break;
      }
      case '6': {
        rl.close();
        keepRunning = false;
        logger.setCliMode(false);
        await startMcpServer();
        return;
      }
      case '7': {
        console.log('\nExiting Log Hub CLI. Goodbye!\n');
        rl.close();
        keepRunning = false;
        process.exit(0);
        break;
      }
      default: {
        console.log('\x1b[31mInvalid selection. Please choose 1 to 7.\x1b[0m');
        await new Promise((r) => setTimeout(r, 1000));
        break;
      }
    }
  }
}
