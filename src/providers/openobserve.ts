import { config } from '../config.js';
import { LogEntry, LogProvider, LogQuery, ProviderStatus } from '../types.js';
import { normalizeLogLevel, parseTimeBound } from './base.js';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

export interface OpenObserveOrganization { name: string; identifier: string }
export interface OpenObserveField { name: string; type: string }
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
    return {
      name: this.name,
      configured: missing.length === 0,
      endpoint: config.openobserve.url || undefined,
      missingVariables: missing.length ? missing : undefined,
      details: missing.length ? `Missing ${missing.join(', ')}` : 'Credentials configured; connection not yet verified',
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

  public async listOrganizations(operationId: string = randomUUID()): Promise<OpenObserveOrganization[]> {
    const result = await this.request('api/organizations', {}, operationId) as { data?: Array<Record<string, unknown>> };
    if (!Array.isArray(result.data)) throw new Error('Unexpected OpenObserve organizations response');
    const organizations = result.data.map((org) => ({ name: String(org.name || ''), identifier: String(org.identifier || '') }))
      .filter((org) => org.name && org.identifier);
    logger.info('openobserve.organizations_loaded', { count: organizations.length });
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
    const limit = Math.min(Math.max(params.limit || 50, 1), 500);
    const result = await this.request(`api/${encodeURIComponent(params.organization)}/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { sql: params.sql, start_time: Date.parse(from) * 1000, end_time: Date.parse(to) * 1000, from: 0, size: limit } }),
    }, operationId) as { hits?: Array<Record<string, unknown>> };
    if (!Array.isArray(result.hits)) throw new Error('Unexpected OpenObserve search response');
    const logs = result.hits.map((row) => ({
      timestamp: typeof row._timestamp === 'number' ? new Date(row._timestamp / 1000).toISOString() : new Date().toISOString(),
      level: normalizeLogLevel(String(row.level || row.severity || 'Information')),
      message: String(row.message || row.log || row.msg || JSON.stringify(row)),
      provider: this.name,
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
    const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const sql = `SELECT * FROM ${quoteIdentifier(params.stream)} WHERE ${quoteIdentifier(params.field)} = '${params.rcid.replace(/'/g, "''")}' ORDER BY _timestamp DESC`;
    return this.searchLogs({ ...params, sql, operationId });
  }

  public async queryLogs(params: LogQuery): Promise<LogEntry[]> {
    if (!params.organization) throw new Error('OpenObserve organization is required');
    if (!params.query && !params.stream) throw new Error('OpenObserve SQL query or stream is required');
    const sql = params.query || `SELECT * FROM "${params.stream!.replace(/"/g, '""')}" ORDER BY _timestamp DESC`;
    return this.searchLogs({ organization: params.organization, sql, from: params.from, to: params.to, limit: params.limit });
  }
}
