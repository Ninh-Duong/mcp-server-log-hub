import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { dropExported, messageTemplate, pickFlowIds, writeAiContextSnapshot } from '../ai-context.js';
import { LogEntry } from '../types.js';

const entry = (timestamp: string, level: string, service: string, message: string, metadata: Record<string, unknown> = {}): LogEntry =>
  ({ timestamp, level, service, message, provider: 'openobserve', metadata });

test('groups messages that differ only by ids, numbers and timestamps', () => {
  assert.equal(messageTemplate("The 'bool' property 'SiteActive' on entity type 'EntityStagingCDS'"), "The '<s>' property '<s>' on entity type '<s>'");
  assert.equal(messageTemplate('Order 123 failed for 3439df6a-64db-4aa6-97db-2e151e565ee2 at 2026-10-07T09:00:01Z'), 'Order <n> failed for <uuid> at <ts>');
  assert.equal(messageTemplate('[NestWinston] 1      10/7/2026, 7:00:00 PM WARN [Guard] token deadbeef12 bad\nstack line'), '[NestWinston] <n> <ts> WARN [Guard] token <hex> bad');
});

test('writes a summary-first snapshot an AI agent can navigate', () => {
  const base = mkdtempSync(join(tmpdir(), 'ai-context-'));
  const meta = { provider: 'openobserve', env: 'dev', organization: 'ssdev_au', stream: 'wecrm', service: 'CRM/Api', levels: ['Error' as const, 'Warning' as const], from: '2026-10-07T09:00:00.000Z', to: '2026-10-07T10:00:00.000Z', limit: 3 };
  const logs = [
    entry('2026-10-07T09:03:00Z', 'Error', 'CRM/Api', 'Order 3 failed', { correlationId: 'c3', empty: '', nothing: null, tenant: 't1' }),
    entry('2026-10-07T09:01:00Z', 'Error', 'CRM/Api', 'Order 1 failed', { correlationId: 'c1' }),
    entry('2026-10-07T09:02:00Z', 'Warning', 'CRM/Api', 'Slow query 250ms'),
  ];
  const first = writeAiContextSnapshot(logs, meta, { baseDir: base });
  const second = writeAiContextSnapshot(logs.slice(0, 1), meta, { baseDir: base });

  assert.equal(first.rows, 3);
  assert.equal(first.truncated, true, 'rows reached the limit');
  for (const file of ['SUMMARY.md', 'manifest.json', 'patterns.json', 'logs/CRM_Api/error.jsonl', 'logs/CRM_Api/warning.jsonl']) {
    assert.ok(existsSync(join(first.dir, file)), file);
  }
  const errors = readFileSync(join(first.dir, 'logs/CRM_Api/error.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(errors.map((e) => e.ids.correlationId), ['c1', 'c3'], 'oldest first, ids lifted');
  assert.deepEqual(errors[1].attrs, { tenant: 't1' }, 'empty fields dropped');

  const patterns = JSON.parse(readFileSync(join(first.dir, 'patterns.json'), 'utf8'));
  assert.deepEqual(patterns.map((p: { level: string; count: number; template: string; example: string }) => [p.level, p.count, p.template, p.example]), [
    ['Error', 2, 'Order <n> failed', 'logs/CRM_Api/error.jsonl:1'],
    ['Warning', 1, 'Slow query <n>ms', 'logs/CRM_Api/warning.jsonl:1'],
  ]);
  const summary = readFileSync(first.summaryPath, 'utf8');
  assert.match(summary, /TRUNCATED/);
  assert.match(summary, /\| CRM\/Api \| 2 \| 1 \| 3 \|/);

  const index = readFileSync(join(base, 'INDEX.md'), 'utf8').split('\n').filter((line) => line.startsWith('- '));
  assert.equal(index.length, 2);
  assert.ok(index[0]!.includes('1 rows'), 'newest snapshot listed first');
  assert.notEqual(first.dir, second.dir);
});

test('picks every distinct error correlation id, rcid before trace_id, one flow per id value', () => {
  const logs = [
    ...[1, 2, 3, 4].map((i) => entry(`2026-10-07T09:0${i}:00Z`, 'Error', 'Api', `Order ${i} failed`, { rcid: `r${i}`, trace_id: `t${i}` })),
    entry('2026-10-07T09:05:00Z', 'Error', 'Api', 'Timeout calling DMS', { trace_id: 'tx' }),
    entry('2026-10-07T09:06:00Z', 'Error', 'Api', 'No id here'),
    entry('2026-10-07T09:08:00Z', 'Error', 'Worker', 'Same request, other sink', { trace_id: 'r4' }),
    entry('2026-10-07T09:07:00Z', 'Information', 'Api', 'ok', { rcid: 'info-only' }),
  ];
  assert.deepEqual(pickFlowIds(logs), [
    { field: 'rcid', value: 'r4' }, { field: 'rcid', value: 'r3' }, { field: 'rcid', value: 'r2' }, { field: 'rcid', value: 'r1' },
    { field: 'trace_id', value: 'tx' },
  ], 'trace_id r4 is the same request as rcid r4');
  assert.equal(pickFlowIds(logs, 3, 30).length, 4, 'per-pattern and total caps still apply');
});

test('writes request flows and groups them by bug in SUMMARY.md', () => {
  const base = mkdtempSync(join(tmpdir(), 'ai-context-'));
  const failing = entry('2026-10-07T09:00:02Z', 'Error', 'CRM.Gateway', 'Request failed', { rcid: 'r1' });
  const flow = { field: 'rcid', value: 'r1', entries: [
    failing,
    entry('2026-10-07T09:00:00Z', 'Information', 'CRM.Gateway', 'POST /customers', { rcid: 'r1' }),
    entry('2026-10-07T09:00:01Z', 'Error', 'CRM.Customer.Api', 'Save failed for 42', { rcid: 'r1' }),
  ] };
  const meta = { provider: 'openobserve', organization: 'o', stream: 's', from: '2026-10-07T09:00:00Z', to: '2026-10-07T10:00:00Z', limit: 100 };
  const { dir, summaryPath } = writeAiContextSnapshot([failing], meta, { baseDir: base, flows: [flow] });
  const lines = readFileSync(join(dir, 'flows/rcid-r1.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((l) => l.service), ['CRM.Gateway', 'CRM.Customer.Api', 'CRM.Gateway'], 'oldest first across services');
  // Bug #1 is the gateway error the export found; the flow shows the real break happened upstream in Customer.Api.
  assert.match(readFileSync(summaryPath, 'utf8'), /\| 1 \| 1 \| CRM\.Gateway \| `Request failed` \| 1 \| CRM\.Customer\.Api: Save failed for <n> \| flows\/rcid-r1\.jsonl \|/);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.flows[0].pattern, 1);
});

test('trims very long flows around the first error', () => {
  const base = mkdtempSync(join(tmpdir(), 'ai-context-'));
  const ts = (i: number) => new Date(Date.UTC(2026, 9, 7, 9) + i * 1000).toISOString();
  const entries = Array.from({ length: 1000 }, (_, i) => entry(ts(i), i === 700 ? 'Error' : 'Information', 'Job', `step ${i}`, { rcid: 'run' }));
  const meta = { provider: 'openobserve', organization: 'o', stream: 's', from: ts(0), to: ts(1000), limit: 100 };
  const { dir, summaryPath } = writeAiContextSnapshot([entries[700]!], meta, { baseDir: base, flows: [{ field: 'rcid', value: 'run', entries }] });
  const lines = readFileSync(join(dir, 'flows/rcid-run.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, 500);
  assert.equal(lines[400].message, 'step 700', 'first error keeps 400 lines of lead-up');
  assert.match(readFileSync(summaryPath, 'utf8'), /500 of 1000 \(trimmed around first error\)/);
});

test('drops logs already saved by an overlapping snapshot of the same stream and reports them', () => {
  const base = mkdtempSync(join(tmpdir(), 'ai-context-'));
  const hour = (h: number) => `2026-10-07T${String(h).padStart(2, '0')}:00:00.000Z`;
  const logs = (hours: number[]) => hours.map((h) => entry(hour(h), 'Error', 'Api', `Order ${h} failed`, { rcid: `r${h}` }));
  const meta = (from: number, to: number, service?: string) => ({ provider: 'openobserve', env: 'dev', organization: 'org', stream: 'wecrm', service, from: hour(from), to: hour(to), limit: 100 });
  writeAiContextSnapshot(logs([14, 15, 16, 17]), meta(14, 18), { baseDir: base });

  const overlap = dropExported(logs([16, 17, 18, 19]), meta(16, 20, 'Api'), base);
  assert.equal(overlap.duplicates, 2, 'any service/level of the stream counts');
  assert.deepEqual(overlap.fresh.map((e) => e.timestamp), [hour(18), hour(19)]);
  assert.equal(overlap.seenIn.length, 1);

  assert.equal(dropExported(logs([20, 21]), meta(20, 22), base).duplicates, 0, 'non-overlapping snapshots are not read');

  const second = writeAiContextSnapshot(overlap.fresh, { ...meta(16, 20), duplicates: overlap.duplicates }, { baseDir: base });
  assert.match(readFileSync(second.summaryPath, 'utf8'), /\| Duplicates skipped \| 2 /);
  assert.match(readFileSync(join(base, 'INDEX.md'), 'utf8'), /2 rows · 2 dup/);
});
