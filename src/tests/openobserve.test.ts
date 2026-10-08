import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { config } from '../config.js';
import { OpenObserveProvider, levelFromText } from '../providers/openobserve.js';
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
  const { provider, calls } = setup([{ data: [{ name: 'eagers_au', identifier: 'org-id' }] }, { list: [{ name: 'log"one', stream_type: 'logs' }] }, { hits: [] }]);
  await provider.findByRcid({ organization: 'org-id', stream: 'log"one', field: 'rcid', rcid: "x' OR 1=1", from: '15m', limit: 10 });
  const body = JSON.parse(String(calls[2]?.init?.body));
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

test('reuses the organization list across calls within the cache window', async () => {
  const { provider, calls } = setup([{ data: [{ name: 'eagers_au', identifier: 'org-id' }] }, { list: [{ name: 's1' }] }, { list: [{ name: 's1' }] }]);
  await provider.listStreams('org-id');
  await provider.listStreams('org-id');
  assert.equal(calls.filter((c) => c.url.endsWith('/api/organizations')).length, 1);
});

test('keeps the old observe provider name as an alias for OpenObserve', () => {
  assert.equal(getProvider('observe')?.name, 'openobserve');
});

const org = { data: [{ name: 'eagers_au', identifier: 'org-id' }] };
const k8sSchema = { schema: ['_timestamp', 'kubernetes_host', 'kubernetes_namespace_name', 'kubernetes_pod_name', 'log'].map((name) => ({ name, type: 'Utf8' })) };

test('lists structured services with per-level counts', async () => {
  const { provider, calls } = setup([org, { list: [{ name: 'crm' }] }, { schema: [{ name: 'service_name', type: 'Utf8' }, { name: 'severity', type: 'Utf8' }] }, { hits: [
    { service: 'CRM.Gateway', lvl: 'Information', n: 90 }, { service: 'CRM.Gateway', lvl: 'Error', n: 7 },
    { service: 'CRM.Gateway', lvl: 'Critical', n: 1 }, { service: 'CRM.Report', lvl: 'Warning', n: 200 },
  ] }]);
  const result = await provider.listServices({ organization: 'org-id', stream: 'crm', from: '1h' });
  assert.equal(result.field, 'service_name');
  assert.deepEqual(result.services, [
    { name: 'CRM.Report', count: 200, levels: { Warning: 200 } },
    { name: 'CRM.Gateway', count: 98, levels: { Information: 90, Error: 7, Fatal: 1 } },
  ]);
  assert.match(JSON.parse(String(calls[3]?.init?.body)).query.sql, /GROUP BY "service_name", "severity"/);
});

test('groups Kubernetes pods into deployments', async () => {
  const { provider } = setup([org, { list: [{ name: 'k8s' }] }, k8sSchema, { hits: [
    { service: 'easyserv-bmw-api-5c67fbd785-lcm4v', n: 300 }, { service: 'easyserv-bmw-api-6fc69d88bc-grj24', n: 7 }, { service: 'easyserv-bmw-system-598fbd4ccd-rdskk', n: 59 },
  ] }]);
  const { services } = await provider.listServices({ organization: 'org-id', stream: 'k8s' });
  assert.deepEqual(services.map((s) => [s.name, s.count]), [['easyserv-bmw-api', 307], ['easyserv-bmw-system', 59]]);
});

