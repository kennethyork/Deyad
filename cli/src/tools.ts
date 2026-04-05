/**
 * CLI agent tools — file I/O, shell execution, search, git.
 * Pure Node.js, no Electron dependencies.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

export interface ToolCall {
  name: string;
  params: Record<string, string>;
}

export interface ToolResult {
  tool: string;
  success: boolean;
  output: string;
  /** Files changed by this tool call */
  changedFiles?: string[];
}

/** Callbacks for confirmation and diff display. */
export interface ToolCallbacks {
  confirm?: (question: string) => Promise<boolean>;
  onDiff?: (filePath: string, diff: string) => void;
}

/** Parse all <tool_call> blocks from an AI response. */
export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const pattern = /<tool_call>\s*<name>([\s\S]*?)<\/name>([\s\S]*?)<\/tool_call>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const name = match[1].trim();
    const body = match[2];
    const params: Record<string, string> = {};
    const paramPattern = /<param\s+name="([^"]+)">([\s\S]*?)<\/param>/g;
    let pm: RegExpExecArray | null;
    while ((pm = paramPattern.exec(body)) !== null) {
      params[pm[1].trim()] = pm[2];
    }
    calls.push({ name, params });
  }
  return calls;
}

/** Check whether the response contains a <done/> signal. */
export function isDone(text: string): boolean {
  return /<done\s*\/?>/.test(text);
}

/** Strip tool_call, tool_result, think, and done tags from response. */
export function stripToolMarkup(text: string): string {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .replace(/<tool_result>[\s\S]*?<\/tool_result>/g, '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<done\s*\/?>/g, '')
    .trim();
}

/** Compute a simple unified diff between two strings. */
export function simpleDiff(oldText: string, newText: string, filePath: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const hunks: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
  let i = 0, j = 0;
  let hasChanges = false;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++; j++;
      continue;
    }
    hasChanges = true;
    // Collect context before
    const ctxStart = Math.max(0, i - 2);
    for (let k = ctxStart; k < i; k++) hunks.push(` ${oldLines[k]}`);
    // Collect removed lines
    while (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
      hunks.push(`-${oldLines[i]}`);
      i++;
    }
    // Collect added lines
    while (j < newLines.length && (i >= oldLines.length || newLines[j] !== oldLines[i])) {
      hunks.push(`+${newLines[j]}`);
      j++;
    }
    // Context after
    const ctxEnd = Math.min(oldLines.length, i + 2);
    for (let k = i; k < ctxEnd && k < oldLines.length; k++) {
      if (j + (k - i) < newLines.length && oldLines[k] === newLines[j + (k - i)]) {
        hunks.push(` ${oldLines[k]}`);
      }
    }
  }
  return hasChanges ? hunks.join('\n') : '(no changes)';
}

// ── Ignore patterns ────────────────────────────────────────────────
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.venv', 'venv', '.tox', 'target', '.gradle', 'vendor',
]);

const IGNORE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.zip',
  '.tar', '.gz', '.lock', '.pyc', '.class', '.o', '.so', '.dll',
]);

/** Recursively list files in a directory. */
export function walkDir(dir: string, root: string, results: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name !== '.env') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, root, results);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (IGNORE_EXTENSIONS.has(ext)) continue;
      results.push(path.relative(root, full));
    }
  }
  return results;
}

