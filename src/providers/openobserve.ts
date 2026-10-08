import { config } from '../config.js';
import { LogEntry, LogLevel, LogProvider, LogQuery, ProviderStatus, RequestFlow } from '../types.js';
import { FLOW_ID_FIELDS, LEVEL_ALIASES, normalizeLogLevel, parseTimeBound } from './base.js';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

export interface OpenObserveOrganization { name: string; identifier: string }
export interface OpenObserveField { name: string; type: string }
export interface OpenObserveService { name: string; count: number; levels?: Partial<Record<LogLevel, number>> }
export interface OpenObserveServiceQuery {
  organization: string;
  stream: string;
  /** Omit for all services in the stream */
  service?: string;
  /** Exact levels to return; omit for all */
  levels?: LogLevel[];
  from?: string;
  to?: string;
  limit?: number;
}

/** OpenObserve returns at most PAGE_SIZE rows per request; searchLogs pages up to MAX_ROWS. */
const PAGE_SIZE = 500;
export const MAX_ROWS = 5000;
const FLOW_BATCH = 50;
const FLOW_PAD_MS = 15 * 60_000;

const quoteIdentifier =(value: string) => `"${value.replace(/"/g, '""')}"`;
const quoteString = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** Kubernetes pod "easyserv-bmw-api-5c67fbd785-lcm4v" -> deployment "easyserv-bmw-api". */
export const deploymentName = (pod: string): string => pod.replace(/-[a-z0-9]{6,10}-[a-z0-9]{5}$/, '');

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

/** Level from free-text log lines such as "[NestWinston] ... \x1b[32mINFO\x1b[39m [Service] message". */
export function levelFromText(text: unknown): LogLevel {
  const head = stripAnsi(String(text ?? '')).slice(0, 120);
  return normalizeLogLevel(head.match(/\b(verbose|trace|debug|info|warn|error|fatal|crit)/i)?.[1]);
}

/** Same field priority as detectShape: service_name, applicationname, then Kubernetes deployment. */
function serviceOf(row: Record<string, unknown>): string | undefined {
  const named = row.service_name || row.applicationname;
  if (named) return String(named);
  return row.kubernetes_pod_name ? deploymentName(String(row.kubernetes_pod_name)) : undefined;
}

/** Words searched in raw `log` text for streams without a level field. */
const LEVEL_WORDS: Record<LogLevel, string[]> = {
  Verbose: ['verbose', 'trace'], Debug: ['debug'], Information: ['info'], Warning: ['warn'], Error: ['error'], Fatal: ['fatal', 'crit'],
};

/** Where the service and level live in a stream: structured fields, or Kubernetes pod name + log text. */
function detectShape(fields: OpenObserveField[]): { serviceField: string; levelField?: string; k8s: boolean } {
  const names = new Set(fields.map((f) => f.name));
  const levelField = ['severity', 'level'].find((n) => names.has(n));
  const structured = ['service_name', 'applicationname'].find((n) => names.has(n));
  if (structured) return { serviceField: structured, levelField, k8s: false };
  if (names.has('kubernetes_pod_name')) return { serviceField: 'kubernetes_pod_name', levelField, k8s: true };
  throw new Error('No service field in this stream (looked for service_name, applicationname, kubernetes_pod_name)');
}
export interface OpenObserveSearch {
  organization: string;
  sql: string;
  from?: string;
  to?: string;
  limit?: number;
  operationId?: string;
}

export class OpenObserveProvider implements LogProvider {
  public readonly name = 'openobserve';

  public getStatus(): ProviderStatus {
    const missing = [
      !config.openobserve.url && 'OPENOBSERVE_URL',
      !config.openobserve.email && 'OPENOBSERVE_EMAIL',
      !config.openobserve.token && 'OPENOBSERVE_TOKEN',
    ].filter((value): value is string => Boolean(value));
    const env = config.openobserve.env ? ` (${config.openobserve.env.toUpperCase()})` : '';
    return {
      name: this.name,
      configured: missing.length === 0,
      endpoint: config.openobserve.url || undefined,
      missingVariables: missing.length ? missing : undefined,
      details: missing.length ? `Missing ${missing.join(', ')}${env}` : `Credentials configured${env}; connection not yet verified`,
    };
  }

