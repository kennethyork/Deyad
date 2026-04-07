/// <reference path="./minimatch.d.ts" />
/**
 * CLI agent tools — file I/O, shell execution, search, git, web fetch, memory.
 * Pure Node.js, no Electron dependencies.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { minimatch } from 'minimatch';

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

export const TOOLS_DESCRIPTION = `Available tools:
- list_files: list project files
- read_file: read a text file
- write_files: create or overwrite files
- edit_file: edit a file by replacing a unique substring
- delete_file: delete a file
- glob_files: find files by pattern
`;

export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const pattern = /<tool_call>\s*<name>([\s\S]*?)<\/name>([\s\S]*?)<\/tool_call>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
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
  return calls;
}

export function isDone(text: string): boolean {
  return /<done\s*\/?>(?:\s*)$/i.test(text) || /<done\s*\/?\s*>/i.test(text);
}

export function stripToolMarkup(text: string): string {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .replace(/<tool_result>[\s\S]*?<\/tool_result>/g, '')
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
        const filePath = call.params['path'];
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
          fs.writeFileSync(absPath, content, 'utf-8');
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
      default:
        return { tool: call.name, success: false, output: `Unknown tool: ${call.name}` };
    }
  } catch (error) {
    return { tool: call.name, success: false, output: String(error) };
  }
}
