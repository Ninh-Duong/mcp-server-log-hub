import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LogHubService, defaultLogHubService } from '../service.js';
import { registerAiContextTools, registerAnalyzePrompt } from './ai-context.js';
import { registerOpenObserveTools } from './openobserve.js';
import { registerBugPrompt, registerQueryTools } from './query.js';

export interface RegisterToolsOptions {
  /** Optional prefix for tool names (useful when mounted inside a Master MCP, e.g. "log_hub_") */
  prefix?: string;
  /** Custom LogHubService instance */
  service?: LogHubService;
}

/**
 * Registers the Log Hub prompts and tools into any McpServer instance.
 * Enables both standalone operation and direct in-process embedding by a Master MCP.
 */
export function registerLogHubTools(server: McpServer, options: RegisterToolsOptions = {}): void {
  const prefix = options.prefix || '';
  registerBugPrompt(server, prefix);
  registerAnalyzePrompt(server, prefix);
  registerQueryTools(server, prefix, options.service || defaultLogHubService);
  registerOpenObserveTools(server, prefix);
  registerAiContextTools(server, prefix);
}

/**
 * Server instructions sent to the client on connect. Agents working in another repository never see this repo's
 * AGENTS.md, so this is where they learn to read ai-context only through the tools. A Master MCP mounting the tools
 * with a prefix can append logHubInstructions(prefix) to its own instructions.
 */
export function logHubInstructions(prefix = ''): string {
  return `Log Hub: search Seq / OpenObserve logs and read encrypted ai-context log exports.
- ai-context exports are read ONLY through ${prefix}list_ai_context_snapshots and ${prefix}read_ai_context. Never open, copy, cat or decrypt .lhub files (or anything under ai-context/) with file tools or scripts: they are encrypted, and the access check runs inside read_ai_context. You do not need the folder's path.
- Reading order: ${prefix}list_ai_context_snapshots → ${prefix}read_ai_context(snapshot) for SUMMARY.lhub (Bugs table, top patterns with file:line) → read_ai_context(file, offset) at that line in services/<service>/<level>.lhub → the failing request in rcid/<field>-<id>.lhub, or grep an rcid across every file.
- services/ leaves out framework noise (health checks, ASP.NET pipeline, EF Core SQL, HttpClient, gRPC…); a request's rcid/ file has all of it.
- "No access" means the OpenObserve account for that env is missing or not enabled for the export's organization: tell the user, do not look for another way to read the data.
- To diagnose, compare what the logs show with the source code of the workspace you are working in; cite log lines and source files.
- New data: ${prefix}export_openobserve_logs writes a new export folder; live searches: ${prefix}search_openobserve_logs, ${prefix}get_openobserve_service_logs, ${prefix}find_openobserve_logs_by_rcid. Prompts: ${prefix}analyze_ai_context, ${prefix}investigate_api_bug.`;
}
