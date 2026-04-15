/**
 * Built-in tool handler implementations.
 *
 * Contains the switch-case dispatch for all 22 built-in tools.
 * Extracted from tools.ts for modularity.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { debugLog } from './debug.js';
import { parse as shellParse } from 'shell-quote';
import { memoryRead, memoryWrite, memoryList, memoryDelete } from './session.js';
import { executeBrowserAction } from './browser.js';
import { walkDir, globFiles, fuzzyFindBlock, simpleDiff } from './tool-utils.js';
import type { ToolCall, ToolResult, ToolCallbacks } from './tools.js';
import { MAX_READ_BYTES, MAX_CMD_CHARS } from './tools.js';

/**
 * Execute a built-in tool by name. Used to populate the tool registry.
 */
export async function executeBuiltinTool(
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
        if (content.length > MAX_READ_BYTES) {
          const headSize = Math.floor(MAX_READ_BYTES * 0.75);
          const tailSize = Math.min(10000, Math.floor(MAX_READ_BYTES * 0.125));
          const head = content.slice(0, headSize);
          const tail = content.slice(-tailSize);
          return { tool: call.name, success: true, output: head + `\n\n... (truncated ${Math.round(content.length / 1024)}KB file, showing first ${Math.round(headSize/1024)}KB + last ${Math.round(tailSize/1024)}KB) ...\n\n` + tail };
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
        let occurrences = content.split(oldStr).length - 1;
        let actualOldStr = oldStr;
        let fuzzyUsed = false;

        // Fuzzy fallback: if exact match fails, try line-level similarity matching
        if (occurrences === 0) {
          const match = fuzzyFindBlock(content, oldStr);
          if (match) {
            actualOldStr = match.text;
            fuzzyUsed = true;
            occurrences = 1;
          }
        }

        if (occurrences === 0) return { tool: call.name, success: false, output: 'old_string not found in file (exact and fuzzy match both failed).' };
        if (occurrences > 1) return { tool: call.name, success: false, output: `old_string found ${occurrences} times (must be unique).` };
        if (cb?.confirm) {
          const prompt = fuzzyUsed ? `Edit ${filePath}? (fuzzy match used)` : `Edit ${filePath}?`;
          const ok = await cb.confirm(prompt);
          if (!ok) return { tool: call.name, success: false, output: 'User declined.' };
        }
        const updated = content.replace(actualOldStr, newStr);
        if (cb?.onDiff) {
          cb.onDiff(filePath, simpleDiff(content, updated, filePath));
        }
        fs.writeFileSync(absPath, updated, 'utf-8');
        const msg = fuzzyUsed ? `Edited ${filePath} (fuzzy match applied)` : `Edited ${filePath}`;
        return { tool: call.name, success: true, output: msg, changedFiles: [filePath] };
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
          } catch (e) { debugLog('skip unreadable file %s: %s', file, (e as Error).message); }
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
          let parsed: ReturnType<typeof shellParse> = [];
          let isSimple = false;
          try {
            parsed = shellParse(command);
            isSimple = parsed.length > 0 && parsed.every((t) => typeof t === 'string');
          } catch (e) { debugLog('shell-parse fallback: %s', (e as Error).message); }
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
            : execFileSync('/bin/sh', ['-c', command], execOpts);
          const truncated = output.length > MAX_CMD_CHARS ? output.slice(0, MAX_CMD_CHARS) + `\n... (truncated at ${MAX_CMD_CHARS} chars)` : output;
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
          let occ = content.split(edit.old_string).length - 1;
          let actualOld = edit.old_string;
          if (occ === 0) {
            const match = fuzzyFindBlock(content, edit.old_string);
            if (match) { actualOld = match.text; occ = 1; }
          }
          if (occ === 0) { editResults.push(`${edit.path}: old_string not found`); continue; }
          if (occ > 1) { editResults.push(`${edit.path}: old_string found ${occ} times (must be unique)`); continue; }
          const updated = content.replace(actualOld, edit.new_string);
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
          const safeCount = Math.max(1, Math.min(isNaN(count) ? 10 : count, 50));
          const output = execFileSync('git', ['log', '--oneline', `-${safeCount}`], { cwd, encoding: 'utf-8', timeout: 10000 });
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
          execFileSync('git', ['add', '--', addPath], { cwd, encoding: 'utf-8', timeout: 10000 });
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
          const output = execFileSync('git', ['commit', '-m', msg, '--'], { cwd, encoding: 'utf-8', timeout: 10000 });
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

      case 'browser': {
        const action = call.params['action'];
        if (!action) return { tool: call.name, success: false, output: 'Missing "action" param. Use: navigate, screenshot, click, type, get_text, console, close' };
        const result = await executeBrowserAction(action, call.params, cwd);
        return { tool: call.name, success: result.success, output: result.output };
      }

      default:
        return { tool: call.name, success: false, output: `Unknown tool: ${call.name}` };
    }
  } catch (error) {
    return { tool: call.name, success: false, output: String(error) };
  }
}
