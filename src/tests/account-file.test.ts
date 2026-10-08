import assert from 'node:assert/strict';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { splitBasicCredential, writePrivateEnvFile } from '../config.js';

test('writes provider credentials to a private env file without changing values', () => {
  const file = join(tmpdir(), `log-hub-${randomUUID()}.env`);
  try {
    writePrivateEnvFile(file, { OPENOBSERVE_EMAIL: 'reader@example.test', OPENOBSERVE_TOKEN: 'abc=def' });
    assert.equal(readFileSync(file, 'utf8'), 'OPENOBSERVE_EMAIL=reader@example.test\nOPENOBSERVE_TOKEN=abc=def\n');
  } finally {
    try { unlinkSync(file); } catch { /* file was not created */ }
  }
});

test('rejects newlines in account values', () => {
  const file = join(tmpdir(), `log-hub-${randomUUID()}.env`);
  assert.throws(() => writePrivateEnvFile(file, { OPENOBSERVE_TOKEN: 'first\nOTHER=leak' }), /newline/);
});

test('splits a pasted Basic credential and leaves raw tokens alone', () => {
  const basic = Buffer.from('svc@sa.internal:p4ss:word').toString('base64');
  assert.deepEqual(splitBasicCredential('me@example.test', basic), { email: 'svc@sa.internal', token: 'p4ss:word' });
  assert.deepEqual(splitBasicCredential('me@example.test', `Basic ${basic}`), { email: 'svc@sa.internal', token: 'p4ss:word' });
  assert.deepEqual(splitBasicCredential('me@example.test', 'raw-token'), { email: 'me@example.test', token: 'raw-token' });
});
