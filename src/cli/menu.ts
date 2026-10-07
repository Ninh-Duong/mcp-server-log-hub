import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { resolve } from 'node:path';
import { config, PROJECT_ROOT, writePrivateEnvFile } from '../config.js';
import { defaultLogHubService } from '../service.js';
import { openObserveProvider } from '../providers/index.js';
import { logger } from '../utils/logger.js';

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
    writePrivateEnvFile(resolve(PROJECT_ROOT, 'config/seq.env'), { SEQ_SERVER_URL: serverUrl, SEQ_API_KEY: apiKey });
    config.seq.serverUrl = serverUrl.replace(/\/+$/, '');
    config.seq.apiKey = apiKey;
    console.log('Seq account saved locally.');
  }

  async function configureOpenObserve(): Promise<void> {
    if (openObserveProvider.getStatus().configured && (await ask('Use saved Observe account? (Y/n): ')).trim().toLowerCase() !== 'n') return;
    const url = (await ask(`Observe URL${config.openobserve.url ? ` [${config.openobserve.url}]` : ''}: `)).trim() || config.openobserve.url;
    let email = (await ask(`Account email${config.openobserve.email ? ` [${config.openobserve.email}]` : ''}: `)).trim() || config.openobserve.email;
    let token = (await secret('Account token or Basic credential (hidden): ')).trim() || config.openobserve.token;
    const encoded = token.replace(/^(?:authorization:\s*)?basic\s+/i, '');
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator > 0 && Buffer.from(decoded).toString('base64') === encoded && /^[^\s:@]+@[^\s:@]+\.[^\s:@]+$/.test(decoded.slice(0, separator))) {
      email = decoded.slice(0, separator);
      token = decoded.slice(separator + 1);
      console.log(`Using Basic credential for ${email}.`);
    }
    if (!url || !email || !token) throw new Error('Observe URL, email, and token are required');
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error('Observe URL must use HTTPS outside localhost');
    writePrivateEnvFile(resolve(PROJECT_ROOT, 'config/openobserve.env'), { OPENOBSERVE_URL: url, OPENOBSERVE_EMAIL: email, OPENOBSERVE_TOKEN: token });
    config.openobserve.url = url.replace(/\/+$/, '');
    config.openobserve.email = email;
    config.openobserve.token = token;
    console.log('Observe account saved locally.');
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
    console.log('Connecting to Observe...');
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
    const mode = (await ask('Search by (1) RCID or (2) SQL? ')).trim();
    if (mode !== '1' && mode !== '2') throw new Error('Choose 1 or 2');
    const from = (await ask('From [15m]: ')).trim() || '15m';
    const limit = Number((await ask('Maximum results [50]: ')).trim() || 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Maximum results must be 1-500');
    const common = { organization: organization.identifier, from, limit };
    const logs = mode === '1'
      ? await openObserveProvider.findByRcid({ ...common, stream, field: (await ask('RCID field [rcid]: ')).trim() || 'rcid', rcid: (await ask('RCID: ')).trim() })
      : await openObserveProvider.searchLogs({ ...common, sql: (await ask(`SQL [SELECT * FROM "${stream}"]: `)).trim() || `SELECT * FROM "${stream.replace(/"/g, '""')}"` });
    console.log(`\nFound ${logs.length} logs:`);
    for (const log of logs) console.log(`[${log.timestamp}] [${log.level}] ${log.message}`);
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
