import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Calculate relative project root portably across environments
const currentDir = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(currentDir, '..');
export const LOGS_DIR = resolve(PROJECT_ROOT, process.env.LOG_DIR || 'logs');

/**
 * Lightweight stdlib .env parser (avoids external dotenv dependency)
 */
function loadEnvFile(): void {
  const envPath = resolve(PROJECT_ROOT, '.env');
  if (!existsSync(envPath)) return;

  try {
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // Ignore read errors silently
  }
}

// Load .env on initial import
loadEnvFile();

export const config = {
  server: {
    logLevel: process.env.LOG_LEVEL || 'info',
    logsDir: LOGS_DIR,
  },
  seq: {
    serverUrl: (process.env.SEQ_SERVER_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.SEQ_API_KEY || '',
  },
  observe: {
    customerId: process.env.OBSERVE_CUSTOMER_ID || '',
    token: process.env.OBSERVE_TOKEN || '',
    domain: process.env.OBSERVE_DOMAIN || 'observeinc.com',
  },
};
