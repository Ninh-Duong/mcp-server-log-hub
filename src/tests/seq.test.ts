import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { config } from '../config.js';
import { defaultLogHubService } from '../service.js';

const oldFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oldFetch; });

function setup(levels: string[]): string[] {
  config.seq.serverUrl = 'https://seq.example.test';
  config.seq.apiKey = 'test-key';
  const urls: string[] = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const events = levels.map((Level, i) => ({ Timestamp: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), Level, RenderedMessage: Level }));
    return new Response(JSON.stringify(events), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return urls;
}

test('a single level is a minimum severity and is pushed into the Seq filter', async () => {
  const urls = setup(['Information', 'Warning', 'Error', 'Fatal']);
  const logs = await defaultLogHubService.queryLogs({ provider: 'seq', query: "App = 'api'", level: 'Warning' });
  assert.deepEqual(logs.map((l) => l.level).sort(), ['Error', 'Fatal', 'Warning']);
  const filter = new URL(urls[0]!).searchParams.get('filter') || '';
  assert.match(filter, /^\(App = 'api'\) and @Level in \[.*'Warning'.*\] ci$/);
  assert.doesNotMatch(filter, /'Information'/);
});

test('an array of levels matches exactly those levels', async () => {
  setup(['Debug', 'Information', 'Error']);
  const logs = await defaultLogHubService.queryLogs({ provider: 'seq', level: ['Debug'] });
  assert.deepEqual(logs.map((l) => l.level), ['Debug']);
});

test('rejects an unparseable time bound before calling Seq', async () => {
  const urls = setup([]);
  await assert.rejects(defaultLogHubService.queryLogs({ provider: 'seq', from: 'garbage' }), /Invalid time range/);
  assert.equal(urls.length, 0);
});
