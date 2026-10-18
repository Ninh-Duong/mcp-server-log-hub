import { writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, LOGS_DIR, OPENOBSERVE_ENVS, OpenObserveEnv, openObserveAccountFor } from '../config.js';
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

const MIN_NODE_MAJOR = 22;

/**
 * Validates runtime environment, filesystem permissions, and provider configurations
 */
export function runPreflightChecks(logToConsole: boolean = false): PreflightResult {
  const items = [checkNode(), checkLogsFolder(), checkSeq(), checkOpenObserve(), ...OPENOBSERVE_ENVS.map(checkOpenObserveEnv)];
  const result: PreflightResult = { ok: !items.some((item) => item.status === 'FAIL'), timestamp: new Date().toISOString(), items };
  logger.info(`Preflight diagnostics completed: ${result.ok ? 'PASSED' : 'FAILED'}`);
  if (logToConsole) printReport(result);
  return result;
}

function checkNode(): PreflightCheckItem {
  const version = process.versions.node;
  return Number(version.split('.')[0]) >= MIN_NODE_MAJOR
    ? { name: 'Node.js Runtime', status: 'PASS', message: `Node.js v${version} detected (>= ${MIN_NODE_MAJOR} required).` }
    : { name: 'Node.js Runtime', status: 'FAIL', message: `Node.js v${version} is unsupported. Please upgrade to Node ${MIN_NODE_MAJOR} or higher.` };
}

function checkLogsFolder(): PreflightCheckItem {
  try {
    const testFile = resolve(LOGS_DIR, `.write_test_${Date.now()}.tmp`);
    writeFileSync(testFile, 'test');
    unlinkSync(testFile);
    return { name: 'Logs Storage', status: 'PASS', message: `Write access confirmed for logs folder: ${LOGS_DIR}` };
  } catch (err) {
    return { name: 'Logs Storage', status: 'FAIL', message: `Cannot write to logs directory (${LOGS_DIR}): ${(err as Error).message}` };
  }
}

function checkSeq(): PreflightCheckItem {
  const { serverUrl, apiKey } = config.seq;
  if (!serverUrl) return { name: 'Seq Provider', status: 'WARN', message: 'Unconfigured (SEQ_SERVER_URL not set in config/seq.env).' };
  return apiKey
    ? { name: 'Seq Provider', status: 'PASS', message: `Configured with server ${serverUrl}` }
    : { name: 'Seq Provider', status: 'WARN', message: `Server URL set (${serverUrl}) but SEQ_API_KEY is empty.` };
}

function checkOpenObserve(): PreflightCheckItem {
  const { url, email, token, env } = config.openobserve;
  if (url && email && token) {
    return { name: 'OpenObserve Provider', status: 'PASS', message: `Credentials configured for ${url}${env ? ` [${env.toUpperCase()}]` : ''} (connection not verified)` };
  }
  return {
    name: 'OpenObserve Provider', status: 'WARN',
    message: `Unconfigured${env ? ` for ${env.toUpperCase()}` : ''} (OPENOBSERVE_URL, OPENOBSERVE_EMAIL or OPENOBSERVE_TOKEN missing; set OPENOBSERVE_ENV=dev|stg|prod to pick config/openobserve.<env>.env).`,
  };
}

/** One server serves every environment (tools take env), so each config/openobserve.<env>.env is reported. */
function checkOpenObserveEnv(env: OpenObserveEnv): PreflightCheckItem {
  const { url, email, token } = openObserveAccountFor(env);
  const name = `OpenObserve ${env.toUpperCase()}`;
  return url && email && token
    ? { name, status: 'PASS', message: `env '${env}' available: ${url} (connection not verified)` }
    : { name, status: 'WARN', message: `env '${env}' unavailable: fill in config/openobserve.${env}.env` };
}

function printReport(result: PreflightResult): void {
  const badge = { PASS: '\x1b[32m[PASS]\x1b[0m', WARN: '\x1b[33m[WARN]\x1b[0m', FAIL: '\x1b[31m[FAIL]\x1b[0m' };
  console.log('\n========================================');
  console.log('  MCP-SERVER-LOGS PREFLIGHT DIAGNOSTICS');
  console.log('========================================');
  for (const item of result.items) console.log(`${badge[item.status]} ${item.name.padEnd(25)} : ${item.message}`);
  console.log('========================================');
  console.log(`Overall Health Status: ${result.ok ? '\x1b[32mREADY\x1b[0m' : '\x1b[31mREQUIRES ATTENTION\x1b[0m'}\n`);
}
