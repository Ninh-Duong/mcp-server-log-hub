import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { resolve } from 'node:path';
import { config, CONFIG_DIR, OPENOBSERVE_ENVS, openObserveEnvFile, useOpenObserveEnv, writePrivateEnvFile } from '../config.js';
import { defaultLogHubService } from '../service.js';
import { openObserveProvider } from '../providers/index.js';
import { logger } from '../utils/logger.js';
import type { LogLevel, RequestFlow } from '../types.js';
import { parseTimeBound } from '../providers/base.js';
import { MAX_ROWS } from '../providers/openobserve.js';
import { dropExported, pickFlowIds, writeAiContextSnapshot } from '../ai-context.js';

/** Rows printed to the terminal; the saved snapshot keeps all of them. */
const SHOWN = 50;

export async function runCliMenu(): Promise<void> {
  logger.setCliMode(true);
  let hideInput = false;
  const output = new Writable({
    write(chunk, _encoding, done) {
      if (!hideInput) process.stdout.write(chunk);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY), historySize: 0 });
  const ask = (question: string): Promise<string> => new Promise((done) => rl.question(question, done));
  const secret = async (label: string): Promise<string> => {
    console.log('Paste with Ctrl+Shift+V or Shift+Insert, then press Enter. Input appears as *.');
    process.stdout.write(label);
    hideInput = true;
    const showMask = (_text: string, key: { name?: string }) => {
      if (key.name !== 'return' && key.name !== 'enter') {
        process.stdout.write(`\r\x1b[2K${label}${'*'.repeat(Math.min(rl.line.length, 32))}`);
      }
    };
    if (process.stdin.isTTY) process.stdin.on('keypress', showMask);
    try { return await ask(''); }
    finally {
      process.stdin.removeListener('keypress', showMask);
      hideInput = false;
      process.stdout.write('\n');
    }
  };
  const pause = async () => { await ask('\nPress Enter to return to provider selection...'); };

  async function configureSeq(): Promise<void> {
    if (config.seq.serverUrl && config.seq.apiKey && (await ask('Use saved Seq account? (Y/n): ')).trim().toLowerCase() !== 'n') return;
    const serverUrl = (await ask(`Seq URL${config.seq.serverUrl ? ` [${config.seq.serverUrl}]` : ''}: `)).trim() || config.seq.serverUrl;
    const apiKey = (await secret('Seq API key (hidden): ')).trim() || config.seq.apiKey;
    if (!serverUrl || !apiKey) throw new Error('Seq URL and API key are required');
    const parsed = new URL(serverUrl);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error('Seq URL must use HTTPS outside localhost');
    writePrivateEnvFile(resolve(CONFIG_DIR, 'seq.env'), { SEQ_SERVER_URL: serverUrl, SEQ_API_KEY: apiKey });
    config.seq.serverUrl = serverUrl.replace(/\/+$/, '');
    config.seq.apiKey = apiKey;
    console.log('Seq account saved locally.');
  }

  async function configureOpenObserve(): Promise<void> {
    console.log(`\nObserve environment:\n${OPENOBSERVE_ENVS.map((env, index) => `  ${index + 1}. ${env.toUpperCase()}`).join('\n')}`);
    const env = OPENOBSERVE_ENVS[Number((await ask(`Choose environment 1-${OPENOBSERVE_ENVS.length}: `)).trim()) - 1];
    if (!env) throw new Error('Invalid environment selection');
    // Accounts are read only from config/openobserve.<env>.env; the CLI never prompts for or saves them.
    useOpenObserveEnv(env);
    const status = openObserveProvider.getStatus();
    if (!status.configured) throw new Error(`Connect failed: ${openObserveEnvFile(env)} is missing or incomplete (${status.missingVariables?.join(', ')})`);
  }

  async function runSeq(): Promise<void> {
    await configureSeq();
    const query = (await ask('Seq filter (blank for recent logs): ')).trim();
    const count = Number((await ask('Maximum results [10]: ')).trim() || 10);
    if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error('Maximum results must be 1-500');
    const logs = await defaultLogHubService.queryLogs({ provider: 'seq', query: query || undefined, limit: count });
    console.log(`\nFound ${logs.length} logs:`);
    for (const log of logs) console.log(`[${log.timestamp}] [${log.level}] ${log.message}`);
  }

  async function runOpenObserve(): Promise<void> {
    await configureOpenObserve();
    console.log(`Connecting to Observe ${config.openobserve.env?.toUpperCase()} (${config.openobserve.url})...`);
    const organizations = await openObserveProvider.listOrganizations();
    if (!organizations.length) { console.log('This account has no accessible Organizations.'); return; }
    console.log('\nAccessible Organizations:');
    organizations.forEach((org, index) => console.log(`  ${index + 1}. ${org.name} (${org.identifier})`));
    const organization = organizations[Number((await ask('Choose Organization number: ')).trim()) - 1];
    if (!organization) throw new Error('Invalid Organization selection');
    const streams = await openObserveProvider.listStreams(organization.identifier);
    if (!streams.length) { console.log('This Organization has no accessible log streams.'); return; }
    console.log('\nLog streams:');
    streams.forEach((stream, index) => console.log(`  ${index + 1}. ${stream}`));
    const stream = streams[Number((await ask('Choose stream number: ')).trim()) - 1];
    if (!stream) throw new Error('Invalid stream selection');
    const mode = (await ask('Search by: 1. Service & level  2. RCID  3. SQL\nChoose 1-3: ')).trim();
    if (!['1', '2', '3'].includes(mode)) throw new Error('Choose 1, 2, or 3');
    const { from, to } = await askTimeRange(mode === '1' ? 2 : 1);
    const organizationId = organization.identifier;
    let service: string | undefined;
    let levels: LogLevel[] | undefined;
    if (mode === '1') {
      const { services } = await openObserveProvider.listServices({ organization: organizationId, stream, from, to });
      if (!services.length) { console.log(`No services logged in ${stream} in this range.`); return; }
      console.log(`\nServices in ${stream}:`);
      const width = Math.max(...services.map((s) => s.name.length));
      services.forEach((s, index) => {
        const issues = s.levels ? ` (${s.levels.Error ?? 0} Error, ${s.levels.Warning ?? 0} Warning${s.levels.Fatal ? `, ${s.levels.Fatal} Fatal` : ''})` : '';
        console.log(`  ${String(index + 1).padStart(2)}. ${s.name.padEnd(width)}  ${String(s.count).padStart(7)} logs${issues}`);
      });
      console.log('   0. All services');
      const choice = Number((await ask('Choose service: ')).trim());
      if (!Number.isInteger(choice) || choice < 0 || choice > services.length) throw new Error('Invalid service selection');
      service = choice ? services[choice - 1]!.name : undefined;
      const levelMenu: Array<[string, LogLevel[] | undefined]> = [
        ['Error (Error+Fatal/Critical)', ['Error', 'Fatal']], ['Warning', ['Warning']], ['Information', ['Information']], ['Debug/Verbose', ['Debug', 'Verbose']], ['All', undefined],
      ];
      console.log(`Log level: ${levelMenu.map(([label], index) => `${index + 1}. ${label}`).join('  ')}`);
      const picks = ((await ask('Choose level(s), e.g. 1 or 1,2 [1,2]: ')).trim() || '1,2').split(',').map((v) => levelMenu[Number(v.trim()) - 1]);
      if (picks.some((p) => !p)) throw new Error('Invalid level selection');
      levels = picks.some((p) => !p![1]) ? undefined : picks.flatMap((p) => p![1]!);
    }
    const limit = Number((await ask(`Maximum results (1-${MAX_ROWS}) [500]: `)).trim() || 500);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROWS) throw new Error(`Maximum results must be 1-${MAX_ROWS}`);
    const common = { organization: organizationId, from, to, limit };
    let sql: string | undefined;
    if (mode === '3') sql = (await ask(`SQL [SELECT * FROM "${stream}"]: `)).trim() || `SELECT * FROM "${stream.replace(/"/g, '""')}"`;
    // RCID: the whole request across services and levels (rcid / correlationid / trace_id), saved as one flow.
    let rcidFlows: RequestFlow[] | undefined;
    if (mode === '2') {
      const rcid = (await ask('RCID: ')).trim();
      if (!rcid) throw new Error('RCID is required');
      rcidFlows = await openObserveProvider.fetchFlows({ organization: organizationId, stream, ids: [{ field: 'rcid', value: rcid }], from, to });
      service = `rcid-${rcid}`;
    }
    let logs = mode === '1'
      ? await openObserveProvider.searchServiceLogs({ ...common, stream, service, levels })
      : rcidFlows
        ? [...(rcidFlows[0]?.entries ?? [])].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        : await openObserveProvider.searchLogs({ ...common, sql: sql! });
    const meta = { provider: 'openobserve', env: config.openobserve.env, organization: organization.name, stream, service, levels, from, to, limit, sql, duplicates: 0 };
    // Overlapping scans (14h→18h, then 16h→20h): keep only rows no earlier snapshot of this stream holds. RCID flows stay whole.
    if (!rcidFlows && logs.length) {
      const { fresh, duplicates } = dropExported(logs, meta);
      if (duplicates) console.log(`\nFetched ${logs.length} logs: ${fresh.length} new, ${duplicates} already in earlier snapshots (skipped).`);
      if (!fresh.length) { console.log('Nothing new to save.'); return; }
      logs = fresh;
      meta.duplicates = duplicates;
    }
    console.log(`\nFound ${logs.length} logs${logs.length > SHOWN ? ` (showing newest ${SHOWN})` : ''}:`);
    for (const log of logs.slice(0, SHOWN)) console.log(`[${log.timestamp}] [${log.level}]${log.service ? ` [${log.service}]` : ''} ${log.message}`);
    if (logs.length > SHOWN) console.log(`... ${logs.length - SHOWN} more (save to ai-context to keep all)`);
    if (!logs.length || (await ask('\nSave to ai-context? (Y/n): ')).trim().toLowerCase() === 'n') return;
    const flowIds = rcidFlows ? [] : pickFlowIds(logs);
    let flows: RequestFlow[] = rcidFlows ?? [];
    if (flowIds.length && (await ask(`Fetch full request flows (rcid/trace_id) for ${flowIds.length} sampled errors? (Y/n): `)).trim().toLowerCase() !== 'n') {
      flows = await openObserveProvider.fetchFlows({ organization: organizationId, stream, ids: flowIds, from, to });
      console.log(`Loaded ${flows.length} flows (${flows.reduce((n, f) => n + f.entries.length, 0)} logs).`);
    }
    const snapshot = writeAiContextSnapshot(logs, {
      ...meta,
      note: logs.some((log) => !log.metadata?.severity && !log.metadata?.level) ? 'Some levels are inferred from log text (stream has no level field).' : undefined,
    }, { flows });
    console.log(`Saved ${snapshot.rows} logs${snapshot.truncated ? ' (truncated at the limit)' : ''}. AI entry point:\n  ${snapshot.summaryPath}`);
  }

  /** Preset or custom range, resolved once to ISO so every query in this search uses the same window. */
  async function askTimeRange(defaultChoice: number): Promise<{ from: string; to: string }> {
    const presets: Array<[string, string]> = [['Last 15 minutes', '15m'], ['Last 1 hour', '1h'], ['Last 6 hours', '6h'], ['Last 24 hours', '24h'], ['Last 7 days', '7d']];
    const dayChoice = presets.length + 1;
    console.log(`\nTime range:\n${presets.map(([label], index) => `  ${index + 1}. ${label}`).join('\n')}\n  ${dayChoice}. Day + hours (24h)\n  ${dayChoice + 1}. Custom (from / to)`);
    const choice = Number((await ask(`Choose 1-${dayChoice + 1} [${defaultChoice}]: `)).trim() || defaultChoice);
    let fromInput: string;
    let toInput = '';
    if (presets[choice - 1]) fromInput = presets[choice - 1]![1];
    else if (choice === dayChoice) {
      // Local day + 24h hours, e.g. yesterday 14 → 18.
      const dayInput = (await ask('Day (YYYY-MM-DD, or 0 = today, 1 = yesterday, 2 = 2 days ago) [1]: ')).trim() || '1';
      const daysAgo = /^\d{1,3}$/.test(dayInput);
      const day = daysAgo ? new Date() : new Date(`${dayInput}T00:00`);
      if (daysAgo) day.setDate(day.getDate() - Number(dayInput));
      const at = (input: string) => {
        const match = input.trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
        if (!match || isNaN(day.getTime()) || Number(match[1]) > 24 || Number(match[2] ?? 0) > 59) throw new Error('Invalid day or hour: use YYYY-MM-DD or 0/1/2, and hours 0-24 (optionally :mm)');
        return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(match[1]), Number(match[2] ?? 0)).toISOString();
      };
      fromInput = at(await ask('From hour (e.g. 14 or 14:30): '));
      toInput = at(await ask('To hour (e.g. 18; 24 = end of day): '));
    } else if (choice === dayChoice + 1) {
      fromInput = (await ask('From (e.g. 2026-10-07 09:00 local, ISO 8601, or 30m): ')).trim();
      toInput = (await ask('To (blank = now): ')).trim();
    } else throw new Error('Invalid time range selection');
    const now = new Date().toISOString();
    const from = parseTimeBound(fromInput);
    let to = toInput ? parseTimeBound(toInput) : now;
    if (!from || !to || Date.parse(from) >= Date.parse(to)) throw new Error('Invalid time range: use local "YYYY-MM-DD HH:mm", ISO 8601, or 15m/1h/7d, with From before To');
    if (from >= now) throw new Error(`From ${new Date(from).toLocaleString()} is in the future (now ${new Date(now).toLocaleString()}); pick an earlier day or hour`);
    // A range ending later today stops at now, so snapshots record what they actually cover.
    if (to > now) to = now;
    console.log(`Range: ${new Date(from).toLocaleString()} → ${new Date(to).toLocaleString()} local (${from} → ${to})`);
    return { from, to };
  }

  while (true) {
    console.log('\nWhich log platform do you want to use?');
    console.log('  1. Seq');
    console.log('  2. Observe');
    console.log('  3. Exit');
    const choice = (await ask('Choose 1-3: ')).trim();
    if (choice === '3') break;
    if (choice !== '1' && choice !== '2') { console.log('Choose 1, 2, or 3.'); continue; }
    try { if (choice === '1') await runSeq(); else await runOpenObserve(); }
    catch (err) {
      logger.error('cli.operation_failed', {
        provider: choice === '1' ? 'seq' : 'openobserve',
        errorType: err instanceof Error ? err.name : 'UnknownError',
      });
      console.error(`Error: ${(err as Error).message}`);
    }
    await pause();
  }
  rl.close();
  logger.setCliMode(false);
}
