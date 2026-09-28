import { config } from '../config.js';
import { LogEntry, LogProvider, LogQuery, ProviderStatus } from '../types.js';
import { normalizeLogLevel, parseTimeBound } from './base.js';

export interface OpenObserveOrganization { name: string; identifier: string }
export interface OpenObserveSearch {
  organization: string;
  sql: string;
  from?: string;
  to?: string;
  limit?: number;
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

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    if (!this.getStatus().configured) throw new Error(this.getStatus().details);
    const base = new URL(config.openobserve.url);
    if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') {
      throw new Error('OpenObserve URL must use HTTPS');
    }
    const response = await fetch(new URL(path, `${base.toString().replace(/\/+$/, '')}/`), {
      ...init,
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.openobserve.email}:${config.openobserve.token}`).toString('base64')}`,
        Accept: 'application/json',
        ...init.headers,
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenObserve HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    return response.json();
  }

  public async listOrganizations(): Promise<OpenObserveOrganization[]> {
    const result = await this.request('api/organizations') as { data?: Array<Record<string, unknown>> };
    if (!Array.isArray(result.data)) throw new Error('Unexpected OpenObserve organizations response');
    return result.data.map((org) => ({ name: String(org.name || ''), identifier: String(org.identifier || '') }))
      .filter((org) => org.name && org.identifier);
  }

  private async requireOrganization(organization: string): Promise<void> {
    const organizations = await this.listOrganizations();
    if (!organizations.some((org) => org.identifier === organization)) {
      throw new Error(`Organization '${organization}' is not accessible to this account`);
    }
  }

  public async listStreams(organization: string): Promise<string[]> {
    await this.requireOrganization(organization);
    const result = await this.request(`api/${encodeURIComponent(organization)}/streams?type=logs`) as { list?: Array<Record<string, unknown>> };
    if (!Array.isArray(result.list)) throw new Error('Unexpected OpenObserve streams response');
    return result.list.map((stream) => String(stream.name || '')).filter(Boolean);
  }

  public async searchLogs(params: OpenObserveSearch): Promise<LogEntry[]> {
    if (!params.sql.trim()) throw new Error('SQL query is required');
    await this.requireOrganization(params.organization);
    const from = parseTimeBound(params.from || '15m');
    const to = params.to ? parseTimeBound(params.to) : new Date().toISOString();
    if (!from || !to || Date.parse(from) >= Date.parse(to)) throw new Error('Invalid time range');
    const limit = Math.min(Math.max(params.limit || 50, 1), 500);
    const result = await this.request(`api/${encodeURIComponent(params.organization)}/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { sql: params.sql, start_time: Date.parse(from) * 1000, end_time: Date.parse(to) * 1000, from: 0, size: limit } }),
    }) as { hits?: Array<Record<string, unknown>> };
    if (!Array.isArray(result.hits)) throw new Error('Unexpected OpenObserve search response');
    return result.hits.map((row) => ({
      timestamp: typeof row._timestamp === 'number' ? new Date(row._timestamp / 1000).toISOString() : new Date().toISOString(),
      level: normalizeLogLevel(String(row.level || row.severity || 'Information')),
      message: String(row.message || row.log || row.msg || JSON.stringify(row)),
      provider: this.name,
      metadata: row,
    }));
  }

  public async findByRcid(params: Omit<OpenObserveSearch, 'sql'> & { stream: string; field: string; rcid: string }): Promise<LogEntry[]> {
    if (!params.rcid.trim()) throw new Error('RCID is required');
    const streams = await this.listStreams(params.organization);
    if (!streams.includes(params.stream)) throw new Error(`Log stream '${params.stream}' is not accessible`);
    const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const sql = `SELECT * FROM ${quoteIdentifier(params.stream)} WHERE ${quoteIdentifier(params.field)} = '${params.rcid.replace(/'/g, "''")}' ORDER BY _timestamp DESC`;
    return this.searchLogs({ ...params, sql });
  }

  public async queryLogs(params: LogQuery): Promise<LogEntry[]> {
    if (!params.organization) throw new Error('OpenObserve organization is required');
    if (!params.query && !params.stream) throw new Error('OpenObserve SQL query or stream is required');
    const sql = params.query || `SELECT * FROM "${params.stream!.replace(/"/g, '""')}" ORDER BY _timestamp DESC`;
    return this.searchLogs({ organization: params.organization, sql, from: params.from, to: params.to, limit: params.limit });
  }
}
