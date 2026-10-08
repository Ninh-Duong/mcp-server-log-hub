#!/usr/bin/env node
// Launcher: ensures Node version, dependencies, and a fresh build before running dist/index.js.
// Stdlib only (runs before node_modules exists). Never writes to stdout: in MCP mode stdout is JSON-RPC.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const at = (...p) => join(root, ...p);
const mtime = (p) => (existsSync(p) ? statSync(p).mtimeMs : 0);
const fail = (msg) => { process.stderr.write(`[start] ${msg}\n`); process.exit(1); };

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 18 || (major === 18 && minor < 17)) fail(`Node ${process.versions.node} is too old; install Node 18.17 or newer.`);

const npm = (...args) => {
  process.stderr.write(`[start] npm ${args.join(' ')}\n`);
  const r = spawnSync('npm', args, { cwd: root, stdio: ['ignore', 2, 2], shell: process.platform === 'win32' });
  if (r.status !== 0) fail(`'npm ${args.join(' ')}' failed. Fix the error above, then run again.`);
};

// Reinstall when node_modules is missing or older than the lockfile (e.g. after git pull).
const installed = at('node_modules', '.package-lock.json');
if (!existsSync(installed) || mtime(at('package-lock.json')) > mtime(installed)) {
  npm(existsSync(at('package-lock.json')) ? 'ci' : 'install', '--include=dev');
}

// Rebuild when dist is missing or any source file is newer (skipped in packaged installs without src/).
const entry = at('dist', 'index.js');
if (existsSync(at('src'))) {
  const built = mtime(entry);
  const stale = !built || [at('tsconfig.json'), ...readdirSync(at('src'), { recursive: true }).map((f) => at('src', f))]
    .some((f) => mtime(f) > built);
  if (stale) npm('run', 'build');
}
if (!existsSync(entry)) fail('dist/index.js not found; run `npm run build`.');

const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], { stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
