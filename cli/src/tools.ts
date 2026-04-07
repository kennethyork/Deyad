/**
 * CLI agent tools — file I/O, shell execution, search, git, web fetch, memory.
 * Pure Node.js, no Electron dependencies.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { minimatch } from 'minimatch';

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

// ── Ignore patterns (.gitignore-aware) ─────────────────────────────
const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.venv', 'venv', '.tox', 'target', '.gradle', 'vendor',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.zip',
  '.tar', '.gz', '.lock', '.pyc', '.class', '.o', '.so', '.dll',
]);

/** Parse .gitignore file and return an array of minimatch-compatible patterns. */
function parseGitignore(dir: string): string[] {
  const gitignorePath = path.join(dir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return [];
  try {
    return fs.readFileSync(gitignorePath, 'utf-8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
  } catch { return []; }
}

/** Check if a relative path matches any .gitignore pattern. */
function isGitignored(relPath: string, patterns: string[]): boolean {
  for (const pat of patterns) {
    // Negation patterns not supported for simplicity
    if (pat.startsWith('!')) continue;
    const p = pat.endsWith('/') ? pat + '**' : pat;
    if (minimatch(relPath, p, { dot: true }) || minimatch(relPath, '**/' + p, { dot: true })) {
      return true;
    }
  }
  return false;
}

/** Recursively list files in a directory, respecting .gitignore. */
export function walkDir(dir: string, root: string, results: string[] = [], gitignorePatterns?: string[]): string[] {
  // Load .gitignore patterns once from root
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

/** Match files by glob pattern. */
export function globFiles(pattern: string, cwd: string): string[] {
  const allFiles = walkDir(cwd, cwd);
  return allFiles.filter(f => minimatch(f, pattern, { dot: true }));
}

/** Execute a tool call against the local filesystem. */
async function executeToolRaw(
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
        // Block dangerous commands
        const BLOCKED_PATTERNS = [
          /\brm\s+(-[a-z]*f|-[a-z]*r).*\//i,
          /\bsudo\b/i,
          /\bmkfs\b/i,
          /\bdd\s+.*of=\/dev\//i,
          /\b(shutdown|reboot|halt|poweroff)\b/i,
          />\s*\/dev\/(sda|nvme|disk)/i,
          /\bcurl\b.*\|\s*(ba)?sh/i,
          /\bwget\b.*\|\s*(ba)?sh/i,
        ];
        if (BLOCKED_PATTERNS.some(p => p.test(cmd))) {
          return { tool: call.name, success: false, output: 'Command blocked: potentially destructive operation.' };
        }
        if (cb?.confirm) {
          const ok = await cb.confirm(`Run: ${cmd}`);
          if (!ok) return { tool: call.name, success: false, output: 'User declined.' };
        }
        return await runCommand(cmd, cwd);
      }

      case 'search_files': {
        const query = call.params.query;
        if (!query) return { tool: call.name, success: false, output: 'Missing "query" parameter.' };
        const isRegex = call.params.regex === 'true';
        const includeGlob = call.params.include || '';
        const files = includeGlob ? globFiles(includeGlob, cwd) : walkDir(cwd, cwd);
        let regex: RegExp;
        try {
          regex = isRegex ? new RegExp(query, 'i') : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        } catch {
          return { tool: call.name, success: false, output: `Invalid regex: ${query}` };
        }
        const matches: string[] = [];
        for (const rel of files) {
          // Match filename
          if (regex.test(rel)) {
            matches.push(rel);
            continue;
          }
          // Match content
          try {
            const content = fs.readFileSync(path.join(cwd, rel), 'utf-8');
            const lines = content.split('\n');
            const matchLines: string[] = [];
            for (let i = 0; i < lines.length && matchLines.length < 5; i++) {
              if (regex.test(lines[i])) {
                matchLines.push(`  L${i + 1}: ${lines[i].trim().slice(0, 120)}`);
              }
            }
            if (matchLines.length > 0) {
              matches.push(`${rel}\n${matchLines.join('\n')}`);
            }
          } catch { /* skip unreadable */ }
        }
        return {
          tool: call.name,
          success: true,
          output: matches.length > 0 ? matches.slice(0, 50).join('\n') : 'No matches found.',
        };
      }

      case 'glob_files': {
        const pattern = call.params.pattern;
        if (!pattern) return { tool: call.name, success: false, output: 'Missing "pattern" parameter.' };
        const matched = globFiles(pattern, cwd);
        return { tool: call.name, success: true, output: matched.length > 0 ? matched.join('\n') : 'No files matched.' };
      }

      case 'fetch_url': {
        const url = call.params.url;
        if (!url) return { tool: call.name, success: false, output: 'Missing "url" parameter.' };
        // Only allow http/https
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          return { tool: call.name, success: false, output: 'Only http:// and https:// URLs allowed.' };
        }
        // Block private/internal IPs (SSRF protection)
        try {
          const parsed = new URL(url);
          const host = parsed.hostname;
          if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|localhost|::1|\[::1\]|metadata\.google|169\.254\.)/i.test(host)) {
            return { tool: call.name, success: false, output: 'Blocked: private/internal addresses are not allowed.' };
          }
        } catch {
          return { tool: call.name, success: false, output: 'Invalid URL format.' };
        }
        if (cb?.confirm) {
          const ok = await cb.confirm(`Fetch URL: ${url}?`);
          if (!ok) return { tool: call.name, success: false, output: 'User declined.' };
        }
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15_000);
          const resp = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Deyad-CLI/1.0' },
          });
          clearTimeout(timeout);
          const text = await resp.text();
          // Strip HTML tags for readability
          const clean = text.replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          const truncated = clean.length > 8000 ? clean.slice(0, 8000) + '\n... (truncated)' : clean;
          return { tool: call.name, success: true, output: `[${resp.status}] ${truncated}` };
        } catch (err: unknown) {
          return { tool: call.name, success: false, output: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      case 'memory_read': {
        const memPath = path.join(cwd, 'DEYAD.md');
        if (!fs.existsSync(memPath)) return { tool: call.name, success: true, output: '(no DEYAD.md found — use memory_write to create one)' };
        const content = fs.readFileSync(memPath, 'utf-8');
        return { tool: call.name, success: true, output: content };
      }

      case 'memory_write': {
        const content = call.params.content;
        if (!content) return { tool: call.name, success: false, output: 'Missing "content" parameter.' };
        const memPath = path.join(cwd, 'DEYAD.md');
        fs.writeFileSync(memPath, content, 'utf-8');
        return { tool: call.name, success: true, output: 'Updated DEYAD.md', changedFiles: ['DEYAD.md'] };
      }

      case 'web_search': {
        const query = call.params.query;
        if (!query) return { tool: call.name, success: false, output: 'Missing "query" parameter.' };
        try {
          const encoded = encodeURIComponent(query);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15_000);
          // Use DuckDuckGo HTML search (no API key, privacy-respecting)
          const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Deyad-CLI/1.0',
              'Accept': 'text/html',
            },
          });
          clearTimeout(timeout);
          const html = await resp.text();
          // Parse search results from DuckDuckGo HTML
          const results: string[] = [];
          const resultPattern = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
          let match: RegExpExecArray | null;
          while ((match = resultPattern.exec(html)) !== null && results.length < 8) {
            const url = match[1].replace(/&amp;/g, '&');
            const title = match[2].replace(/<[^>]+>/g, '').trim();
            const snippet = match[3].replace(/<[^>]+>/g, '').trim();
            if (title && url) {
              results.push(`${title}\n  ${url}\n  ${snippet}`);
            }
          }
          // Fallback: try simpler pattern if the above didn't match
          if (results.length === 0) {
            const linkPattern = /<a[^>]+class="result__a"[^>]*>([\s\S]*?)<\/a>/gi;
            while ((match = linkPattern.exec(html)) !== null && results.length < 8) {
              const text = match[1].replace(/<[^>]+>/g, '').trim();
              if (text) results.push(text);
            }
          }
          if (results.length === 0) {
            // Final fallback: extract any useful text
            const stripped = html
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            const truncated = stripped.length > 3000 ? stripped.slice(0, 3000) + '...' : stripped;
            return { tool: call.name, success: true, output: `Search results for "${query}":\n${truncated}` };
          }
          return { tool: call.name, success: true, output: `Search results for "${query}":\n\n${results.join('\n\n')}` };
        } catch (err: unknown) {
          return { tool: call.name, success: false, output: `Search failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      case 'analyze_image': {
        const imagePath = call.params.path;
        const question = call.params.question || 'Describe this image in detail. What do you see?';
        if (!imagePath) return { tool: call.name, success: false, output: 'Missing "path" parameter.' };
        const absPath = path.resolve(cwd, imagePath);
        if (!absPath.startsWith(resolvedCwd)) return { tool: call.name, success: false, output: 'Path traversal not allowed.' };
        if (!fs.existsSync(absPath)) return { tool: call.name, success: false, output: `File not found: ${imagePath}` };
        const ext = path.extname(imagePath).toLowerCase();
        const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
        if (!imageExts.has(ext)) return { tool: call.name, success: false, output: `Not an image file: ${imagePath}. Supported: png, jpg, jpeg, gif, webp, bmp` };
        // Read image and convert to base64
        const imageBuffer = fs.readFileSync(absPath);
        const base64 = imageBuffer.toString('base64');
        // Check file size (limit to 10MB)
        if (imageBuffer.length > 10 * 1024 * 1024) {
          return { tool: call.name, success: false, output: 'Image too large (max 10MB).' };
        }
        try {
          const baseUrl = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
          // Find a vision model — try common vision model names
          const modelsResp = await fetch(`${baseUrl}/api/tags`);
          const modelsData = await modelsResp.json() as { models?: Array<{ name: string }> };
          const allModels = (modelsData.models || []).map(m => m.name);
          const visionPatterns = [/llava/i, /vision/i, /vl/i, /bakllava/i, /moondream/i, /minicpm.*v/i];
          let visionModel = allModels.find(m => visionPatterns.some(p => p.test(m)));
          if (!visionModel) {
            return { tool: call.name, success: false, output: `No vision model found in Ollama. Install one with: ollama pull qwen2.5-vl:7b\nAvailable models: ${allModels.join(', ')}` };
          }
          // Send image to vision model via Ollama API
          const chatResp = await fetch(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: visionModel,
              messages: [{ role: 'user', content: question, images: [base64] }],
              stream: false,
            }),
            signal: AbortSignal.timeout(60_000),
          });
          if (!chatResp.ok) {
            const errText = await chatResp.text().catch(() => '');
            return { tool: call.name, success: false, output: `Vision model error: ${chatResp.status} ${errText}` };
          }
          const chatData = await chatResp.json() as { message?: { content?: string } };
          const analysis = chatData.message?.content || '(no response from vision model)';
          return { tool: call.name, success: true, output: `[${visionModel}] ${analysis}` };
        } catch (err: unknown) {
          return { tool: call.name, success: false, output: `Image analysis failed: ${err instanceof Error ? err.message : String(err)}` };
        }
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

      case 'git_push': {
        if (cb?.confirm) {
          const ok = await cb.confirm('Push to remote?');
          if (!ok) return { tool: call.name, success: false, output: 'User declined.' };
        }
        return await runCommand('git push', cwd);
      }

      case 'git_pull': {
        return await runCommand('git pull', cwd);
      }

      case 'git_branch': {
        return await runCommand('git branch -a', cwd);
      }

      case 'git_branch_create': {
        const name = call.params.name;
        if (!name) return { tool: call.name, success: false, output: 'Missing "name" parameter.' };
        if (!/^[a-zA-Z0-9._\-/]+$/.test(name)) return { tool: call.name, success: false, output: 'Invalid branch name.' };
        return await runCommand(`git checkout -b ${name}`, cwd);
      }

      case 'git_branch_switch': {
        const name = call.params.name;
        if (!name) return { tool: call.name, success: false, output: 'Missing "name" parameter.' };
        if (!/^[a-zA-Z0-9._\-/]+$/.test(name)) return { tool: call.name, success: false, output: 'Invalid branch name.' };
        return await runCommand(`git checkout ${name}`, cwd);
      }

      case 'git_remote_get': {
        return await runCommand('git remote get-url origin 2>/dev/null || echo "No remote configured."', cwd);
      }

      case 'git_remote_set': {
        const url = call.params.url;
        if (!url) return { tool: call.name, success: false, output: 'Missing "url" parameter.' };
        if (cb?.confirm) {
          const ok = await cb.confirm(`Set remote origin to ${url}?`);
          if (!ok) return { tool: call.name, success: false, output: 'User declined.' };
        }
        const hasRemote = await runCommand('git remote get-url origin 2>/dev/null', cwd);
        const cmd = hasRemote.success ? `git remote set-url origin "${url.replace(/"/g, '\\"')}"` : `git remote add origin "${url.replace(/"/g, '\\"')}"`;
        return await runCommand(cmd, cwd);
      }

      case 'multi_edit': {
        const edits: Array<{ path: string; oldStr: string; newStr: string }> = [];
        for (let i = 0; i < 20; i++) {
          const p = call.params[`edit_${i}_path`];
          const o = call.params[`edit_${i}_old_string`];
          const n = call.params[`edit_${i}_new_string`];
          if (!p) break;
          if (o === undefined || n === undefined) {
            return { tool: call.name, success: false, output: `Edit ${i}: missing old_string or new_string.` };
          }
          edits.push({ path: p, oldStr: o, newStr: n });
        }
        if (edits.length === 0) {
          return { tool: call.name, success: false, output: 'No edits specified. Use edit_0_path, edit_0_old_string, edit_0_new_string, ...' };
        }
        if (cb?.confirm) {
          const paths = [...new Set(edits.map(e => e.path))];
          const ok = await cb.confirm(`Multi-edit ${edits.length} changes across ${paths.length} file(s): ${paths.join(', ')}?`);
          if (!ok) return { tool: call.name, success: false, output: 'User declined.' };
        }
        const writeMap: Record<string, string> = {};
        const results: string[] = [];
        let hasError = false;
        const allChangedFiles: string[] = [];
        for (let i = 0; i < edits.length; i++) {
          const { path: fp, oldStr: o, newStr: n } = edits[i];
          const absPath = path.resolve(cwd, fp);
          if (!absPath.startsWith(resolvedCwd)) {
            results.push(`Edit ${i} (${fp}): FAILED — path traversal not allowed`);
            hasError = true;
            continue;
          }
          // Use already-modified version if we edited this file earlier in the batch
          let content = writeMap[fp];
          if (content === undefined) {
            if (!fs.existsSync(absPath)) {
              results.push(`Edit ${i} (${fp}): FAILED — file not found`);
              hasError = true;
              continue;
            }
            content = fs.readFileSync(absPath, 'utf-8');
          }
          const occurrences = content.split(o).length - 1;
          if (occurrences === 0) {
            results.push(`Edit ${i} (${fp}): FAILED — old_string not found`);
            hasError = true;
            continue;
          }
          if (occurrences > 1) {
            results.push(`Edit ${i} (${fp}): FAILED — old_string found ${occurrences} times (must be unique)`);
            hasError = true;
            continue;
          }
          writeMap[fp] = content.replace(o, n);
          results.push(`Edit ${i} (${fp}): OK`);
          if (!allChangedFiles.includes(fp)) allChangedFiles.push(fp);
        }
        // Write all modified files
        for (const [fp, content] of Object.entries(writeMap)) {
          const absPath = path.resolve(cwd, fp);
          if (cb?.onDiff) {
            const old = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf-8') : '';
            cb.onDiff(fp, simpleDiff(old, content, fp));
          }
          fs.mkdirSync(path.dirname(absPath), { recursive: true });
          fs.writeFileSync(absPath, content, 'utf-8');
        }
        const editedCount = results.filter(r => r.includes(': OK')).length;
        return {
          tool: call.name,
          success: !hasError,
          output: `Applied ${editedCount}/${edits.length} edits:\n${results.join('\n')}`,
          changedFiles: allChangedFiles,
        };
      }

      case 'install_package': {
        const pkg = call.params.package;
        if (!pkg) return { tool: call.name, success: false, output: 'Missing "package" parameter.' };
        if (!/^[@a-zA-Z0-9._\-/]+$/.test(pkg)) {
          return { tool: call.name, success: false, output: 'Invalid package name: only alphanumeric, @, ., _, -, / characters are allowed.' };
        }
        const isDev = call.params.dev === 'true';
        const manager = call.params.manager || 'npm';
        if (cb?.confirm) {
          const ok = await cb.confirm(`Install ${pkg} via ${manager}${isDev ? ' (dev)' : ''}?`);
          if (!ok) return { tool: call.name, success: false, output: 'User declined.' };
        }
        let cmd: string;
        if (manager === 'npm') {
          cmd = `npm install ${isDev ? '-D ' : ''}${pkg}`;
        } else if (manager === 'pip') {
          cmd = `pip install ${pkg}`;
        } else if (manager === 'go') {
          cmd = `go get ${pkg}`;
        } else {
          cmd = `npm install ${pkg}`;
        }
        return await runCommand(cmd, cwd);
      }

      default:
        return { tool: call.name, success: false, output: `Unknown tool: ${call.name}` };
    }
  } catch (err: unknown) {
    return { tool: call.name, success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Best-effort structured audit log for tool executions. */
function auditLog(tool: string, params: Record<string, string>, result: ToolResult, cwd: string): void {
  try {
    const entry = {
      ts: new Date().toISOString(),
      tool,
      params: Object.fromEntries(
        Object.entries(params).map(([k, v]) => [k, v.length > 200 ? v.slice(0, 200) + '\u2026' : v]),
      ),
      success: result.success,
      outputLen: result.output.length,
    };
    const logPath = path.join(cwd, '.deyad-audit.jsonl');
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch { /* best-effort */ }
}

/** Execute a tool call with audit logging. */
export async function executeTool(
  call: ToolCall,
  cwd: string,
  cb?: ToolCallbacks,
): Promise<ToolResult> {
  const result = await executeToolRaw(call, cwd, cb);
  auditLog(call.name, call.params, result, cwd);
  return result;
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

You may call MULTIPLE tools in a single message — they will be executed in parallel.

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
   Prefer edit_file over write_files when you only need to change a small part of a file.
   Include enough surrounding context in old_string so it matches exactly once.

5. **multi_edit** — Apply multiple surgical edits across one or more files in a single operation.
   <param name="edit_0_path">path/to/first/file</param>
   <param name="edit_0_old_string">exact text to find in first file</param>
   <param name="edit_0_new_string">replacement for first file</param>
   <param name="edit_1_path">path/to/second/file</param>
   <param name="edit_1_old_string">exact text to find in second file</param>
   <param name="edit_1_new_string">replacement for second file</param>
   Supports up to 20 edits. Edits to the same file are applied sequentially.
   Use this instead of multiple edit_file calls when you need to change several files at once.

6. **delete_file** — Delete a file.
   <param name="path">relative/path</param>

7. **run_command** — Run a shell command.
   <param name="command">npm test</param>

8. **search_files** — Search file names and contents (supports regex).
   <param name="query">search term or regex pattern</param>
   <param name="regex">true</param>  (optional, default false)
   <param name="include">**/*.ts</param>  (optional glob to filter files)

9. **glob_files** — Find files matching a glob pattern.
   <param name="pattern">src/**/*.ts</param>

10. **fetch_url** — Fetch content from a URL.
    <param name="url">https://example.com</param>

11. **install_package** — Install a package using npm, pip, or go.
    <param name="package">express</param>
    <param name="manager">npm</param>  (npm | pip | go, defaults to npm)
    <param name="dev">false</param>  (optional, npm only — install as devDependency)

12. **memory_read** — Read the project's DEYAD.md memory file. No parameters.

13. **memory_write** — Update the project's DEYAD.md memory file.
    <param name="content">full contents</param>

14. **git_status** — Show git status. No parameters.

15. **git_commit** — Stage all and commit.
    <param name="message">commit message</param>

16. **git_log** — Show recent commits. No parameters.

17. **git_diff** — Show full diff of uncommitted changes. No parameters.

18. **git_push** — Push commits to the remote repository. No parameters.

19. **git_pull** — Pull latest changes from the remote repository. No parameters.

20. **git_branch** — List all branches and show the current one. No parameters.

21. **git_branch_create** — Create a new branch and switch to it.
    <param name="name">feature-xyz</param>

22. **git_branch_switch** — Switch to an existing branch.
    <param name="name">main</param>

23. **git_remote_get** — Get the current remote origin URL. No parameters.

24. **git_remote_set** — Set the remote origin URL.
    <param name="url">https://github.com/user/repo.git</param>

25. **web_search** — Search the web using DuckDuckGo (no API key needed).
    <param name="query">how to implement OAuth2 in Express</param>
    Returns top search results with titles, URLs, and snippets.

26. **analyze_image** — Analyze an image file using an Ollama vision model (e.g. qwen2.5-vl, llava).
    <param name="path">screenshot.png</param>
    <param name="question">What UI elements are shown? Are there any layout issues?</param>
    The question param is optional — defaults to a general description.
    Requires a vision model installed in Ollama (e.g. ollama pull qwen2.5-vl:7b).

When the user asks for any git operation (push, pull, commit, branch, status, log, remote, etc.), use the dedicated git_* tools directly — do NOT use run_command with git.

After your tool calls, you will receive results in <tool_result> blocks.
When the task is complete, output <done/>.`;