/** Execute a tool call against the local filesystem. */
export async function executeTool(
  call: ToolCall,
  cwd: string,
  cb?: ToolCallbacks,
): Promise<ToolResult> {
  const resolvedCwd = path.resolve(cwd);
  try {
    switch (call.name) {
      case 'list_files': {
        const files = walkDir(cwd, cwd);
        return { tool: call.name, success: true, output: files.join('\n') || '(no files)' };
      }

      case 'read_file': {
        const filePath = call.params.path;
        if (!filePath) return { tool: call.name, success: false, output: 'Missing "path" parameter.' };
        const absPath = path.resolve(cwd, filePath);
        if (!absPath.startsWith(resolvedCwd)) return { tool: call.name, success: false, output: 'Path traversal not allowed.' };
        if (!fs.existsSync(absPath)) return { tool: call.name, success: false, output: `File not found: ${filePath}` };
        const content = fs.readFileSync(absPath, 'utf-8');
        if (content.length > 50000) {
          return { tool: call.name, success: true, output: content.slice(0, 50000) + '\n... (truncated, file too large)' };
        }
        return { tool: call.name, success: true, output: content };
      }

      case 'write_files': {
        const fileMap: Record<string, string> = {};
        if (call.params.path && call.params.content !== undefined) {
          fileMap[call.params.path] = call.params.content;
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
        for (const [rel, content] of Object.entries(fileMap)) {
          const absPath = path.resolve(cwd, rel);
          if (!absPath.startsWith(resolvedCwd)) continue;
          // Show diff
          if (fs.existsSync(absPath) && cb?.onDiff) {
            const oldContent = fs.readFileSync(absPath, 'utf-8');
            cb.onDiff(rel, simpleDiff(oldContent, content, rel));
          } else if (cb?.onDiff) {
            cb.onDiff(rel, `+++ b/${rel} (new file, ${content.split('\n').length} lines)`);
          }
          fs.mkdirSync(path.dirname(absPath), { recursive: true });
          fs.writeFileSync(absPath, content, 'utf-8');
        }
        return { tool: call.name, success: true, output: `Wrote ${paths.length} file(s): ${paths.join(', ')}`, changedFiles: paths };
      }

      case 'edit_file': {
        const filePath = call.params.path;
        const oldStr = call.params.old_string;
        const newStr = call.params.new_string;
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
        const filePath = call.params.path;
        if (!filePath) return { tool: call.name, success: false, output: 'Missing "path" parameter.' };
        const absPath = path.resolve(cwd, filePath);
        if (!absPath.startsWith(resolvedCwd)) return { tool: call.name, success: false, output: 'Path traversal not allowed.' };
        if (cb?.confirm) {
          const ok = await cb.confirm(`Delete ${filePath}?`);
          if (!ok) return { tool: call.name, success: false, output: 'User declined.' };
        }
        if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
        return { tool: call.name, success: true, output: `Deleted ${filePath}`, changedFiles: [filePath] };
      }

      case 'run_command': {
        const cmd = call.params.command;
        if (!cmd) return { tool: call.name, success: false, output: 'Missing "command" parameter.' };
        if (cb?.confirm) {
          const ok = await cb.confirm(`Run: ${cmd}`);
          if (!ok) return { tool: call.name, success: false, output: 'User declined.' };
        }
        return await runCommand(cmd, cwd);
      }

      case 'search_files': {
        const query = call.params.query;
        if (!query) return { tool: call.name, success: false, output: 'Missing "query" parameter.' };
        const files = walkDir(cwd, cwd);
        const lowerQ = query.toLowerCase();
        const matches: string[] = [];
        for (const rel of files) {
          if (rel.toLowerCase().includes(lowerQ)) {
            matches.push(rel);
            continue;
          }
          try {
            const content = fs.readFileSync(path.join(cwd, rel), 'utf-8');
            if (content.toLowerCase().includes(lowerQ)) {
              const lines = content.split('\n');
              const matchLines: string[] = [];
              for (let i = 0; i < lines.length && matchLines.length < 3; i++) {
                if (lines[i].toLowerCase().includes(lowerQ)) {
                  matchLines.push(`  L${i + 1}: ${lines[i].trim().slice(0, 120)}`);
                }
              }
              matches.push(`${rel}\n${matchLines.join('\n')}`);
            }
          } catch { /* skip unreadable */ }
        }
        return {
          tool: call.name,
          success: true,
          output: matches.length > 0 ? matches.join('\n') : 'No matches found.',
        };
      }

      case 'git_status': return await runCommand('git status --short', cwd);

      case 'git_commit': {
        const msg = call.params.message || 'Update files';
        if (cb?.confirm) {
          const ok = await cb.confirm(`Git commit: "${msg}"?`);
          if (!ok) return { tool: call.name, success: false, output: 'User declined.' };
        }
        return await runCommand(`git add -A && git commit -m "${msg.replace(/"/g, '\\"')}"`, cwd);
      }

      case 'git_log': return await runCommand('git log --oneline -10', cwd);
      case 'git_diff': return await runCommand('git diff', cwd);

      default:
        return { tool: call.name, success: false, output: `Unknown tool: ${call.name}` };
    }
  } catch (err: unknown) {
    return { tool: call.name, success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Run a shell command and return stdout/stderr. */
export function runCommand(cmd: string, cwd: string): Promise<ToolResult> {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-c', cmd], { cwd, env: { ...process.env } });
    let output = '';
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ tool: 'run_command', success: false, output: output + '\n(timed out after 30s)' });
    }, 30_000);

    child.stdout.on('data', (data: Buffer) => { output += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { output += data.toString(); });
    child.on('close', (code: number | null) => {
      clearTimeout(timeout);
      const truncated = output.length > 4000 ? output.slice(-4000) + '\n... (truncated)' : output;
      resolve({ tool: 'run_command', success: code === 0, output: truncated.trim() || '(no output)' });
    });
    child.on('error', (err: Error) => {
      clearTimeout(timeout);
      resolve({ tool: 'run_command', success: false, output: `Failed to run: ${err.message}` });
    });
  });
}

/** Tool descriptions for the system prompt. */
export const TOOLS_DESCRIPTION = `You have the following tools. Call them using XML:

<tool_call>
<name>tool_name</name>
<param name="key">value</param>
</tool_call>

Available tools:

1. **list_files** — List all files in the project. No parameters.

2. **read_file** — Read a file's contents.
   <param name="path">relative/path</param>

3. **write_files** — Write one or more files.
   Single: <param name="path">file.ts</param> <param name="content">...</param>
   Multiple: <param name="file_0_path">...</param> <param name="file_0_content">...</param>

4. **edit_file** — Replace an exact string in a file.
   <param name="path">file.ts</param>
   <param name="old_string">exact match</param>
   <param name="new_string">replacement</param>

5. **delete_file** — Delete a file.
   <param name="path">relative/path</param>

6. **run_command** — Run a shell command.
   <param name="command">npm test</param>

7. **search_files** — Search file names and contents.
   <param name="query">search term</param>

8. **git_status** — Show git status. No parameters.

9. **git_commit** — Stage all and commit.
   <param name="message">commit message</param>

10. **git_log** — Show recent commits. No parameters.

11. **git_diff** — Show full diff of uncommitted changes. No parameters.

When the task is complete, output <done/>.`;
