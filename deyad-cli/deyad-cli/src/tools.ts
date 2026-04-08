/// <reference path="./minimatch.d.ts" />
/**
 * CLI agent tools — file I/O, shell execution, search, git, web fetch, memory.
 * Pure Node.js, no Electron dependencies.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { minimatch } from 'minimatch';
import { parse as shellParse } from 'shell-quote';
import { memoryRead, memoryWrite, memoryList, memoryDelete } from './session.js';
import type { OllamaTool } from './ollama.js';

export interface ToolCall {
  name: string;
  params: Record<string, string>;
}

export interface ToolResult {
  tool: string;
  success: boolean;
  output: string;
  changedFiles?: string[];
}

export interface ToolCallbacks {
  confirm?: (question: string) => Promise<boolean>;
  onDiff?: (filePath: string, diff: string) => void;
}

export type ToolHandler = (
  call: ToolCall,
  cwd: string,
  resolvedCwd: string,
  cb?: ToolCallbacks,
) => Promise<ToolResult>;

/** Extensible tool registry — add/override tools via toolRegistry.set('name', handler) */
export const toolRegistry = new Map<string, ToolHandler>();

export const TOOLS_DESCRIPTION = `Available tools (use <tool_call><name>TOOL</name><param name="KEY">VALUE</param></tool_call>):

FILE OPERATIONS:
- list_files: list all project files recursively
- read_file: read a text file. Params: path
- write_files: create or overwrite files. Params: path + content (single), or file_0_path + file_0_content, file_1_path + file_1_content, etc. (batch)
- edit_file: replace a unique substring in a file. Params: path, old_string, new_string
- multi_edit: make multiple edits to one or more files atomically. Params: edit_0_path + edit_0_old_string + edit_0_new_string, edit_1_path + ..., etc.
- delete_file: delete a file. Params: path
- glob_files: find files by glob pattern. Params: pattern

SEARCH:
- search_files: search file contents with regex or text. Params: query, pattern (optional glob), is_regex (optional, "true"/"false")

SHELL:
- run_command: execute a shell command. Params: command, timeout (optional, ms)

GIT:
- git_status: show working tree status
- git_log: show recent commits. Params: count (optional, default 10)
- git_diff: show unstaged changes. Params: path (optional)
- git_branch: list branches
- git_add: stage files. Params: path (default ".")
- git_commit: commit staged changes. Params: message
- git_stash: stash or pop changes. Params: action ("push" or "pop")

WEB:
- fetch_url: fetch a URL and return text content. Params: url

MEMORY:
- memory_read: read a persistent note. Params: key
- memory_write: save a persistent note (survives restarts). Params: key, value
- memory_list: list all saved memory keys
- memory_delete: delete a memory note. Params: key
`;

export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];

  // Format 1: <tool_call><name>...</name><param name="...">...</param></tool_call>
  const pattern1 = /<tool_call>\s*<name>([\s\S]*?)<\/name>([\s\S]*?)<\/tool_call>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern1.exec(text)) !== null) {
    const name = match[1]!.trim();
    const body = match[2] ?? '';
    const params: Record<string, string> = {};
    const paramPattern = /<param\s+name="([^"]+)">([\s\S]*?)<\/param>/g;
    let pm: RegExpExecArray | null;
    while ((pm = paramPattern.exec(body)) !== null) {
      params[pm[1]!.trim()] = pm[2] ?? '';
    }
    calls.push({ name, params });
  }

  // Format 2: <function=name><parameter=key>value</parameter></function>
  // (used by qwen and some other models)
  const pattern2 = /<function=([^>]+)>([\s\S]*?)<\/function>/g;
  while ((match = pattern2.exec(text)) !== null) {
    const name = match[1]!.trim();
    const body = match[2] ?? '';
    const params: Record<string, string> = {};
    const paramPattern2 = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/g;
    let pm: RegExpExecArray | null;
    while ((pm = paramPattern2.exec(body)) !== null) {
      params[pm[1]!.trim()] = (pm[2] ?? '').trim();
    }
    calls.push({ name, params });
  }

  // Format 3: ```tool_call\n{"name":"...","parameters":{...}}\n``` (JSON in code block)
  const pattern3 = /```tool_call\s*\n([\s\S]*?)\n\s*```/g;
  while ((match = pattern3.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]!.trim());
      if (parsed.name) {
        const params: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed.parameters ?? parsed.params ?? {})) {
          params[k] = String(v);
        }
        calls.push({ name: parsed.name, params });
      }
    } catch { /* ignore malformed JSON */ }
  }

  return calls;
}

