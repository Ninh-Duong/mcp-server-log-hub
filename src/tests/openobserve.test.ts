import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { config } from '../config.js';
import { OpenObserveProvider } from '../providers/openobserve.js';
import { getProvider } from '../providers/index.js';
import { logger } from '../utils/logger.js';

const oldFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oldFetch; });

function setup(responses: unknown[]): { provider: OpenObserveProvider; calls: Array<{ url: string; init?: RequestInit }> } {
  config.openobserve.url = 'https://logs.example.test:10443';
  config.openobserve.email = 'reader@example.test';
  config.openobserve.token = 'test-token';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(responses[calls.length - 1]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { provider: new OpenObserveProvider(), calls };
}

test('lists only organizations returned for the configured account', async () => {
  const { provider, calls } = setup([{ data: [{ name: 'eagers_au', identifier: 'org-id' }] }]);
  assert.deepEqual(await provider.listOrganizations(), [{ name: 'eagers_au', identifier: 'org-id' }]);
  assert.equal(calls[0]?.url, 'https://logs.example.test:10443/api/organizations');
  assert.equal(new Headers(calls[0]?.init?.headers).get('authorization'), 'Basic ' + Buffer.from('reader@example.test:test-token').toString('base64'));
});

test('lists log streams for a selected organization', async () => {
  const { provider, calls } = setup([{ data: [{ name: 'eagers_au', identifier: 'org-id' }] }, { list: [{ name: 'wecrm_ape_prod', stream_type: 'logs' }] }]);
  assert.deepEqual(await provider.listStreams('org-id'), ['wecrm_ape_prod']);
  assert.equal(calls[1]?.url, 'https://logs.example.test:10443/api/org-id/streams?type=logs');
});

test('returns stream field names and types for agent SQL planning', async () => {
  const { provider, calls } = setup([
    { data: [{ name: 'eagers_au', identifier: 'org-id' }] },
    { list: [{ name: 'wecrm_ape_prod', stream_type: 'logs' }] },
    { name: 'wecrm_ape_prod', schema: [{ name: '_timestamp', type: 'Int64' }, { name: 'rcid', type: 'Utf8' }] },
  ]);
  assert.deepEqual(await provider.getStreamSchema('org-id', 'wecrm_ape_prod'), [
    { name: '_timestamp', type: 'Int64' }, { name: 'rcid', type: 'Utf8' },
  ]);
  assert.equal(calls[2]?.url, 'https://logs.example.test:10443/api/org-id/streams/wecrm_ape_prod/schema?type=logs');
});

test('writes redacted OpenObserve HTTP failure details to the process log', async () => {
  const { provider } = setup([]);
  globalThis.fetch = async () => new Response('Unauthorized Access', { status: 401 });
  await assert.rejects(provider.listOrganizations(), /HTTP 401/);
  const recent = logger.getRecentLogs(10).join('\n');
  assert.match(recent, /openobserve\.request_failed/);
  assert.match(recent, /401/);
  assert.doesNotMatch(recent, /test-token|Authorization|reader@example\.test/);
});

test('search sends bounded SQL and normalizes hits', async () => {
  const { provider, calls } = setup([{ data: [{ name: 'eagers_au', identifier: 'org-id' }] }, { hits: [{ _timestamp: 1790577000000000, level: 'error', message: 'broken', rcid: 'abc' }] }]);
  const logs = await provider.searchLogs({ organization: 'org-id', sql: 'SELECT * FROM "wecrm_ape_prod"', from: '2026-09-28T05:00:00Z', to: '2026-09-28T05:15:00Z', limit: 20 });
  assert.equal(logs[0]?.message, 'broken');
  assert.equal(logs[0]?.level, 'Error');
  assert.equal(logs[0]?.metadata?.rcid, 'abc');
  assert.equal(calls[1]?.url, 'https://logs.example.test:10443/api/org-id/_search');
  const body = JSON.parse(String(calls[1]?.init?.body));
  assert.deepEqual(body.query, { sql: 'SELECT * FROM "wecrm_ape_prod"', start_time: 1790571600000000, end_time: 1790572500000000, from: 0, size: 20 });
});

test('rejects non-SELECT OpenObserve queries before making a request', async () => {
  const { provider, calls } = setup([]);
  await assert.rejects(provider.searchLogs({ organization: 'org-id', sql: 'DELETE FROM "logs"' }), /Only a single SELECT query is allowed/);
  assert.equal(calls.length, 0);
});

test('RCID search quotes data and stream names', async () => {
  const { provider, calls } = setup([{ data: [{ name: 'eagers_au', identifier: 'org-id' }] }, { list: [{ name: 'log"one', stream_type: 'logs' }] }, { data: [{ name: 'eagers_au', identifier: 'org-id' }] }, { hits: [] }]);
  await provider.findByRcid({ organization: 'org-id', stream: 'log"one', field: 'rcid', rcid: "x' OR 1=1", from: '15m', limit: 10 });
  const body = JSON.parse(String(calls[3]?.init?.body));
  assert.equal(body.query.sql, `SELECT * FROM "log""one" WHERE "rcid" = 'x'' OR 1=1' ORDER BY _timestamp DESC`);
});

test('rejects an organization outside the account list', async () => {
  const { provider, calls } = setup([{ data: [{ name: 'allowed', identifier: 'good' }] }]);
  await assert.rejects(provider.listStreams('bad'), /not accessible/);
  assert.equal(calls.length, 1);
});

test('rejects an invalid end time instead of silently searching until now', async () => {
  const { provider, calls } = setup([{ data: [{ name: 'eagers_au', identifier: 'org-id' }] }]);
  await assert.rejects(provider.searchLogs({ organization: 'org-id', sql: 'SELECT * FROM "logs"', from: '15m', to: 'not-a-date' }), /Invalid time range/);
  assert.equal(calls.length, 1);
});

test('keeps the old observe provider name as an alias for OpenObserve', () => {
  assert.equal(getProvider('observe')?.name, 'openobserve');
});
