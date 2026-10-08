import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../config.js';

test('CLI starts by choosing Seq or Observe', async () => {
  const child = spawn(process.execPath, ['dist/index.js', '--cli'], { cwd: PROJECT_ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
  const timeout = setTimeout(() => child.kill(), 3000);
  child.stdin.write('3\n');
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
  clearTimeout(timeout);
  assert.equal(code, 0, output);
  assert.match(output, /1\. Seq/i);
  assert.match(output, /2\. Observe/i);
});

test('secret paste is masked and Observe without a saved env file fails to connect', async () => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    Object.defineProperty(process.stdin, 'isTTY', { value: true });
    const { config } = await import('./dist/config.js');
    config.seq = { serverUrl: '', apiKey: '' };
    const { runCliMenu } = await import('./dist/cli/menu.js');
    await runCliMenu();
  `], { cwd: PROJECT_ROOT, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CONFIG_DIR: mkdtempSync(join(tmpdir(), 'log-hub-')) } });
  let output = '';
  let step = 0;
  const steps = [
    ['Choose 1-3:', '1\r'],
    ['Seq URL:', 'not-a-url\r'],
    ['Seq API key', '\x1b[200~fake-key-for-paste\x1b[201~\r'],
    ['Press Enter to return', '\r'],
    ['Choose 1-3:', '2\r'],
    ['Choose environment', '3\r'],
    ['Press Enter to return', '\x1b[A\r'],
    ['Choose 1-3:', '3\r'],
  ];
  let pending = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk;
    pending += chunk;
    if (step < steps.length && pending.includes(steps[step][0])) {
      child.stdin.write(steps[step++][1]);
      pending = '';
    }
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
  const timeout = setTimeout(() => child.kill(), 5000);
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
  clearTimeout(timeout);
  assert.equal(code, 0, output);
  assert.match(output, /Invalid URL/); // Reached URL validation with a nonempty key; nothing saved.
  assert.match(output, /\*{3,}/, 'Pasted input must give visible masked feedback');
  assert.doesNotMatch(output, /fake-key|key-for-paste/);
  assert.match(output, /Connect failed: .*openobserve\.prod\.env is missing/);
  assert.doesNotMatch(output, /Use saved|Observe URL:|account token/i, 'Observe must not prompt for an account');
});
