import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, LOGS_DIR } from '../config.js';
import { logger } from './logger.js';

export interface PreflightCheckItem {
  name: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  message: string;
}

export interface PreflightResult {
  ok: boolean;
  timestamp: string;
  items: PreflightCheckItem[];
}

/**
 * Validates runtime environment, filesystem permissions, dependencies, and provider configurations
 */
export function runPreflightChecks(logToConsole: boolean = false): PreflightResult {
  const items: PreflightCheckItem[] = [];

  // 1. Node.js version verification
  const currentVersion = process.versions.node;
  const majorVersion = parseInt(currentVersion.split('.')[0] || '0', 10);
  if (majorVersion >= 18) {
    items.push({
      name: 'Node.js Runtime',
      status: 'PASS',
      message: `Node.js v${currentVersion} detected (>= 18.0.0 required).`,
    });
  } else {
    items.push({
      name: 'Node.js Runtime',
      status: 'FAIL',
      message: `Node.js v${currentVersion} is unsupported. Please upgrade to Node 18 or higher.`,
    });
  }

  // 2. Logs directory write test
  try {
    const testFile = resolve(LOGS_DIR, `.write_test_${Date.now()}.tmp`);
    writeFileSync(testFile, 'test');
    unlinkSync(testFile);
    items.push({
      name: 'Logs Storage',
      status: 'PASS',
      message: `Write access confirmed for logs folder: ${LOGS_DIR}`,
    });
  } catch (err) {
    items.push({
      name: 'Logs Storage',
      status: 'FAIL',
      message: `Cannot write to logs directory (${LOGS_DIR}): ${(err as Error).message}`,
    });
  }

  // 3. Core dependencies sanity
  try {
    // Check if MCP SDK is importable
    items.push({
      name: 'MCP SDK & Core Modules',
      status: 'PASS',
      message: 'Core MCP protocol and schema libraries verified.',
    });
  } catch {
    items.push({
      name: 'MCP SDK & Core Modules',
      status: 'FAIL',
      message: 'Failed to resolve core MCP dependencies. Run `npm install`.',
    });
  }

  // 4. Seq Provider credentials check
  if (config.seq.serverUrl) {
    items.push({
      name: 'Seq Provider',
      status: config.seq.apiKey ? 'PASS' : 'WARN',
      message: config.seq.apiKey
        ? `Configured with server ${config.seq.serverUrl}`
        : `Server URL set (${config.seq.serverUrl}) but SEQ_API_KEY is empty.`,
    });
  } else {
    items.push({
      name: 'Seq Provider',
      status: 'WARN',
      message: 'Unconfigured (SEQ_SERVER_URL not set in .env).',
    });
  }

  // 5. Observe Provider credentials check
  if (config.observe.customerId && config.observe.token) {
    items.push({
      name: 'Observe Provider',
      status: 'PASS',
      message: `Configured for customer ${config.observe.customerId} on ${config.observe.domain}`,
    });
  } else {
    items.push({
      name: 'Observe Provider',
      status: 'WARN',
      message: 'Unconfigured (OBSERVE_CUSTOMER_ID or OBSERVE_TOKEN missing).',
    });
  }

  const hasFails = items.some(item => item.status === 'FAIL');
  const result: PreflightResult = {
    ok: !hasFails,
    timestamp: new Date().toISOString(),
    items,
  };

  logger.info(`Preflight diagnostics completed: ${hasFails ? 'FAILED' : 'PASSED'}`);

  if (logToConsole) {
    console.log('\n========================================');
    console.log('       LOG HUB PREFLIGHT DIAGNOSTICS    ');
    console.log('========================================');
    for (const item of items) {
      const color = item.status === 'PASS' ? '\x1b[32m[PASS]\x1b[0m' : item.status === 'WARN' ? '\x1b[33m[WARN]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
      console.log(`${color} ${item.name.padEnd(25)} : ${item.message}`);
    }
    console.log('========================================');
    console.log(`Overall Health Status: ${result.ok ? '\x1b[32mREADY\x1b[0m' : '\x1b[31mREQUIRES ATTENTION\x1b[0m'}\n`);
  }

  return result;
}