export function isDone(text: string): boolean {
  return /<done\s*\/?>(?:\s*)$/i.test(text) || /<done\s*\/?\s*>/i.test(text);
}

export function stripToolMarkup(text: string): string {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .replace(/<tool_result>[\s\S]*?<\/tool_result>/g, '')
    .replace(/<function=[^>]*>[\s\S]*?<\/function>/g, '')
    .replace(/```tool_call\s*\n[\s\S]*?\n\s*```/g, '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<done\s*\/?>(?:\s*)/g, '')
    .trim();
}

export function simpleDiff(oldText: string, newText: string, filePath: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const hunks: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++; j++;
      continue;
    }
    const removed: string[] = [];
    const added: string[] = [];
    while (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
      removed.push(oldLines[i]!);
      i++;
    }
    while (j < newLines.length && (i >= oldLines.length || newLines[j] !== oldLines[i])) {
      added.push(newLines[j]!);
      j++;
    }
    for (const line of removed) hunks.push(`-${line}`);
    for (const line of added) hunks.push(`+${line}`);
  }
  return hunks.join('\n');
}

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.venv', 'venv', '.tox', 'target', '.gradle', 'vendor',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.zip',
  '.tar', '.gz', '.lock', '.pyc', '.class', '.o', '.so', '.dll',
]);

