import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Calculate relative project root portably across environments
const currentDir = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(currentDir, '..');
export const LOGS_DIR = resolve(PROJECT_ROOT, process.env.LOG_DIR || 'logs');
export const CONFIG_DIR = resolve(PROJECT_ROOT, process.env.CONFIG_DIR || 'config');
export const AI_CONTEXT_DIR = resolve(PROJECT_ROOT, process.env.AI_CONTEXT_DIR || 'ai-context');

/** Each OpenObserve environment has its own account file: config/openobserve.<env>.env */
export const OPENOBSERVE_ENVS = ['dev', 'stg', 'prod'] as const;
export type OpenObserveEnv = (typeof OPENOBSERVE_ENVS)[number];
export const openObserveEnvFile = (env: OpenObserveEnv): string => resolve(CONFIG_DIR, `openobserve.${env}.env`);

/**
 * Automatically creates dev, stg, prod config env files if missing.
 */
export function ensureEnvFiles(): void {
  try {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });

    const ooExample = resolve(CONFIG_DIR, 'openobserve.env.example');
    const seqExample = resolve(CONFIG_DIR, 'seq.env.example');
    const rootExample = resolve(PROJECT_ROOT, '.env.example');

    const ooDefault = resolve(CONFIG_DIR, 'openobserve.env');
    if (!existsSync(ooDefault) && existsSync(ooExample)) {
      copyFileSync(ooExample, ooDefault);
    }

    const seqDefault = resolve(CONFIG_DIR, 'seq.env');
    if (!existsSync(seqDefault) && existsSync(seqExample)) {
      copyFileSync(seqExample, seqDefault);
    }

    const rootDefault = resolve(PROJECT_ROOT, '.env');
    if (!existsSync(rootDefault) && existsSync(rootExample)) {
      copyFileSync(rootExample, rootDefault);
    }

    for (const env of OPENOBSERVE_ENVS) {
      const ooEnv = openObserveEnvFile(env);
      if (!existsSync(ooEnv)) {
        if (env === 'dev' && existsSync(ooDefault)) {
          copyFileSync(ooDefault, ooEnv);
        } else if (existsSync(ooExample)) {
          copyFileSync(ooExample, ooEnv);
        }
      }

      const seqEnv = resolve(CONFIG_DIR, `seq.${env}.env`);
      if (!existsSync(seqEnv)) {
        if (existsSync(seqDefault)) {
          copyFileSync(seqDefault, seqEnv);
        } else if (existsSync(seqExample)) {
          copyFileSync(seqExample, seqEnv);
        }
      }

      const rootEnv = resolve(PROJECT_ROOT, `.env.${env}`);
      if (!existsSync(rootEnv) && existsSync(rootExample)) {
        copyFileSync(rootExample, rootEnv);
      }
    }
  } catch {
    // Silent fail to avoid disrupting startup
  }
}

/**
 * Lightweight stdlib .env parser (avoids external dotenv dependency)
 */
function readEnvFile(envPath: string): Record<string, string> {
  const values: Record<string, string> = {};
  if (!existsSync(envPath)) return values;

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
      values[key] = val;
    }
  } catch {
    // Ignore read errors silently
  }
  return values;
}

function loadEnvFile(envPath: string): void {
  for (const [key, val] of Object.entries(readEnvFile(envPath))) {
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

// Automatically create missing env files before loading
ensureEnvFiles();

// Load .env on initial import
loadEnvFile(resolve(CONFIG_DIR, 'seq.env'));
loadEnvFile(resolve(CONFIG_DIR, 'openobserve.env'));
loadEnvFile(resolve(PROJECT_ROOT, '.env'));

/** Accepts a raw token or a pasted Basic credential (base64 "email:password", optionally prefixed "Basic "). */
export function splitBasicCredential(email: string, token: string): { email: string; token: string } {
  const encoded = token.replace(/^(?:authorization:\s*)?basic\s+/i, '');
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator > 0 && Buffer.from(decoded).toString('base64') === encoded && /^[^\s:@]+@[^\s:@]+\.[^\s:@]+$/.test(decoded.slice(0, separator))) {
    return { email: decoded.slice(0, separator), token: decoded.slice(separator + 1) };
  }
  return { email, token };
}

const openObserveAccount = (url: string | undefined, email: string | undefined, token: string | undefined) => ({
  url: (url || '').replace(/\/+$/, ''),
  ...splitBasicCredential(email || '', token || ''),
});

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
    /** Selected environment, or undefined when using OPENOBSERVE_* variables / config/openobserve.env directly */
    env: undefined as OpenObserveEnv | undefined,
    ...openObserveAccount(process.env.OPENOBSERVE_URL, process.env.OPENOBSERVE_EMAIL, process.env.OPENOBSERVE_TOKEN),
  },
};

/** Switches the active OpenObserve account to the one saved for `env`. */
export function useOpenObserveEnv(env: string): void {
  const key = env.toLowerCase() as OpenObserveEnv;
  if (!OPENOBSERVE_ENVS.includes(key)) throw new Error(`Unknown OpenObserve environment '${env}'. Use ${OPENOBSERVE_ENVS.join(', ')}`);
  const saved = readEnvFile(openObserveEnvFile(key));
  config.openobserve = { env: key, ...openObserveAccount(saved.OPENOBSERVE_URL, saved.OPENOBSERVE_EMAIL, saved.OPENOBSERVE_TOKEN) };
}

// MCP mode picks its environment at startup, e.g. "env": { "OPENOBSERVE_ENV": "dev" } in the MCP client config.
const requestedEnv = (process.env.OPENOBSERVE_ENV || process.env.APP_ENV || process.env.NODE_ENV || '').toLowerCase() as OpenObserveEnv;
if (OPENOBSERVE_ENVS.includes(requestedEnv)) {
  useOpenObserveEnv(requestedEnv);
} else if (!config.openobserve.url && existsSync(openObserveEnvFile('dev'))) {
  const devAccount = readEnvFile(openObserveEnvFile('dev'));
  if (devAccount.OPENOBSERVE_URL) {
    useOpenObserveEnv('dev');
  }
}

const activeEnv = config.openobserve.env || (OPENOBSERVE_ENVS.includes(requestedEnv) ? requestedEnv : undefined);
if (activeEnv) {
  const seqEnvFile = resolve(CONFIG_DIR, `seq.${activeEnv}.env`);
  if (existsSync(seqEnvFile)) {
    const seqSaved = readEnvFile(seqEnvFile);
    if (seqSaved.SEQ_SERVER_URL) config.seq.serverUrl = seqSaved.SEQ_SERVER_URL.replace(/\/+$/, '');
    if (seqSaved.SEQ_API_KEY) config.seq.apiKey = seqSaved.SEQ_API_KEY;
  }
}

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