test('structured service search escapes the service and expands level aliases', async () => {
  const { provider, calls } = setup([org, { list: [{ name: 'crm' }] }, { schema: [{ name: 'service_name', type: 'Utf8' }, { name: 'severity', type: 'Utf8' }] }, { hits: [] }]);
  await provider.searchServiceLogs({ organization: 'org-id', stream: 'crm', service: "x' OR 1=1", levels: ['Error', 'Fatal'], from: '1h' });
  const sql = JSON.parse(String(calls[3]?.init?.body)).query.sql;
  assert.match(sql, /"service_name" = 'x'' OR 1=1'/);
  assert.match(sql, /"severity" IN \('Error', 'error', 'ERR', 'err', 'Fatal', 'fatal', 'Critical', 'critical'/);
});

test('Kubernetes service search takes level and service from pod name and log text', async () => {
  const { provider } = setup([org, { list: [{ name: 'k8s' }] }, k8sSchema, { hits: [
    { _timestamp: 1, kubernetes_pod_name: 'api-5c67fbd785-lcm4v', log: '[NestWinston] 1  10/7/2026 \x1b[33mWARN\x1b[39M [Guard] disabled\n' },
    { _timestamp: 2, kubernetes_pod_name: 'api-5c67fbd785-lcm4v', log: '[NestWinston] 1  10/7/2026 \x1b[32MINFO\x1b[39M [Job] warning count: 0\n' },
    { _timestamp: 3, kubernetes_pod_name: 'api-v2-5c67fbd785-lcm4v', log: '[NestWinston] \x1b[31merror\x1b[39m boom' },
  ] }]);
  const logs = await provider.searchServiceLogs({ organization: 'org-id', stream: 'k8s', service: 'api', levels: ['Warning'], from: '1h' });
  assert.deepEqual(logs.map((l) => [l.service, l.level, l.message]), [['api', 'Warning', '[NestWinston] 1  10/7/2026 WARN [Guard] disabled']]);
});

test('reads levels from colored log text', () => {
  assert.equal(levelFromText('[NestWinston] 1  10/7/2026, 7:00:00 PM \x1b[32MINFO\x1b[39M [Mail] sent'), 'Information');
  assert.equal(levelFromText('[NestWinston] \x1b[33m\x1b[36mverbose\x1b[33m\x1b[39m\t10/7/2026'), 'Verbose');
  assert.equal(levelFromText('plain line without level'), 'Information');
});

test('search pages 500 rows at a time until the data runs out', async () => {
  const page = (n: number) => ({ hits: Array.from({ length: n }, (_, i) => ({ _timestamp: i, message: `m${i}` })) });
  const { provider, calls } = setup([org, page(500), page(120)]);
  const logs = await provider.searchLogs({ organization: 'org-id', sql: 'SELECT * FROM "s"', from: '1h', limit: 9999 });
  assert.equal(logs.length, 620);
  const bodies = calls.slice(1).map((c) => JSON.parse(String(c.init?.body)).query);
  assert.deepEqual(bodies.map((q) => [q.from, q.size]), [[0, 500], [500, 500]]);
});

test('search stops paging at the requested limit', async () => {
  const page = (n: number) => ({ hits: Array.from({ length: n }, (_, i) => ({ _timestamp: i, message: 'm' })) });
  const { provider, calls } = setup([org, page(500), page(200)]);
  const logs = await provider.searchLogs({ organization: 'org-id', sql: 'SELECT * FROM "s"', from: '1h', limit: 700 });
  assert.equal(logs.length, 700);
  assert.deepEqual(JSON.parse(String(calls[2]?.init?.body)).query.size, 200);
});

test('fetches request flows with one batched IN query on every id field and drops empty flows', async () => {
  const schema = { schema: [{ name: 'rcid', type: 'Utf8' }, { name: 'trace_id', type: 'Utf8' }] };
  const { provider, calls } = setup([org, { list: [{ name: 's' }] }, schema, { hits: [
    { _timestamp: 2, rcid: 'r1', message: 'b' }, { _timestamp: 1, rcid: 'r1', message: 'a' }, { _timestamp: 3, trace_id: "t'2", message: 'c' },
  ] }]);
  const flows = await provider.fetchFlows({ organization: 'org-id', stream: 's', from: '2026-10-07T09:00:00Z', to: '2026-10-07T10:00:00Z',
    ids: [{ field: 'rcid', value: 'r1' }, { field: 'trace_id', value: "t'2" }, { field: 'missing_field', value: 'x' }] });
  assert.deepEqual(flows.map((f) => [f.field, f.value, f.entries.length]), [['rcid', 'r1', 2], ['trace_id', "t'2", 1]]);
  const query = JSON.parse(String(calls[3]?.init?.body)).query;
  assert.equal(query.sql, `SELECT * FROM "s" WHERE "rcid" IN ('r1', 't''2', 'x') OR "trace_id" IN ('r1', 't''2', 'x') ORDER BY _timestamp DESC`);
  assert.equal(query.start_time, Date.parse('2026-10-07T08:45:00Z') * 1000, 'window padded by 15 minutes');
});
