import assert from 'node:assert/strict';
import { test } from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerLogHubTools } from '../tools.js';

test('registers an agent bug investigation prompt and schema discovery tool', async () => {
  const tools = new Map<string, { description: string }>();
  const prompts = new Map<string, { description: string; callback: (args: Record<string, string>) => unknown }>();
  const server = {
    tool: (...args: unknown[]) => {
      tools.set(String(args[0]), { description: String(args[1] || '') });
      return {};
    },
    registerPrompt: (name: string, config: { description: string }, callback: (args: Record<string, string>) => unknown) => {
      prompts.set(name, { description: config.description, callback });
      return {};
    },
  } as unknown as McpServer;

  registerLogHubTools(server);

  assert.ok(tools.has('list_openobserve_stream_schema'));
  assert.ok(tools.has('list_openobserve_services'));
  assert.ok(tools.has('get_openobserve_service_logs'));
  assert.ok(tools.has('export_openobserve_logs'));
  assert.match(tools.get('search_openobserve_logs')?.description || '', /SELECT/i);
  const prompt = prompts.get('investigate_api_bug');
  assert.ok(prompt);
  const result = prompt.callback({ bug_report: 'API timeout', api_endpoint: 'POST /api/orders', observed_at: '10 minutes ago' }) as {
    messages: Array<{ content: { type: string; text: string } }>;
  };
  assert.match(result.messages[0]?.content.text || '', /schema/i);
  assert.match(result.messages[0]?.content.text || '', /log-work/i);
  assert.match(result.messages[0]?.content.text || '', /source code/i);
});