function parseGitignore(dir: string): string[] {
  const gitignorePath = path.join(dir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return [];
  try {
    return fs.readFileSync(gitignorePath, 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

function isGitignored(relPath: string, patterns: string[]): boolean {
  for (const pat of patterns) {
    if (pat.startsWith('!')) continue;
    const p = pat.endsWith('/') ? `${pat}**` : pat;
    if (minimatch(relPath, p, { dot: true }) || minimatch(`**/${relPath}`, p, { dot: true })) {
      return true;
    }
  }
  return false;
}

export function walkDir(dir: string, root: string, results: string[] = [], gitignorePatterns?: string[]): string[] {
  if (!gitignorePatterns) {
    gitignorePatterns = parseGitignore(root);
  }
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    if (DEFAULT_IGNORE_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.gitignore') continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (isGitignored(rel, gitignorePatterns)) continue;
    if (entry.isDirectory()) {
      walkDir(full, root, results, gitignorePatterns);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;
      results.push(rel);
    }
  }
  return results;
}

export function globFiles(pattern: string, cwd: string): string[] {
  const allFiles = walkDir(cwd, cwd);
  return allFiles.filter((file) => minimatch(file, pattern, { dot: true }));
}

/** Best-effort structured audit log — appends to ~/.deyad/audit.log */
function auditLog(tool: string, params: Record<string, string>, result: ToolResult): void {
  try {
    const dir = path.join(process.env['HOME'] ?? '/tmp', '.deyad');
    fs.mkdirSync(dir, { recursive: true });
    const entry = {
      ts: new Date().toISOString(),
      tool,
      params: Object.fromEntries(
        Object.entries(params).map(([k, v]) => [k, v.length > 200 ? v.slice(0, 200) + '\u2026' : v]),
      ),
      success: result.success,
      outputLen: result.output.length,
    };
    fs.appendFileSync(path.join(dir, 'audit.log'), JSON.stringify(entry) + '\n');
  } catch { /* best-effort */ }
}

export async function executeTool(
  call: ToolCall,
  cwd: string,
  cb?: ToolCallbacks,
): Promise<ToolResult> {
  const result = await executeToolInner(call, cwd, cb);
  auditLog(call.name, call.params, result);
  return result;
}

async function executeToolInner(
  call: ToolCall,
  cwd: string,
  cb?: ToolCallbacks,
): Promise<ToolResult> {
  const resolvedCwd = path.resolve(cwd);
  const handler = toolRegistry.get(call.name);
  if (!handler) {
    return { tool: call.name, success: false, output: `Unknown tool: ${call.name}` };
  }
  try {
    return await handler(call, cwd, resolvedCwd, cb);
  } catch (error) {
    return { tool: call.name, success: false, output: String(error) };
  }
}

/** Built-in tool implementations — used to populate the registry */
async function executeBuiltinTool(
  call: ToolCall,
  cwd: string,
  resolvedCwd: string,
  cb?: ToolCallbacks,
): Promise<ToolResult> {
  try {
    switch (call.name) {
      case 'list_files': {
        const files = walkDir(cwd, cwd);
        return { tool: call.name, success: true, output: files.join('\n') || '(no files)' };
      }
      case 'read_file': {
        const filePath = call.params['path'];
        if (!filePath) return { tool: call.name, success: false, output: 'Missing "path" parameter.' };
        const absPath = path.resolve(cwd, filePath);
        if (!absPath.startsWith(resolvedCwd)) return { tool: call.name, success: false, output: 'Path traversal not allowed.' };
        if (!fs.existsSync(absPath)) return { tool: call.name, success: false, output: `File not found: ${filePath}` };
        const content = fs.readFileSync(absPath, 'utf-8');
        if (content.length > 200000) {
          // Keep first 150KB + last 10KB so head and tail context are preserved
          const head = content.slice(0, 150000);
          const tail = content.slice(-10000);
          return { tool: call.name, success: true, output: head + '\n\n... (truncated ' + Math.round(content.length / 1024) + 'KB file) ...\n\n' + tail };
        }
        return { tool: call.name, success: true, output: content };
      }
      case 'write_files': {
        const fileMap: Record<string, string> = {};
        const explicitPath = call.params['path'];
        const explicitContent = call.params['content'];
        if (explicitPath && explicitContent !== undefined) {
          fileMap[explicitPath] = explicitContent;
        }
        for (let i = 0; i < 50; i++) {
          const p = call.params[`file_${i}_path`];
          const c = call.params[`file_${i}_content`];
          if (!p) break;
          fileMap[p] = c ?? '';
        }
        if (Object.keys(fileMap).length === 0) {
          return { tool: call.name, success: false, output: 'No files specified.' };
        }
        const paths = Object.keys(fileMap);
        if (cb?.confirm) {
          const ok = await cb.confirm(`Write ${paths.length} file(s): ${paths.join(', ')}?`);
          if (!ok) return { tool: call.name, success: false, output: 'User declined.' };
        }

        // Stage all writes to temp files first for atomicity
        const staged: Array<{ absPath: string; tmpPath: string; rel: string; content: string }> = [];
        try {
          for (const [rel, content] of Object.entries(fileMap)) {
            const absPath = path.resolve(cwd, rel);
            if (!absPath.startsWith(resolvedCwd)) continue;
            if (fs.existsSync(absPath) && cb?.onDiff) {
              const oldContent = fs.readFileSync(absPath, 'utf-8');
              cb.onDiff(rel, simpleDiff(oldContent, content, rel));
            } else if (cb?.onDiff) {
              cb.onDiff(rel, `+++ b/${rel} (new file, ${content.split('\n').length} lines)`);
            }
            fs.mkdirSync(path.dirname(absPath), { recursive: true });
            const tmpPath = absPath + '.deyad-tmp';
            fs.writeFileSync(tmpPath, content, 'utf-8');
            staged.push({ absPath, tmpPath, rel, content });
          }

          // All temp writes succeeded — atomically rename all
          for (const { absPath, tmpPath } of staged) {
            fs.renameSync(tmpPath, absPath);
          }
        } catch (err) {
          // Clean up any temp files on failure
          for (const { tmpPath } of staged) {
            try { fs.unlinkSync(tmpPath); } catch { /* already gone */ }
          }
          return { tool: call.name, success: false, output: `Atomic write failed: ${String(err)}` };
        }

        return { tool: call.name, success: true, output: `Wrote ${paths.length} file(s): ${paths.join(', ')}`, changedFiles: paths };
      }
      case 'edit_file': {
        const filePath = call.params['path'];
        const oldStr = call.params['old_string'];
        const newStr = call.params['new_string'];
        if (!filePath) return { tool: call.name, success: false, output: 'Missing "path" parameter.' };
        if (oldStr === undefined) return { tool: call.name, success: false, output: 'Missing "old_string" parameter.' };
        if (newStr === undefined) return { tool: call.name, success: false, output: 'Missing "new_string" parameter.' };
        const absPath = path.resolve(cwd, filePath);
        if (!absPath.startsWith(resolvedCwd)) return { tool: call.name, success: false, output: 'Path traversal not allowed.' };
        if (!fs.existsSync(absPath)) return { tool: call.name, success: false, output: `File not found: ${filePath}` };
        const content = fs.readFileSync(absPath, 'utf-8');
        const occurrences = content.split(oldStr).length - 1;
        if (occurrences === 0) return { tool: call.name, success: false, output: 'old_string not found in file.' };
        if (occurrences > 1) return { tool: call.name, success: false, output: `old_string found ${occurrences} times (must be unique).` };
        if (cb?.confirm) {
          const ok = await cb.confirm(`Edit ${filePath}?`);
          if (!ok) return { tool: call.name, success: false, output: 'User declined.' };
        }
        const updated = content.replace(oldStr, newStr);
        if (cb?.onDiff) {
          cb.onDiff(filePath, simpleDiff(content, updated, filePath));
        }
        fs.writeFileSync(absPath, updated, 'utf-8');
        return { tool: call.name, success: true, output: `Edited ${filePath}`, changedFiles: [filePath] };
      }
      case 'delete_file': {
        const filePath = call.params['path'];
        if (!filePath) return { tool: call.name, success: false, output: 'Missing "path" parameter.' };
        const absPath = path.resolve(cwd, filePath);
        if (!absPath.startsWith(resolvedCwd)) return { tool: call.name, success: false, output: 'Path traversal not allowed.' };
        if (!fs.existsSync(absPath)) return { tool: call.name, success: false, output: `File not found: ${filePath}` };
        if (cb?.confirm) {
          const ok = await cb.confirm(`Delete ${filePath}?`);
          if (!ok) return { tool: call.name, success: false, output: 'User declined.' };
        }
        fs.unlinkSync(absPath);
        return { tool: call.name, success: true, output: `Deleted ${filePath}`, changedFiles: [filePath] };
      }
      case 'glob_files': {
        const pattern = call.params['pattern'];
        if (!pattern) return { tool: call.name, success: false, output: 'Missing "pattern" parameter.' };
        const matched = globFiles(pattern, cwd);
        return { tool: call.name, success: true, output: matched.length > 0 ? matched.join('\n') : '(no matches)' };
      }
      case 'search_files': {
        const query = call.params['query'];
        if (!query) return { tool: call.name, success: false, output: 'Missing "query" parameter.' };
        const filePattern = call.params['pattern'] || '**/*';
        const isRegex = call.params['is_regex'] === 'true';
        const allFiles = globFiles(filePattern, cwd);
        const results: string[] = [];
        const MAX_RESULTS = 100;
        let regex: RegExp | null = null;
        if (isRegex) {
          try { regex = new RegExp(query, 'gi'); } catch { return { tool: call.name, success: false, output: `Invalid regex: ${query}` }; }
        }
        for (const file of allFiles) {
          if (results.length >= MAX_RESULTS) break;
          try {
            const absPath = path.resolve(cwd, file);
            const content = fs.readFileSync(absPath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (results.length >= MAX_RESULTS) break;
              const line = lines[i]!;
              const match = regex ? regex.test(line) : line.toLowerCase().includes(query.toLowerCase());
              if (regex) regex.lastIndex = 0;
              if (match) {
                results.push(`${file}:${i + 1}: ${line.slice(0, 200)}`);
              }
            }
          } catch { /* skip unreadable files */ }
        }
        return { tool: call.name, success: true, output: results.length > 0 ? results.join('\n') : '(no matches)' };
      }
      case 'run_command': {
        const command = call.params['command'];
        if (!command) return { tool: call.name, success: false, output: 'Missing "command" parameter.' };
        if (cb?.confirm) {
          const ok = await cb.confirm(`Run command: ${command}?`);
          if (!ok) return { tool: call.name, success: false, output: 'User declined.' };
        }
        const timeoutMs = parseInt(call.params['timeout'] || '30000', 10);
        try {
          // Parse command with shell-quote; use execFileSync for simple commands
          // to avoid shell injection, fall back to execSync for shell operators
          const parsed = shellParse(command);
          const isSimple = parsed.length > 0 && parsed.every((t) => typeof t === 'string');
          const execOpts = {
            cwd,
            encoding: 'utf-8' as const,
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024,
            stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, FORCE_COLOR: '0' },
          };
          const output = isSimple
            ? execFileSync((parsed as string[])[0]!, (parsed as string[]).slice(1), execOpts)
            : execSync(command, execOpts);
          const truncated = output.length > 10000 ? output.slice(0, 10000) + '\n... (truncated)' : output;
          return { tool: call.name, success: true, output: truncated || '(no output)' };
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string; status?: number; message?: string };
          const stdout = (e.stdout || '').slice(0, 5000);
          const stderr = (e.stderr || '').slice(0, 5000);
          const exitCode = e.status ?? 'unknown';
          return { tool: call.name, success: false, output: `Exit code: ${exitCode}\nstdout: ${stdout}\nstderr: ${stderr}`.trim() };
        }
      }
      case 'multi_edit': {
        const edits: Array<{ path: string; old_string: string; new_string: string }> = [];
        for (let i = 0; i < 50; i++) {
          const p = call.params[`edit_${i}_path`];
          const old = call.params[`edit_${i}_old_string`];
          const nw = call.params[`edit_${i}_new_string`];
          if (!p || old === undefined || nw === undefined) break;
          edits.push({ path: p, old_string: old, new_string: nw });
        }
        if (edits.length === 0) return { tool: call.name, success: false, output: 'No edits specified.' };
        const editPaths = [...new Set(edits.map((e) => e.path))];
        if (cb?.confirm) {
          const ok = await cb.confirm(`Apply ${edits.length} edit(s) to: ${editPaths.join(', ')}?`);
          if (!ok) return { tool: call.name, success: false, output: 'User declined.' };
        }
        const editResults: string[] = [];
        const editChangedFiles: string[] = [];
        for (const edit of edits) {
          const absPath = path.resolve(cwd, edit.path);
          if (!absPath.startsWith(resolvedCwd)) { editResults.push(`${edit.path}: path traversal blocked`); continue; }
          if (!fs.existsSync(absPath)) { editResults.push(`${edit.path}: file not found`); continue; }
          const content = fs.readFileSync(absPath, 'utf-8');
          const occ = content.split(edit.old_string).length - 1;
          if (occ === 0) { editResults.push(`${edit.path}: old_string not found`); continue; }
          if (occ > 1) { editResults.push(`${edit.path}: old_string found ${occ} times (must be unique)`); continue; }
          const updated = content.replace(edit.old_string, edit.new_string);
          if (cb?.onDiff) cb.onDiff(edit.path, simpleDiff(content, updated, edit.path));
          fs.writeFileSync(absPath, updated, 'utf-8');
          editResults.push(`${edit.path}: edited`);
          if (!editChangedFiles.includes(edit.path)) editChangedFiles.push(edit.path);
        }
        return { tool: call.name, success: true, output: editResults.join('\n'), changedFiles: editChangedFiles };
      }
      case 'git_status': {
        try {
          const output = execFileSync('git', ['status', '--short'], { cwd, encoding: 'utf-8', timeout: 10000 });
          return { tool: call.name, success: true, output: output || '(clean)' };
        } catch (err: unknown) {
          return { tool: call.name, success: false, output: String((err as Error).message) };
        }
      }
      case 'git_log': {
        const count = parseInt(call.params['count'] || '10', 10);
        try {
          const output = execFileSync('git', ['log', '--oneline', `-${Math.min(count, 50)}`], { cwd, encoding: 'utf-8', timeout: 10000 });
          return { tool: call.name, success: true, output: output || '(no commits)' };
        } catch (err: unknown) {
          return { tool: call.name, success: false, output: String((err as Error).message) };
        }
      }
      case 'git_diff': {
        const diffPath = call.params['path'] || '';
        try {
          const args = ['diff'];
          if (diffPath) args.push('--', diffPath);
          const output = execFileSync('git', args, { cwd, encoding: 'utf-8', timeout: 10000 });
          return { tool: call.name, success: true, output: output || '(no changes)' };
        } catch (err: unknown) {
          return { tool: call.name, success: false, output: String((err as Error).message) };
        }
      }
      case 'git_branch': {
        try {
          const output = execFileSync('git', ['branch', '-a'], { cwd, encoding: 'utf-8', timeout: 10000 });
          return { tool: call.name, success: true, output: output || '(no branches)' };
        } catch (err: unknown) {
          return { tool: call.name, success: false, output: String((err as Error).message) };
        }
      }
      case 'git_add': {
        const addPath = call.params['path'] || '.';
        try {
          execFileSync('git', ['add', addPath], { cwd, encoding: 'utf-8', timeout: 10000 });
          return { tool: call.name, success: true, output: `Staged: ${addPath}` };
        } catch (err: unknown) {
          return { tool: call.name, success: false, output: String((err as Error).message) };
        }
      }
      case 'git_commit': {
        const msg = call.params['message'];
        if (!msg) return { tool: call.name, success: false, output: 'Missing "message" parameter.' };
        if (cb?.confirm) {
          const ok = await cb.confirm(`Git commit: "${msg}"?`);
          if (!ok) return { tool: call.name, success: false, output: 'User declined.' };
        }
        try {
          const output = execFileSync('git', ['commit', '-m', msg], { cwd, encoding: 'utf-8', timeout: 10000 });
          return { tool: call.name, success: true, output };
        } catch (err: unknown) {
          return { tool: call.name, success: false, output: String((err as Error).message) };
        }
      }
      case 'git_stash': {
        const action = call.params['action'] === 'pop' ? 'pop' : 'push';
        try {
          const output = execFileSync('git', ['stash', action], { cwd, encoding: 'utf-8', timeout: 10000 });
          return { tool: call.name, success: true, output: output || `Stash ${action} done.` };
        } catch (err: unknown) {
          return { tool: call.name, success: false, output: String((err as Error).message) };
        }
      }
      case 'fetch_url': {
        const url = call.params['url'];
        if (!url) return { tool: call.name, success: false, output: 'Missing "url" parameter.' };
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return { tool: call.name, success: false, output: 'Invalid URL.' };
        }
        // SSRF protection: block private/internal IPs and non-HTTP schemes
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return { tool: call.name, success: false, output: 'Only HTTP(S) URLs are allowed.' };
        }
        const host = parsed.hostname.toLowerCase();
        if (
          host === 'localhost' ||
          host === '127.0.0.1' ||
          host === '[::1]' ||
          host.startsWith('10.') ||
          host.startsWith('192.168.') ||
          host.startsWith('172.') ||
          host.startsWith('169.254.') ||
          host.endsWith('.local') ||
          host === '0.0.0.0'
        ) {
          return { tool: call.name, success: false, output: 'Requests to private/internal addresses are blocked.' };
        }
        try {
          const resp = await fetch(url, {
            headers: { 'User-Agent': 'Deyad-CLI/0.1' },
            signal: AbortSignal.timeout(15000),
          });
          if (!resp.ok) return { tool: call.name, success: false, output: `HTTP ${resp.status}: ${resp.statusText}` };
          const text = await resp.text();
          // Strip HTML tags for cleaner output
          const cleaned = text.replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          const truncated = cleaned.length > 15000 ? cleaned.slice(0, 15000) + '\n... (truncated)' : cleaned;
          return { tool: call.name, success: true, output: truncated };
        } catch (err: unknown) {
          return { tool: call.name, success: false, output: String((err as Error).message) };
        }
      }

      // ── Memory tools ──
      case 'memory_read': {
        const key = call.params['key'];
        if (!key) return { tool: call.name, success: false, output: 'Missing "key" parameter.' };
        const value = memoryRead(key);
        if (value === null) return { tool: call.name, success: true, output: `No memory found for key: ${key}` };
        return { tool: call.name, success: true, output: value };
      }
      case 'memory_write': {
        const key = call.params['key'];
        const value = call.params['value'];
        if (!key || !value) return { tool: call.name, success: false, output: 'Missing "key" or "value" parameter.' };
        memoryWrite(key, value);
        return { tool: call.name, success: true, output: `Saved memory: ${key}` };
      }
      case 'memory_list': {
        const entries = memoryList();
        if (entries.length === 0) return { tool: call.name, success: true, output: 'No memory entries.' };
        const list = entries.map((e) => `${e.key}: ${e.value.slice(0, 100)}`).join('\n');
        return { tool: call.name, success: true, output: list };
      }
      case 'memory_delete': {
        const key = call.params['key'];
        if (!key) return { tool: call.name, success: false, output: 'Missing "key" parameter.' };
        const deleted = memoryDelete(key);
        return { tool: call.name, success: deleted, output: deleted ? `Deleted: ${key}` : `Not found: ${key}` };
      }

      default:
        return { tool: call.name, success: false, output: `Unknown tool: ${call.name}` };
    }
  } catch (error) {
    return { tool: call.name, success: false, output: String(error) };
  }
}

