import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Calculate relative project root portably across environments
const currentDir = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(currentDir, '..');
export const LOGS_DIR = resolve(PROJECT_ROOT, process.env.LOG_DIR || 'logs');

/**
 * Lightweight stdlib .env parser (avoids external dotenv dependency)
 */
function loadEnvFile(file: string): void {
  const envPath = resolve(PROJECT_ROOT, file);
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
loadEnvFile('config/seq.env');
loadEnvFile('config/openobserve.env');
loadEnvFile('.env');

export const config = {
  server: {
    logLevel: process.env.LOG_LEVEL || 'info',
    logsDir: LOGS_DIR,
  },
  seq: {
    serverUrl: (process.env.SEQ_SERVER_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.SEQ_API_KEY || '',
  },
  openobserve: {
    url: (process.env.OPENOBSERVE_URL || '').replace(/\/+$/, ''),
    email: process.env.OPENOBSERVE_EMAIL || '',
    token: process.env.OPENOBSERVE_TOKEN || '',
  },
};

/** Save CLI account settings without putting credentials in tracked files. */
export function writePrivateEnvFile(file: string, entries: Record<string, string>): void {
  for (const [key, value] of Object.entries(entries)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error('Invalid account setting name');
    if (/[\r\n]/.test(value)) throw new Error('Account values cannot contain a newline');
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Object.entries(entries).map(([key, value]) => `${key}=${value}\n`).join(''), { encoding: 'utf8', mode: 0o600 });
  chmodSync(file, 0o600);
}
