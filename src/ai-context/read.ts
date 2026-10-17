/** Reading saved exports: list folders, open one file through the access check, and find rows already saved. */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { AI_CONTEXT_DIR } from '../config.js';
import { LogEntry } from '../types.js';
import { LHUB, LhubHeader, readLhub, readLhubHeader } from './lhub.js';
import { SnapshotMeta, compact, snapshotParent, toPosix } from './model.js';

/**
 * Absolute path of an export folder given relative to baseDir. Errors name only the relative folder: tool results never
 * show where ai-context lives on disk.
 */
export function exportDir(snapshot: string, baseDir = AI_CONTEXT_DIR): string {
  const root = resolve(baseDir);
  const dir = resolve(root, snapshot);
  if (!dir.startsWith(root + sep) || !existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`Export folder not found inside ai-context/: ${snapshot}`);
  return dir;
}

/** Every .lhub file of an export folder, as paths relative to it (SUMMARY first). */
export function snapshotFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true }).map((f) => toPosix(String(f))).filter((f) => f.endsWith(LHUB))
    .sort((a, b) => Number(b === 'SUMMARY.lhub') - Number(a === 'SUMMARY.lhub') || a.localeCompare(b));
}

/** Every export folder under baseDir (finished or `_partial`), newest first, with its SUMMARY header when finished. */
export function listSnapshots(baseDir = AI_CONTEXT_DIR): Array<{ snapshot: string; header?: LhubHeader; partial: boolean; files: number }> {
  if (!existsSync(baseDir)) return [];
  const out: Array<{ snapshot: string; header?: LhubHeader; partial: boolean; files: number; at: number }> = [];
  for (const file of readdirSync(baseDir, { recursive: true }).map(String)) {
    const dir = join(baseDir, file);
    if (!/^\d{8}-\d{4}_\d{8}-\d{4}_/.test(file.split(sep).pop()!) || !statSync(dir).isDirectory()) continue;
    out.push({ snapshot: toPosix(file), header: summaryHeader(dir), partial: file.endsWith('_partial'), files: snapshotFiles(dir).length, at: statSync(dir).mtimeMs });
  }
  return out.sort((a, b) => b.at - a.at).map(({ at: _at, ...rest }) => rest);
}

function summaryHeader(dir: string): LhubHeader | undefined {
  const summary = join(dir, 'SUMMARY.lhub');
  try {
    return existsSync(summary) ? readLhubHeader(summary) : undefined;
  } catch {
    return undefined; // not readable
  }
}

/** The last decrypted file, kept for paging; released after CACHE_IDLE_MS so an idle MCP server holds no log text. */
let opened: { path: string; mtime: number; text: string } | undefined;
let release: ReturnType<typeof setTimeout> | undefined;
const CACHE_IDLE_MS = 5 * 60_000;

function keepOpened(path: string, mtime: number, read: () => string): string {
  if (opened?.path !== path || opened.mtime !== mtime) opened = { path, mtime, text: read() };
  clearTimeout(release);
  release = setTimeout(() => { opened = undefined; }, CACHE_IDLE_MS);
  release.unref?.(); // never keeps the process alive
  return opened.text;
}

/**
 * One file of an export folder: resolves both paths inside baseDir, asks `keyFor` for the organization key (the access
 * check, run on every call) and decrypts only that file. The last file read stays in memory for paging (see keepOpened).
 * `file` may omit the .lhub extension.
 */
export async function openSnapshot(snapshot: string, file: string | undefined, keyFor: (header: LhubHeader) => Promise<string>, baseDir = AI_CONTEXT_DIR): Promise<{ header: LhubHeader; text: string; file: string }> {
  const dir = exportDir(snapshot, baseDir);
  const name = (file || 'SUMMARY.lhub').replace(/(\.lhub)?$/i, LHUB);
  const path = resolve(dir, name);
  if (!path.startsWith(dir + sep)) throw new Error('file must be inside the export folder');
  if (!existsSync(path)) {
    const files = snapshotFiles(dir);
    throw new Error(`No file '${name}' in this export. Files: ${files.slice(0, 50).join(', ')}${files.length > 50 ? ` +${files.length - 50} more` : ''}`);
  }
  const header = readLhubHeader(path);
  const key = await keyFor(header);
  const text = keepOpened(path, statSync(path).mtimeMs, () => readLhub(path, key).text);
  return { header, text, file: toPosix(relative(dir, path)) };
}

const lineHash = (line: string) => createHash('sha1').update(line).digest('base64');

/**
 * Drops entries already saved by an earlier export of the same stream (any service/level), so overlapping scans
 * (14h→18h, then 16h→20h) only keep new rows. A row is a duplicate when its compact JSONL line is identical.
 * Only frames overlapping `window` are decrypted, and only line hashes are kept in memory.
 */
// ponytail: re-reads overlapping frames every window; keep a per-stream hash index if ai-context grows large.
export function dropExported(entries: LogEntry[], meta: SnapshotMeta, orgKey: string, window: { from: string; to: string } = meta, baseDir = AI_CONTEXT_DIR): { fresh: LogEntry[]; duplicates: number; seenIn: string[] } {
  const parent = snapshotParent(meta, baseDir);
  const range = { from: Date.parse(window.from), to: Date.parse(window.to) };
  const seen = new Set<string>();
  const seenIn: string[] = [];
  for (const name of existsSync(parent) ? readdirSync(parent) : []) {
    if (addSavedLines(join(parent, name, 'services'), orgKey, range, seen)) seenIn.push(name);
  }
  const fresh = seen.size ? entries.filter((entry) => !seen.has(lineHash(JSON.stringify(compact(entry))))) : entries;
  return { fresh, duplicates: entries.length - fresh.length, seenIn };
}

/** Adds the hash of every line saved under `services` within `range` to `seen`; true when any was found. */
function addSavedLines(services: string, orgKey: string, range: { from: number; to: number }, seen: Set<string>): boolean {
  if (!existsSync(services)) return false;
  let found = false;
  for (const file of readdirSync(services, { recursive: true }).map(String).filter((f) => f.endsWith(LHUB))) {
    try {
      for (const line of readLhub(join(services, file), orgKey, range).text.split('\n')) if (line) { seen.add(lineHash(line)); found = true; }
    } catch { /* another organization's key or an unreadable file */ }
  }
  return found;
}