  private async request(path: string, init: RequestInit = {}, operationId: string = randomUUID()): Promise<unknown> {
    if (!this.getStatus().configured) throw new Error(this.getStatus().details);
    const base = new URL(config.openobserve.url);
    if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') {
      throw new Error('OpenObserve URL must use HTTPS');
    }
    const url = new URL(path, `${base.toString().replace(/\/+$/, '')}/`);
    const method = init.method || 'GET';
    const started = Date.now();
    logger.info('openobserve.request_started', { operationId, method, endpoint: url.pathname });
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.openobserve.email}:${config.openobserve.token}`).toString('base64')}`,
          Accept: 'application/json',
          ...init.headers,
        },
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      logger.error('openobserve.request_failed', {
        operationId, method, endpoint: url.pathname, durationMs: Date.now() - started,
        errorType: err instanceof Error ? err.name : 'UnknownError',
      });
      throw err;
    }
    if (!response.ok) {
      const body = await response.text();
      logger.error('openobserve.request_failed', {
        operationId, method, endpoint: url.pathname, status: response.status, durationMs: Date.now() - started,
      });
      throw new Error(`OpenObserve HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    logger.info('openobserve.request_succeeded', {
      operationId, method, endpoint: url.pathname, status: response.status, durationMs: Date.now() - started,
    });
    return response.json();
  }

  // ponytail: 60s TTL, so a revoked organization stays usable for up to 60s; drop the TTL if that is unacceptable.
  private orgCache?: { key: string; at: number; organizations: OpenObserveOrganization[] };

  public async listOrganizations(operationId: string = randomUUID()): Promise<OpenObserveOrganization[]> {
    const key = `${config.openobserve.url}|${config.openobserve.email}|${config.openobserve.token}`;
    if (this.orgCache?.key === key && Date.now() - this.orgCache.at < 60_000) return this.orgCache.organizations;
    const result = await this.request('api/organizations', {}, operationId) as { data?: Array<Record<string, unknown>> };
    if (!Array.isArray(result.data)) throw new Error('Unexpected OpenObserve organizations response');
    const organizations = result.data.map((org) => ({ name: String(org.name || ''), identifier: String(org.identifier || '') }))
      .filter((org) => org.name && org.identifier);
    logger.info('openobserve.organizations_loaded', { count: organizations.length });
    this.orgCache = { key, at: Date.now(), organizations };
    return organizations;
  }

  private async requireOrganization(organization: string, operationId: string): Promise<void> {
    const organizations = await this.listOrganizations(operationId);
    if (!organizations.some((org) => org.identifier === organization)) {
      throw new Error(`Organization '${organization}' is not accessible to this account`);
    }
  }

  public async listStreams(organization: string, operationId: string = randomUUID()): Promise<string[]> {
    await this.requireOrganization(organization, operationId);
    const result = await this.request(`api/${encodeURIComponent(organization)}/streams?type=logs`, {}, operationId) as { list?: Array<Record<string, unknown>> };
    if (!Array.isArray(result.list)) throw new Error('Unexpected OpenObserve streams response');
    const streams = result.list.map((stream) => String(stream.name || '')).filter(Boolean);
    logger.info('openobserve.streams_loaded', { organization, count: streams.length });
    return streams;
  }

  public async getStreamSchema(organization: string, stream: string): Promise<OpenObserveField[]> {
    const operationId = randomUUID();
    if (!(await this.listStreams(organization, operationId)).includes(stream)) {
      throw new Error(`Log stream '${stream}' is not accessible`);
    }
    const result = await this.request(`api/${encodeURIComponent(organization)}/streams/${encodeURIComponent(stream)}/schema?type=logs`, {}, operationId) as {
      schema?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(result.schema)) throw new Error('Unexpected OpenObserve stream schema response');
    const fields = result.schema.map((field) => ({ name: String(field.name || ''), type: String(field.type || '') }))
      .filter((field) => field.name && field.type);
    logger.info('openobserve.schema_loaded', { organization, stream, count: fields.length });
    return fields;
  }

  public async searchLogs(params: OpenObserveSearch): Promise<LogEntry[]> {
    if (!params.sql.trim()) throw new Error('SQL query is required');
    if (!/^SELECT\b/i.test(params.sql.trim()) || /;\s*\S/.test(params.sql)) {
      throw new Error('Only a single SELECT query is allowed');
    }
    const operationId = params.operationId || randomUUID();
    await this.requireOrganization(params.organization, operationId);
    const from = parseTimeBound(params.from || '15m');
    const to = params.to ? parseTimeBound(params.to) : new Date().toISOString();
    if (!from || !to || Date.parse(from) >= Date.parse(to)) throw new Error('Invalid time range');
    const limit = Math.min(Math.max(params.limit || 50, 1), MAX_ROWS);
    const hits: Array<Record<string, unknown>> = [];
    // Page PAGE_SIZE rows at a time until the data or the limit runs out.
    while (hits.length < limit) {
      const size = Math.min(PAGE_SIZE, limit - hits.length);
      const result = await this.request(`api/${encodeURIComponent(params.organization)}/_search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: { sql: params.sql, start_time: Date.parse(from) * 1000, end_time: Date.parse(to) * 1000, from: hits.length, size } }),
      }, operationId) as { hits?: Array<Record<string, unknown>> };
      if (!Array.isArray(result.hits)) throw new Error('Unexpected OpenObserve search response');
      hits.push(...result.hits);
      if (result.hits.length < size) break;
    }
    const logs = hits.map((row) => ({
      timestamp: typeof row._timestamp === 'number' ? new Date(row._timestamp / 1000).toISOString() : new Date().toISOString(),
      level: row.level || row.severity ? normalizeLogLevel(String(row.level || row.severity)) : levelFromText(row.log),
      message: stripAnsi(String(row.message || row.body || row.log || row.msg || JSON.stringify(row))).trim(),
      provider: this.name,
      service: serviceOf(row),
      metadata: row,
    }));
    logger.info('openobserve.search_results', { operationId, organization: params.organization, from, to, limit, count: logs.length });
    return logs;
  }

  public async findByRcid(params: Omit<OpenObserveSearch, 'sql'> & { stream: string; field: string; rcid: string }): Promise<LogEntry[]> {
    if (!params.rcid.trim()) throw new Error('RCID is required');
    const operationId = params.operationId || randomUUID();
    const streams = await this.listStreams(params.organization, operationId);
    if (!streams.includes(params.stream)) throw new Error(`Log stream '${params.stream}' is not accessible`);
    const sql = `SELECT * FROM ${quoteIdentifier(params.stream)} WHERE ${quoteIdentifier(params.field)} = ${quoteString(params.rcid)} ORDER BY _timestamp DESC`;
    return this.searchLogs({ ...params, sql, operationId });
  }

  /** Services in a stream with log counts (and per-level counts when the stream has a level field). */
  public async listServices(params: Omit<OpenObserveServiceQuery, 'service' | 'levels' | 'limit'>): Promise<{ field: string; services: OpenObserveService[] }> {
    const shape = detectShape(await this.getStreamSchema(params.organization, params.stream));
    const svc = quoteIdentifier(shape.serviceField);
    const lvl = shape.levelField && !shape.k8s ? quoteIdentifier(shape.levelField) : undefined;
    const groupBy = lvl ? `${svc}, ${lvl}` : svc;
    // ponytail: one GROUP BY page of 500 rows; services x levels beyond that are dropped, page the query if streams grow that wide.
    const rows = await this.searchLogs({
      organization: params.organization, from: params.from || '1h', to: params.to, limit: 500,
      sql: `SELECT ${svc} AS service${lvl ? ', ' + lvl + ' AS lvl' : ''}, COUNT(*) AS n FROM ${quoteIdentifier(params.stream)} WHERE ${svc} IS NOT NULL GROUP BY ${groupBy}`,
    });
    const services = new Map<string, OpenObserveService>();
    for (const { metadata: row = {} } of rows) {
      const name = shape.k8s ? deploymentName(String(row.service)) : String(row.service);
      const entry = services.get(name) ?? { name, count: 0, ...(lvl ? { levels: {} } : {}) };
      const n = Number(row.n) || 0;
      entry.count += n;
      if (entry.levels) {
        const level = normalizeLogLevel(String(row.lvl ?? ''));
        entry.levels[level] = (entry.levels[level] ?? 0) + n;
      }
      services.set(name, entry);
    }
    return { field: shape.serviceField, services: [...services.values()].sort((a, b) => b.count - a.count) };
  }

  /** Logs of one service (or all) filtered to exact levels, newest first. */
  public async searchServiceLogs(params: OpenObserveServiceQuery): Promise<LogEntry[]> {
    const shape = detectShape(await this.getStreamSchema(params.organization, params.stream));
    const svc = quoteIdentifier(shape.serviceField);
    const where = [`${svc} IS NOT NULL`];
    if (params.service) where.push(shape.k8s ? `${svc} LIKE ${quoteString(params.service + '-%')}` : `${svc} = ${quoteString(params.service)}`);
    if (params.levels?.length) {
      if (shape.levelField && !shape.k8s) {
        const values = [...new Set(params.levels.flatMap((l) => LEVEL_ALIASES[l]).flatMap((a) => [a, a.toLowerCase()]))];
        where.push(`${quoteIdentifier(shape.levelField)} IN (${values.map(quoteString).join(', ')})`);
      } else {
        // Coarse prefilter on the raw text; exact level is checked after fetch.
        where.push(`(${params.levels.flatMap((l) => LEVEL_WORDS[l]).map((w) => `str_match_ignore_case(log, ${quoteString(w)})`).join(' OR ')})`);
      }
    }
    const logs = await this.searchLogs({
      organization: params.organization, from: params.from, to: params.to, limit: params.limit,
      sql: `SELECT * FROM ${quoteIdentifier(params.stream)} WHERE ${where.join(' AND ')} ORDER BY _timestamp DESC`,
    });
    // ponytail: Kubernetes level and service are refined after fetch (level comes from log text), so results may under-fill `limit`.
    return logs.filter((log) => (!params.service || log.service === params.service) && (!params.levels?.length || params.levels.includes(log.level as LogLevel)));
  }

  /**
   * Full request flows: every log in the stream sharing each correlation id, across services and levels.
   * Ids are batched into `IN (...)` queries (one request per FLOW_BATCH ids) instead of one SELECT per id.
   * The window is widened by FLOW_PAD_MS on both sides so a request that started before the range stays whole.
   */
  public async fetchFlows(params: { organization: string; stream: string; ids: Array<{ field: string; value: string }>; from: string; to: string }): Promise<RequestFlow[]> {
    // Match each id value on every correlation field the stream has: one request may log it as rcid in one sink and trace_id in another.
    const schema = new Set((await this.getStreamSchema(params.organization, params.stream)).map((f) => f.name));
    const fields = FLOW_ID_FIELDS.filter((field) => schema.has(field));
    const flows = new Map(params.ids.map((id) => [id.value, { ...id, entries: [] as LogEntry[] }]));
    const values = [...flows.keys()];
    const from = new Date(Date.parse(params.from) - FLOW_PAD_MS).toISOString();
    const to = new Date(Math.min(Date.now(), Date.parse(params.to) + FLOW_PAD_MS)).toISOString();
    for (let i = 0; fields.length && i < values.length; i += FLOW_BATCH) {
      const list = values.slice(i, i + FLOW_BATCH).map(quoteString).join(', ');
      // ponytail: MAX_ROWS per batch; a batch of very chatty requests can be cut, lower FLOW_BATCH if flows look incomplete.
      const rows = await this.searchLogs({ organization: params.organization, from, to, limit: MAX_ROWS,
        sql: `SELECT * FROM ${quoteIdentifier(params.stream)} WHERE ${fields.map((f) => `${quoteIdentifier(f)} IN (${list})`).join(' OR ')} ORDER BY _timestamp DESC` });
      for (const row of rows) {
        const matched = new Set(fields.map((f) => String(row.metadata?.[f] ?? '')).filter((v) => flows.has(v)));
        for (const value of matched) flows.get(value)!.entries.push(row);
      }
    }
    const loaded = [...flows.values()].filter((flow) => flow.entries.length);
    logger.info('openobserve.flows_loaded', { stream: params.stream, flows: loaded.length, rows: loaded.reduce((n, f) => n + f.entries.length, 0) });
    return loaded;
  }

  // ponytail: level is filtered after fetch (level field name varies per stream), so `limit` may under-fill; add a `levelField` param to push it into SQL if that matters.
  public async queryLogs(params: LogQuery): Promise<LogEntry[]> {
    if (!params.organization) throw new Error('OpenObserve organization is required');
    if (!params.query && !params.stream) throw new Error('OpenObserve SQL query or stream is required');
    const sql = params.query || `SELECT * FROM "${params.stream!.replace(/"/g, '""')}" ORDER BY _timestamp DESC`;
    return this.searchLogs({ organization: params.organization, sql, from: params.from, to: params.to, limit: params.limit });
  }
}
