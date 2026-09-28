import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LOGS_DIR } from '../config.js';

export class ProcessLogger {
  private logFilePath: string;
  private isCliMode: boolean = false;

  constructor() {
    if (!existsSync(LOGS_DIR)) {
      try {
        mkdirSync(LOGS_DIR, { recursive: true });
      } catch {
        // Ignored
      }
    }
    this.logFilePath = resolve(LOGS_DIR, 'mcp-process.log');
  }

  public setCliMode(enabled: boolean): void {
    this.isCliMode = enabled;
  }

  private write(level: string, message: string, meta?: unknown): void {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` | ${typeof meta === 'object' ? JSON.stringify(meta) : meta}` : '';
    const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}\n`;

    // Persist to log file
    try {
      appendFileSync(this.logFilePath, line, 'utf8');
    } catch {
      // Avoid crash on disk write errors
    }

    // Terminal output:
    // CRITICAL: NEVER write to stdout during MCP stdio mode, as it breaks JSON-RPC!
    if (this.isCliMode) {
      console.log(`[${level.toUpperCase()}] ${message}${metaStr}`);
    } else {
      process.stderr.write(line);
    }
  }

  public info(message: string, meta?: unknown): void {
    this.write('info', message, meta);
  }

  public warn(message: string, meta?: unknown): void {
    this.write('warn', message, meta);
  }

  public error(message: string, meta?: unknown): void {
    this.write('error', message, meta);
  }

  public debug(message: string, meta?: unknown): void {
    if (process.env.LOG_LEVEL === 'debug') {
      this.write('debug', message, meta);
    }
  }

  /**
   * Retrieves the most recent log lines from the process log file
   */
  public getRecentLogs(maxLines: number = 30): string[] {
    if (!existsSync(this.logFilePath)) return [];
    try {
      const content = readFileSync(this.logFilePath, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      return lines.slice(-maxLines);
    } catch {
      return [];
    }
  }

  public getLogPath(): string {
    return this.logFilePath;
  }
}

export const logger = new ProcessLogger();
