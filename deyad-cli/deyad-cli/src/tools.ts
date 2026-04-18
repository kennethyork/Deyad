/// <reference path="./minimatch.d.ts" />
/**
 * CLI agent tools — interfaces, parsing, registry, execution.
 *
 * Tool utility functions are in {@link ./tool-utils.ts}.
 * Built-in tool handlers are in {@link ./tool-handlers.ts}.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { OllamaTool } from './ollama.js';
import { isMCPTool, executeMCPTool, getMCPOllamaTools, getMCPToolsDescription } from './mcp.js';
import { executeBuiltinTool } from './tool-handlers.js';
import { debugLog } from './debug.js';

// Re-export utilities so existing consumers are not broken
export { walkDir, globFiles, fuzzyFindBlock, simpleDiff } from './tool-utils.js';

// ── Configurable limits ───────────────────────────────────────────────────────
/** Maximum file size in bytes before truncation in read_file. Override with DEYAD_MAX_READ env. */
export const MAX_READ_BYTES = parseInt(process.env['DEYAD_MAX_READ'] || '200000', 10);
/** Maximum characters of auto-lint output. Override with DEYAD_MAX_LINT env. */
export const MAX_LINT_CHARS = parseInt(process.env['DEYAD_MAX_LINT'] || '5000', 10);
/** Maximum characters of run_command output. Override with DEYAD_MAX_CMD env. */
export const MAX_CMD_CHARS = parseInt(process.env['DEYAD_MAX_CMD'] || '10000', 10);

// ── Rate limiting ─────────────────────────────────────────────────────────────
/** Maximum tool calls per minute (safety guard against infinite loops). */
const RATE_LIMIT_PER_MIN = parseInt(process.env['DEYAD_RATE_LIMIT'] || '120', 10);
const toolCallTimestamps: number[] = [];

/**
 * Check rate limit. Returns true if within limit, false if exceeded.
 */
export function checkRateLimit(): boolean {
  const now = Date.now();
  // Remove timestamps older than 1 minute
  while (toolCallTimestamps.length > 0 && toolCallTimestamps[0]! < now - 60_000) {
    toolCallTimestamps.shift();
  }
  if (toolCallTimestamps.length >= RATE_LIMIT_PER_MIN) return false;
  toolCallTimestamps.push(now);
  return true;
}

/** Reset rate limit state (for testing). */
export function resetRateLimit(): void {
  toolCallTimestamps.length = 0;
}

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
  onOutput?: (chunk: string) => void;
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

