import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { AI_CONTEXT_DIR } from './config.js';
import { LOG_LEVELS, LogEntry, LogLevel, RequestFlow } from './types.js';
import { FLOW_ID_FIELDS } from './providers/base.js';

/**
 * Writes fetched logs as an AI-friendly snapshot: summary first, details on demand.
 *   ai-context/INDEX.md                                    one line per snapshot, newest first
 *   ai-context/<provider>/<env>/<org>/<stream>/<stamp>_<service>_<levels>/
 *     SUMMARY.md     counts + top patterns with file:line pointers (read first)
 *     manifest.json  query parameters
 *     patterns.json  repeated messages grouped by template
 *     logs/<service>/<level>.jsonl  one compact log per line, oldest first
 */
export interface SnapshotMeta {
  provider: string;
  env?: string;
  organization: string;
  stream: string;
  service?: string;
  levels?: LogLevel[];
  /** Resolved ISO 8601 bounds */
  from: string;
  to: string;
  limit: number;
  sql?: string;
  /** Extra caveat shown in SUMMARY.md */
  note?: string;
}

export interface SnapshotResult { dir: string; summaryPath: string; rows: number; truncated: boolean }

interface Pattern {
  template: string; level: string; service: string; count: number;
  firstSeen: string; lastSeen: string; example: string;
}

const INDEX_HEADER = '# ai-context index\n\nNewest first. Open a snapshot\'s SUMMARY.md first; it points to the exact log lines worth reading.\n\n';
const ID_KEY = /rcid|correlation|trace_?id|span_?id|request_?id/i;
const DROP_KEYS = new Set(['_timestamp', 'message', 'body', 'log', 'msg', 'level', 'severity']);
const SEVERITY = [...LOG_LEVELS].reverse();
/** Flows longer than FLOW_MAX_LINES keep FLOW_BEFORE lines before the first error and FLOW_AFTER from it. */
const FLOW_MAX_LINES = 500;
const FLOW_BEFORE = 400;
const FLOW_AFTER = 100;

