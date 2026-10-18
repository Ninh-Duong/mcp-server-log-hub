import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { config } from '../config.js';
import { defaultLogsService } from '../service.js';
import { logger } from '../utils/logger.js';
import { ORG, json, useFakeAccount } from './helpers.js';

const oldFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oldFetch; });

/** Seq at seq.example.test and OpenObserve at logs.example.test, each returning two logs a minute apart. */
function bothProviders(openObserveStatus = 200): string[] {
  useFakeAccount();
  config.seq = { serverUrl: 'https://seq.example.test', apiKey: 'k' };
  const hosts: string[] = [];
  globalThis.fetch = async (url) => {
    const { host, pathname } = new URL(String(url));
    hosts.push(host);
    if (host === 'seq.example.test') return json([0, 2].map((m) => ({ Timestamp: `2026-01-01T00:0${m}:00Z`, Level: 'Error', RenderedMessage: `seq ${m}` })));
    if (pathname.endsWith('/organizations')) return json(ORG);
    if (openObserveStatus !== 200) return new Response('down', { status: openObserveStatus });
    return json({ hits: [1, 3].map((m) => ({ _timestamp: Date.parse(`2026-01-01T00:0${m}:00Z`) * 1000, level: 'error', message: `oo ${m}` })) });
  };
  return hosts;
}

test('broadcast merges every configured provider newest first and cuts to the limit', async () => {
  bothProviders();
  const logs = await defaultLogsService.queryLogs({ organization: 'org-id', stream: 's', from: '2026-01-01T00:00:00Z', to: '2026-01-01T01:00:00Z', limit: 3 });
  assert.deepEqual(logs.map((l) => l.message), ['oo 3', 'seq 2', 'oo 1']);
});

test('broadcast skips OpenObserve without an organization and a stream or SQL', async () => {
  const hosts = bothProviders();
  const logs = await defaultLogsService.queryLogs({ organization: 'org-id' });
  assert.deepEqual(logs.map((l) => l.provider), ['seq', 'seq']);
  assert.deepEqual([...new Set(hosts)], ['seq.example.test']);
});

test('a failing provider does not fail the broadcast', async () => {
  bothProviders(500);
  const logs = await defaultLogsService.queryLogs({ organization: 'org-id', stream: 's' });
  assert.deepEqual(logs.map((l) => l.message), ['seq 2', 'seq 0']);
});

test('no configured provider returns nothing; an unknown provider is an error', async () => {
  config.seq = { serverUrl: '', apiKey: '' };
  config.openobserve = { env: undefined, url: '', email: '', token: '' };
  assert.deepEqual(await defaultLogsService.queryLogs({ query: 'x' }), []);
  await assert.rejects(defaultLogsService.queryLogs({ provider: 'loki' }), /Unknown provider 'loki'. Available: seq, openobserve/);
});

test('a single provider gets its level filter applied after the query', async () => {
  bothProviders();
  const logs = await defaultLogsService.queryLogs({ provider: 'openobserve', organization: 'org-id', stream: 's', level: 'Fatal' });
  assert.deepEqual(logs, []);
});

test('lists provider status', () => {
  config.seq = { serverUrl: 'https://seq.example.test', apiKey: '' };
  const [seq] = defaultLogsService.listProviders();
  assert.deepEqual([seq!.configured, seq!.missingVariables], [false, ['SEQ_API_KEY']]);
});

test('never writes the organization identifier to the process log', async () => {
  bothProviders();
  const secret = 'org-id';
  await defaultLogsService.queryLogs({ provider: 'openobserve', organization: secret, stream: 's' });
  const lines = logger.getRecentLogs(50).filter((line) => line.includes('log_query_started'));
  assert.ok(lines.length);
  assert.ok(lines.every((line) => !line.includes(secret)), lines.join('\n'));
});