BROWSER:
- browser: headless browser automation. Params: action (navigate|screenshot|click|type|get_text|console|close), url (for navigate), selector (for click/type), text (for type)
` + getMCPToolsDescription();

export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];

  /** Sanitise a parsed tool name — strip XML artefacts from malformed model output. */
  const sanitizeName = (raw: string): string => raw.replace(/<[^>]*>?/g, '').replace(/[^a-zA-Z0-9_-]/g, '').trim();

  // ── Pre-process: repair truncated tool calls ──
  // Models sometimes output <tool_call>...<name>...</name>...<param>...</param> without closing </tool_call>.
  // Detect unclosed tool_call blocks and add the missing closing tag.
  let repaired = text;
  const openCount = (repaired.match(/<tool_call>/g) || []).length;
  const closeCount = (repaired.match(/<\/tool_call>/g) || []).length;
  if (openCount > closeCount) {
    for (let i = 0; i < openCount - closeCount; i++) {
      repaired += '\n</tool_call>';
    }
  }

  // Also repair unclosed <param> tags — model may truncate mid-param
  repaired = repaired.replace(/<param\s+name="([^"]*)">([\s\S]*?)(?=<(?:param|\/tool_call|tool_call|name)|$)/g,
    (full, pName, pValue) => {
      if (full.includes('</param>')) return full;
      return `<param name="${pName}">${pValue.trim()}</param>`;
    }
  );

  // Format 1: <tool_call><name>...</name><param name="...">...</param></tool_call>
  const pattern1 = /<tool_call>\s*<name>([\s\S]*?)<\/name>([\s\S]*?)<\/tool_call>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern1.exec(repaired)) !== null) {
    const name = sanitizeName(match[1]!);
    if (!name) continue;
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
  while ((match = pattern2.exec(repaired)) !== null) {
    const name = sanitizeName(match[1]!);
    if (!name) continue;
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
  while ((match = pattern3.exec(repaired)) !== null) {
    try {
      const parsed = JSON.parse(match[1]!.trim());
      if (parsed.name) {
        const name = sanitizeName(parsed.name);
        if (!name) continue;
        const params: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed.parameters ?? parsed.params ?? {})) {
          params[k] = String(v);
        }
        calls.push({ name, params });
      }
    } catch (e) { debugLog('tool call JSON parse failed: %s', (e as Error).message); }
  }

  // Format 4: <tool_call>{"name":"...","arguments":{...}}</tool_call> (JSON inside XML — qwen3 native)
  if (calls.length === 0) {
    const pattern4 = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
    while ((match = pattern4.exec(repaired)) !== null) {
      try {
        const parsed = JSON.parse(match[1]!.trim());
        const name = sanitizeName(parsed.name ?? parsed.function?.name ?? '');
        if (!name) continue;
        const args = parsed.arguments ?? parsed.parameters ?? parsed.params ?? parsed.function?.arguments ?? {};
        const params: Record<string, string> = {};
        for (const [k, v] of Object.entries(args)) {
          params[k] = typeof v === 'string' ? v : JSON.stringify(v);
        }
        calls.push({ name, params });
      } catch (e) { debugLog('tool call JSON-in-XML parse failed: %s', (e as Error).message); }
    }
  }

  // Format 5: bare JSON — {"name":"tool_name","arguments":{...}} with no XML wrapper at all
  // Only used as last resort; gated by known tool names to avoid false positives.
  if (calls.length === 0) {
    const KNOWN_TOOLS = new Set(toolRegistry.keys());
    const pattern5 = /\{\s*"(?:name|function)"\s*:\s*"([^"]+)"[\s\S]*?\}/g;
    while ((match = pattern5.exec(repaired)) !== null) {
      try {
        const parsed = JSON.parse(match[0]);
        const name = sanitizeName(parsed.name ?? parsed.function?.name ?? parsed.function ?? '');
        if (!name || !KNOWN_TOOLS.has(name)) continue;
        const args = parsed.arguments ?? parsed.parameters ?? parsed.params ?? parsed.function?.arguments ?? {};
        const params: Record<string, string> = {};
        for (const [k, v] of Object.entries(args)) {
          params[k] = typeof v === 'string' ? v : JSON.stringify(v);
        }
        calls.push({ name, params });
      } catch (e) { debugLog('bare JSON tool call parse failed: %s', (e as Error).message); }
    }
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

/** Best-effort structured audit log — appends to ~/.deyad/audit.log */
let auditDirCreated = false;
function auditLog(tool: string, params: Record<string, string>, result: ToolResult): void {
  try {
    const dir = path.join(process.env['HOME'] ?? '/tmp', '.deyad');
    if (!auditDirCreated) { fs.mkdirSync(dir, { recursive: true }); auditDirCreated = true; }
    const entry = {
      ts: new Date().toISOString(),
      tool,
      params: Object.fromEntries(
        Object.entries(params).map(([k, v]) => [k, v.length > 200 ? v.slice(0, 200) + '\u2026' : v]),
      ),
      success: result.success,
      outputLen: result.output.length,
    };
    fs.promises.appendFile(path.join(dir, 'audit.log'), JSON.stringify(entry) + '\n').catch(() => {});
  } catch (e) { debugLog('audit log write failed: %s', (e as Error).message); }
}

/* ---------- Tool result cache (per-session, read-only tools only) ---------- */
const CACHEABLE_TOOLS = new Set(['list_files', 'read_file', 'search_files', 'glob_files']);
const WRITE_TOOL_NAMES = new Set(['write_files', 'edit_file', 'delete_file', 'multi_edit', 'run_command']);
const CACHE_MAX = 128;
const CACHE_TTL_MS = 60_000; // 60 seconds
const toolCache = new Map<string, { result: ToolResult; ts: number }>();

function cacheKey(call: ToolCall): string {
  return `${call.name}::${JSON.stringify(call.params)}`;
}

/** Evict oldest entries when cache exceeds max size. */
function cacheEvict(): void {
  while (toolCache.size > CACHE_MAX) {
    const oldest = toolCache.keys().next().value;
    if (oldest !== undefined) toolCache.delete(oldest); else break;
  }
}

/** Clear the tool result cache (call after write operations). */
export function clearToolCache(): void { toolCache.clear(); }

export async function executeTool(
  call: ToolCall,
  cwd: string,
  cb?: ToolCallbacks,
): Promise<ToolResult> {
  if (!checkRateLimit()) {
    return { tool: call.name, success: false, output: 'Rate limit exceeded (too many tool calls per minute). Slow down.' };
  }
  const key = cacheKey(call);
  if (CACHEABLE_TOOLS.has(call.name)) {
    const cached = toolCache.get(key);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
      // Move to end for LRU
      toolCache.delete(key);
      toolCache.set(key, cached);
      return cached.result;
    }
    if (cached) toolCache.delete(key); // expired
  }
  const result = await executeToolInner(call, cwd, cb);
  auditLog(call.name, call.params, result);
  if (CACHEABLE_TOOLS.has(call.name) && result.success) {
    toolCache.set(key, { result, ts: Date.now() });
    cacheEvict();
  }
  if (WRITE_TOOL_NAMES.has(call.name) && result.success) {
    toolCache.clear();
  }
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
    // Check if it's an MCP tool
    if (isMCPTool(call.name)) {
      const result = await executeMCPTool(call.name, call.params);
      const toolResult: ToolResult = { tool: call.name, success: result.success, output: result.output };
      auditLog(call.name, call.params, toolResult);
      return toolResult;
    }
    return { tool: call.name, success: false, output: `Unknown tool: ${call.name}` };
  }
  try {
    return await handler(call, cwd, resolvedCwd, cb);
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
  'browser',
] as const;

for (const name of BUILTIN_NAMES) {
  toolRegistry.set(name, (call, cwd, resolvedCwd, cb) => executeBuiltinTool(call, cwd, resolvedCwd, cb));
}

// ── MCP tool handler — routes calls to external MCP servers ──
/** Register MCP tools discovered at startup. Call after initMCP(). */
export function registerMCPTools(): void {
  // MCP tools are handled via the toolRegistry fallback in executeToolInner.
  // This function exists to be called after initMCP() resolves.
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
    { type: 'function', function: { name: 'browser', description: 'Headless browser automation — navigate, screenshot, click, type, get page text, read console logs', parameters: { type: 'object', properties: { action: { type: 'string', description: 'Action to perform', enum: ['navigate', 'screenshot', 'click', 'type', 'get_text', 'console', 'close'] }, url: { type: 'string', description: 'URL (for navigate)' }, selector: { type: 'string', description: 'CSS selector (for click/type)' }, text: { type: 'string', description: 'Text to type (for type action)' } }, required: ['action'] } } },
    ...getMCPOllamaTools(),
  ];
}