// ── Register built-in tools into the extensible registry ──
const BUILTIN_NAMES = [
  'list_files', 'read_file', 'write_files', 'edit_file', 'delete_file',
  'glob_files', 'search_files', 'run_command', 'multi_edit',
  'git_status', 'git_log', 'git_diff', 'git_branch', 'git_add', 'git_commit', 'git_stash',
  'fetch_url', 'memory_read', 'memory_write', 'memory_list', 'memory_delete',
] as const;

for (const name of BUILTIN_NAMES) {
  toolRegistry.set(name, (call, cwd, resolvedCwd, cb) => executeBuiltinTool(call, cwd, resolvedCwd, cb));
}

export function getOllamaTools(): OllamaTool[] {
  return [
    { type: 'function', function: { name: 'list_files', description: 'List all project files recursively', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'read_file', description: 'Read a text file', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to project root' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'write_files', description: 'Create or overwrite a file', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, content: { type: 'string', description: 'Full file content' } }, required: ['path', 'content'] } } },
    { type: 'function', function: { name: 'edit_file', description: 'Replace a unique substring in a file (include 3+ lines of context in old_string)', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, old_string: { type: 'string', description: 'Exact text to find (must match uniquely)' }, new_string: { type: 'string', description: 'Replacement text' } }, required: ['path', 'old_string', 'new_string'] } } },
    { type: 'function', function: { name: 'delete_file', description: 'Delete a file', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'glob_files', description: 'Find files by glob pattern', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Glob pattern (e.g. "src/**/*.ts")' } }, required: ['pattern'] } } },
    { type: 'function', function: { name: 'search_files', description: 'Search file contents with regex or text', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, pattern: { type: 'string', description: 'Glob pattern to filter files' }, is_regex: { type: 'string', description: '"true" for regex' } }, required: ['query'] } } },
    { type: 'function', function: { name: 'run_command', description: 'Execute a shell command', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Shell command to run' }, timeout: { type: 'string', description: 'Timeout in ms' } }, required: ['command'] } } },
    { type: 'function', function: { name: 'git_status', description: 'Show git working tree status', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'git_log', description: 'Show recent commits', parameters: { type: 'object', properties: { count: { type: 'string', description: 'Number of commits (default 10)' } } } } },
    { type: 'function', function: { name: 'git_diff', description: 'Show unstaged changes', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' } } } } },
    { type: 'function', function: { name: 'git_branch', description: 'List branches', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'git_add', description: 'Stage files', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Path to stage (default ".")' } } } } },
    { type: 'function', function: { name: 'git_commit', description: 'Commit staged changes', parameters: { type: 'object', properties: { message: { type: 'string', description: 'Commit message' } }, required: ['message'] } } },
    { type: 'function', function: { name: 'git_stash', description: 'Stash or pop changes', parameters: { type: 'object', properties: { action: { type: 'string', description: '"push" or "pop"' } }, required: ['action'] } } },
    { type: 'function', function: { name: 'fetch_url', description: 'Fetch a URL and return text content', parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL to fetch' } }, required: ['url'] } } },
    { type: 'function', function: { name: 'memory_read', description: 'Read a persistent note', parameters: { type: 'object', properties: { key: { type: 'string', description: 'Memory key' } }, required: ['key'] } } },
    { type: 'function', function: { name: 'memory_write', description: 'Save a persistent note', parameters: { type: 'object', properties: { key: { type: 'string', description: 'Memory key' }, value: { type: 'string', description: 'Value to store' } }, required: ['key', 'value'] } } },
    { type: 'function', function: { name: 'memory_list', description: 'List all memory keys', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'memory_delete', description: 'Delete a memory note', parameters: { type: 'object', properties: { key: { type: 'string', description: 'Memory key' } }, required: ['key'] } } },
  ];
}
