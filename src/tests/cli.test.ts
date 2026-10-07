import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
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

test('token paste shows masked feedback and never echoes the secret', async () => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    Object.defineProperty(process.stdin, 'isTTY', { value: true });
    const { config } = await import('./dist/config.js');
    config.openobserve = { url: '', email: '', token: '' };
    const { runCliMenu } = await import('./dist/cli/menu.js');
    await runCliMenu();
  `], { cwd: PROJECT_ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let step = 0;
  const encodedCredential = Buffer.from('fake-service@observe.invalid:fake-token-for-paste').toString('base64');
  const steps = [
    ['Choose 1-3:', '2\r'],
    ['Observe URL:', 'not-a-url\r'],
    ['Account email:', 'test@example.invalid\r'],
    ['Account token', `\x1b[200~${encodedCredential}\x1b[201~\r`],
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
  assert.match(output, /Invalid URL/); // Reached URL validation with a nonempty token; no credentials saved.
  assert.match(output, /Using Basic credential for fake-service@observe\.invalid/);
  assert.match(output, /\*{3,}/, 'Pasted input must give visible masked feedback');
  assert.doesNotMatch(output, /fake-token|token-for-paste|encodedCredential/);
});