const safe = (value: string) => value.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '_').slice(0, 80) || '_';
const md = (value: string) => value.replace(/\|/g, '\\|').replace(/`/g, "'");
const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/** First line of a message with ids, timestamps and numbers replaced, so repeats group together. */
export function messageTemplate(message: string): string {
  return (message.split('\n').find((line) => line.trim()) ?? '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g, '<ts>')
    .replace(/\d{1,2}\/\d{1,2}\/\d{4},? \d{1,2}:\d{2}(:\d{2})?( [AP]M)?/g, '<ts>')
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/'[^'\n]{1,80}'/g, "'<s>'")
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** One compact JSONL record: empty and duplicated fields dropped, correlation ids lifted into `ids`. */
function compact(entry: LogEntry): Record<string, unknown> {
  const ids: Record<string, unknown> = {};
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry.metadata ?? {})) {
    if (value === null || value === undefined || value === '' || DROP_KEYS.has(key) || value === entry.service) continue;
    (ID_KEY.test(key) ? ids : attrs)[key] = value;
  }
  return {
    ts: entry.timestamp, level: entry.level, service: entry.service, message: entry.message,
    ...(Object.keys(ids).length ? { ids } : {}), ...(Object.keys(attrs).length ? { attrs } : {}),
  };
}

/** Pattern identity shared by grouping and flow sampling. The exception often holds the root cause behind a generic message. */
function patternOf(entry: LogEntry): { key: string; template: string; level: string; service: string } {
  const service = entry.service || '_unknown';
  const level = String(entry.level);
  const exception = entry.metadata?.exception_message ?? entry.metadata?.exception_type;
  const template = messageTemplate(entry.message) + (exception ? ` :: ${messageTemplate(String(exception))}` : '');
  return { key: `${level}|${service}|${template}`, template, level, service };
}

/**
 * Picks correlation ids of Error/Fatal logs to fetch full request flows for: every distinct id (newest first)
 * of each error pattern, most frequent pattern first, so the cap cuts the long tail rather than a whole kind of failure.
 */
// ponytail: `max` caps one query per id; raise it or expose it as a tool param if 200 failing requests isn't enough.
export function pickFlowIds(entries: LogEntry[], perPattern = Infinity, max = 200, fields: string[] = FLOW_ID_FIELDS): Array<{ field: string; value: string }> {
  const byPattern = new Map<string, Map<string, { field: string; value: string }>>();
  for (const entry of [...entries].sort((a, b) => b.timestamp.localeCompare(a.timestamp))) {
    if (entry.level !== 'Error' && entry.level !== 'Fatal') continue;
    const field = fields.find((f) => entry.metadata?.[f] !== undefined && entry.metadata?.[f] !== null && entry.metadata?.[f] !== '');
    if (!field) continue;
    const value = String(entry.metadata![field]);
    const ids = byPattern.get(patternOf(entry).key) ?? new Map();
    ids.set(`${field}|${value}`, { field, value });
    byPattern.set(patternOf(entry).key, ids);
  }
  // Keyed by value: rcid and trace_id often carry the same id, which is one request, not two.
  const picked = new Map<string, { field: string; value: string }>();
  for (const ids of [...byPattern.values()].sort((a, b) => b.size - a.size)) {
    for (const id of [...ids.values()].slice(0, perPattern)) if (picked.size < max && !picked.has(id.value)) picked.set(id.value, id);
  }
  return [...picked.values()];
}

export interface SnapshotOptions {
  baseDir?: string;
  /** Full request flows of sampled errors, written to flows/ and summarized in SUMMARY.md */
  flows?: RequestFlow[];
}

export function writeAiContextSnapshot(entries: LogEntry[], meta: SnapshotMeta, { baseDir = AI_CONTEXT_DIR, flows = [] }: SnapshotOptions = {}): SnapshotResult {
  const createdAt = new Date().toISOString();
  const levelsLabel = meta.levels?.length ? meta.levels.join('-').toLowerCase() : 'all-levels';
  const parent = join(baseDir, safe(meta.provider), safe(meta.env || 'default'), safe(meta.organization), safe(meta.stream));
  const name = `${stamp(createdAt)}_${safe(meta.service || 'all-services')}_${safe(levelsLabel)}`;
  let dir = join(parent, name);
  for (let n = 2; existsSync(dir); n++) dir = join(parent, `${name}_${n}`);
  const toPosix = (path: string) => relative(dir, path).split(sep).join('/');

  // logs/<service>/<level>.jsonl, oldest first, remembering each entry's file:line for pattern examples.
  const sorted = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const files = new Map<string, string[]>();
  const patterns = new Map<string, Pattern>();
  const counts = new Map<string, Map<string, number>>();
  for (const entry of sorted) {
    const { key, template, level, service } = patternOf(entry);
    const file = join(dir, 'logs', safe(service), `${safe(level.toLowerCase())}.jsonl`);
    const lines = files.get(file) ?? [];
    lines.push(JSON.stringify(compact(entry)));
    files.set(file, lines);

    const byLevel = counts.get(service) ?? new Map<string, number>();
    byLevel.set(level, (byLevel.get(level) ?? 0) + 1);
    counts.set(service, byLevel);

    const pattern = patterns.get(key);
    if (pattern) {
      pattern.count++;
      pattern.lastSeen = entry.timestamp;
    } else {
      patterns.set(key, { template, level, service, count: 1, firstSeen: entry.timestamp, lastSeen: entry.timestamp, example: `${toPosix(file)}:${lines.length}` });
    }
  }
  for (const [file, lines] of files) {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  }
  mkdirSync(dir, { recursive: true });

  const rank = (level: string) => SEVERITY.indexOf(level as LogLevel) === -1 ? SEVERITY.length : SEVERITY.indexOf(level as LogLevel);
  const ranked = [...patterns.values()].sort((a, b) => rank(a.level) - rank(b.level) || b.count - a.count);
  const truncated = entries.length >= meta.limit;
  const patternNumber = new Map(ranked.map((p, i) => [`${p.level}|${p.service}|${p.template}`, i + 1]));
  // Each flow belongs to the bug (error pattern) whose log carried its id; that is how pickFlowIds chose it.
  const bugOf = new Map<string, number>();
  for (const entry of sorted) {
    if (entry.level !== 'Error' && entry.level !== 'Fatal') continue;
    for (const field of FLOW_ID_FIELDS) {
      const value = entry.metadata?.[field];
      if (value !== undefined && value !== null && value !== '' && !bugOf.has(String(value))) bugOf.set(String(value), patternNumber.get(patternOf(entry).key)!);
    }
  }

  // flows/<field>-<value>.jsonl: one request end to end across services, oldest first.
  const flowRows = flows.filter((flow) => flow.entries.length).map((flow) => {
    const timeline = [...flow.entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const failures = timeline.filter((entry) => entry.level === 'Error' || entry.level === 'Fatal');
    const first = failures[0];
    // Long-running jobs share one id for thousands of lines; keep the lead-up to the first failure and its aftermath.
    const at = first ? timeline.indexOf(first) : timeline.length - 1;
    const kept = timeline.length > FLOW_MAX_LINES ? timeline.slice(Math.max(0, at - FLOW_BEFORE), at + FLOW_AFTER) : timeline;
    const file = join(dir, 'flows', `${safe(flow.field)}-${safe(flow.value)}.jsonl`);
    mkdirSync(join(dir, 'flows'), { recursive: true });
    writeFileSync(file, kept.map((entry) => JSON.stringify(compact(entry))).join('\n') + '\n', 'utf8');
    return {
      id: `${flow.field}=${flow.value}`, file: toPosix(file), rows: kept.length === timeline.length ? `${timeline.length}` : `${kept.length} of ${timeline.length} (trimmed around first error)`, errors: failures.length,
      path: [...new Set(timeline.map((entry) => entry.service || '_unknown'))].join(' → '),
      pattern: bugOf.get(flow.value) ?? (first ? patternNumber.get(patternOf(first).key) : undefined),
      firstFailure: first ? `${first.service || '_unknown'}: ${messageTemplate(first.message)}` : undefined,
      durationMs: Date.parse(timeline[timeline.length - 1]!.timestamp) - Date.parse(timeline[0]!.timestamp),
    };
  });

  writeFileSync(join(dir, 'patterns.json'), JSON.stringify(ranked, null, 2) + '\n', 'utf8');
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...meta, rows: entries.length, truncated, patterns: ranked.length, flows: flowRows, createdAt }, null, 2) + '\n', 'utf8');

  const levelColumns = SEVERITY.filter((level) => [...counts.values()].some((byLevel) => byLevel.has(level)));
  const serviceRows = [...counts.entries()].sort((a, b) => sum(b[1]) - sum(a[1]));
  const summary = [
    `# Log snapshot: ${meta.stream} / ${meta.service || 'all services'} / ${meta.levels?.join(', ') || 'all levels'}`,
    '',
    '| | |', '|---|---|',
    `| Source | ${meta.provider} · env ${(meta.env || 'default').toUpperCase()} · org ${md(meta.organization)} · stream ${md(meta.stream)} |`,
    `| Filter | service ${md(meta.service || 'all')} · levels ${meta.levels?.join(', ') || 'all'} |`,
    `| Time range (UTC) | ${meta.from} → ${meta.to} |`,
    `| Rows | ${entries.length} (limit ${meta.limit})${truncated ? ' — **TRUNCATED: only the newest rows were fetched; narrow the time range for full coverage**' : ''} |`,
    `| Patterns | ${ranked.length} distinct (see patterns.json) |`,
    `| Created | ${createdAt} |`,
    ...(meta.sql ? [`| SQL | \`${md(meta.sql)}\` |`] : []),
    ...(meta.note ? ['', `> Note: ${meta.note}`] : []),
    '',
    '## Counts by service and level',
    '',
    `| Service | ${levelColumns.join(' | ')} | Total |`,
    `|---|${levelColumns.map(() => '---:').join('|')}|---:|`,
    ...serviceRows.map(([service, byLevel]) => `| ${md(service)} | ${levelColumns.map((level) => byLevel.get(level) ?? 0).join(' | ')} | ${sum(byLevel)} |`),
    '',
    '## Top patterns (most severe first)',
    '',
    '| # | Count | Level | Service | First seen | Last seen | Pattern | Example |',
    '|---:|---:|---|---|---|---|---|---|',
    ...ranked.slice(0, 20).map((p, i) => `| ${i + 1} | ${p.count} | ${p.level} | ${md(p.service)} | ${p.firstSeen} | ${p.lastSeen} | \`${md(p.template.length > 140 ? p.template.slice(0, 140) + '…' : p.template)}\` | ${p.example} |`),
    ...(flowRows.length ? [
      '',
      '## Bugs → request flows (start here to diagnose)',
      '',
      `One row per error pattern (= one bug). Each flow file is one failing request (rcid / trace id) end to end, across all services and levels, oldest first: ${flowRows.length} flow(s) in total, all listed in manifest.json.`,
      '',
      '| Bug # | Count | Service | Pattern | Requests | First failing step (newest request) | Flows |',
      '|---:|---:|---|---|---:|---|---|',
      ...ranked.flatMap((p, i) => {
        if (p.level !== 'Error' && p.level !== 'Fatal') return [];
        const own = flowRows.filter((f) => f.pattern === i + 1);
        const files = own.slice(0, 3).map((f) => f.file + (f.rows.includes(' of ') ? ` (${f.rows})` : '')).join(', ') + (own.length > 3 ? ` +${own.length - 3} more` : '');
        return [`| ${i + 1} | ${p.count} | ${md(p.service)} | \`${md(p.template.slice(0, 120))}\` | ${own.length} | ${md(own[0]?.firstFailure?.slice(0, 160) ?? '-')} | ${files || '-'} |`];
      }),
    ] : []),
    '',
    '## Files',
    '',
    ...(flowRows.length ? ['- `flows/<id>.jsonl`: one failing request end to end; read the lines before the first Error to see what led to it. `manifest.json` → `flows` maps every flow to its bug #, services path, rows and duration.'] : []),
    '- `patterns.json`: every message pattern with count, first/last seen and an example `file:line`.',
    '- `logs/<service>/<level>.jsonl`: one JSON object per line, oldest first: `ts, level, service, message, ids, attrs` (empty fields removed).',
    '- `manifest.json`: query parameters to reproduce or compare this snapshot.',
    '',
    '## How to dig deeper',
    '',
    '- Read the example line of a pattern, then follow its request: grep the value in `ids` (rcid / correlationId / traceId) across `logs/`.',
    '- Compare with an earlier snapshot of the same stream in `INDEX.md` to tell new errors from old ones.',
    '',
  ].join('\n');
  const summaryPath = join(dir, 'SUMMARY.md');
  writeFileSync(summaryPath, summary, 'utf8');

  // Prepend to INDEX.md so the newest snapshot is first.
  const indexPath = join(baseDir, 'INDEX.md');
  const previous = existsSync(indexPath) ? readFileSync(indexPath, 'utf8').replace(INDEX_HEADER, '') : '';
  const link = relative(baseDir, summaryPath).split(sep).join('/');
  const line = `- ${createdAt.slice(0, 16)}Z · ${meta.provider}/${meta.env || 'default'}/${meta.organization}/${meta.stream} · ${meta.service || 'all services'} · ${meta.levels?.join(',') || 'all levels'} · ${meta.from} → ${meta.to} · ${entries.length} rows${truncated ? ' (truncated)' : ''} → [SUMMARY](${link})\n`;
  writeFileSync(indexPath, INDEX_HEADER + line + previous, 'utf8');

  return { dir, summaryPath, rows: entries.length, truncated };
}

function sum(byLevel: Map<string, number>): number {
  let total = 0;
  for (const n of byLevel.values()) total += n;
  return total;
}
