/**
 * Agent helpers — extracted from agent.ts for modularity.
 *
 * Contains tool dispatch, result formatting, auto-lint, and parsing logic.
 * All exports are tested via agent.test.ts.
 */

import { parseToolCalls, isDone, stripToolMarkup, executeTool, getOllamaTools } from './tools.js';
import type { ToolResult, ToolCallbacks, ToolCall } from './tools.js';
import type { OllamaMessage, OllamaToolCall, OllamaTool } from './ollama.js';
import { runLint, formatLintErrors } from './lint.js';
import type { AgentCallbacks } from './agent.js';

// ── Constants ─────────────────────────────────────────────────────────────

/** Maximum characters per tool output before truncation. ~3K tokens. */
export const MAX_TOOL_OUTPUT_CHARS = 12_000;

/** Tools that only read data and can safely run in parallel. */
export const READ_ONLY_TOOLS = new Set([
  'list_files', 'read_file', 'search_files', 'glob_files', 'fetch_url',
  'git_status', 'git_log', 'git_diff', 'git_branch',
  'memory_read', 'memory_list',
]);

/** Browser actions that are read-only (vs click/type which mutate state). */
export const BROWSER_READ_ONLY_ACTIONS = new Set(['navigate', 'screenshot', 'get_text', 'console', 'close']);

/** Tools that modify files/state and must run sequentially. */
export const WRITE_TOOLS = new Set([
  'write_files', 'edit_file', 'delete_file', 'multi_edit',
  'run_command', 'git_add', 'git_commit', 'git_stash',
]);

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Parse tool calls from a model turn.
 * Prefers native function-calling format; falls back to XML/Qwen-format parsing.
 */
export function parseToolCallsFromTurn(
  nativeToolCalls: OllamaToolCall[],
  turnResponse: string,
  turnThinking: string,
): { toolCalls: ToolCall[]; usedNativeTools: boolean } {
  if (nativeToolCalls.length > 0) {
    const toolCalls = nativeToolCalls.map((tc) => ({
      name: tc.function.name.replace(/<[^>]*>?/g, '').replace(/[^a-zA-Z0-9_-]/g, '').trim(),
      params: Object.fromEntries(
        Object.entries(tc.function.arguments).map(([k, v]) => [k, String(v)]),
      ),
    }));
    return { toolCalls, usedNativeTools: true };
  }
  const combined = turnThinking ? turnThinking + '\n' + turnResponse : turnResponse;
  return { toolCalls: parseToolCalls(combined), usedNativeTools: false };
}

/**
 * Dispatch tool calls — runs read-only tools in parallel, write tools sequentially.
 */
export async function dispatchTools(
  toolCalls: ToolCall[],
  cwd: string,
  toolCb: ToolCallbacks,
  callbacks: Pick<AgentCallbacks, 'onToolStart' | 'onToolResult'>,
  changedFiles: string[],
  signal: AbortSignal,
): Promise<{ results: ToolResult[]; filesChanged: boolean }> {
  let results: ToolResult[] = [];
  let filesChanged = false;

  /** Check if a tool call is read-only (browser depends on action param). */
  const isReadOnly = (call: ToolCall): boolean => {
    if (call.name === 'browser') return BROWSER_READ_ONLY_ACTIONS.has(call.params['action'] ?? '');
    return READ_ONLY_TOOLS.has(call.name);
  };

  // Split into read-only and write groups for optimal dispatch:
  // reads run in parallel first, then writes run sequentially.
  const readCalls = toolCalls.filter(isReadOnly);
  const writeCalls = toolCalls.filter(c => !isReadOnly(c));

  // Phase 1: dispatch all read-only tools in parallel
  if (readCalls.length > 0) {
    for (const call of readCalls) callbacks.onToolStart(call.name, call.params);
    const readResults = await Promise.all(readCalls.map((call) => executeTool(call, cwd, toolCb)));
    for (const r of readResults) {
      callbacks.onToolResult(r);
      results.push(r);
      if (r.changedFiles) {
        for (const f of r.changedFiles) {
          if (!changedFiles.includes(f)) changedFiles.push(f);
        }
      }
    }
  }

  // Phase 2: dispatch write tools sequentially
  for (const call of writeCalls) {
    if (signal.aborted) break;
    callbacks.onToolStart(call.name, call.params);
    const r = await executeTool(call, cwd, toolCb);
    results.push(r);
    callbacks.onToolResult(r);
    if (r.changedFiles) {
      for (const f of r.changedFiles) {
        if (!changedFiles.includes(f)) changedFiles.push(f);
      }
    }
    if (WRITE_TOOLS.has(call.name) && r.success) filesChanged = true;
  }
  return { results, filesChanged };
}

/**
 * Run auto-lint on changed files and format errors as agent feedback.
 * Returns a lint message string if errors found, or null if clean.
 */
export function runAutoLint(
  cwd: string,
  changedFiles: string[],
  callbacks: Pick<AgentCallbacks, 'onToolStart' | 'onToolResult'>,
): string | null {
  const allChanged = [...changedFiles];
  const lintResults = runLint(cwd, allChanged);
  const lintMessage = formatLintErrors(lintResults);
  if (!lintMessage) return null;

  callbacks.onToolStart('auto_lint', { files: allChanged.join(', ') });
  const errorSummary = lintResults
    .filter((r) => r.hasErrors)
    .map((r) => `${r.linter}: errors found`)
    .join(', ');
  callbacks.onToolResult({ tool: 'auto_lint', success: false, output: errorSummary });
  return lintMessage;
}

/**
 * Format tool results into conversation messages (native tool or XML format).
 * Truncates output to prevent large tool results from consuming context.
 */
export function formatToolResultMessages(
  results: ToolResult[],
  usedNativeTools: boolean,
): OllamaMessage[] {
  if (usedNativeTools) {
    return results.map((r) => ({
      role: 'tool' as const,
      content: `[${r.success ? 'success' : 'error'}] ${truncateOutput(r.output)}`,
      tool_name: r.tool,
    }));
  }
  const resultsText = results
    .map(
      (r) =>
        `<tool_result>\n<name>${r.tool}</name>\n<status>${r.success ? 'success' : 'error'}</status>\n<output>\n${truncateOutput(r.output)}\n</output>\n</tool_result>`,
    )
    .join('\n\n');
  return [{ role: 'user' as const, content: resultsText }];
}

/**
 * Truncate tool output to stay within context budget.
 * Keeps the first and last portions so the model sees both the start and end.
 */
export function truncateOutput(output: string, max = MAX_TOOL_OUTPUT_CHARS): string {
  if (output.length <= max) return output;
  const keep = Math.floor((max - 80) / 2); // 80 chars for the truncation notice
  const head = output.slice(0, keep);
  const tail = output.slice(-keep);
  const omitted = output.length - keep * 2;
  return `${head}\n\n... [${omitted} chars truncated] ...\n\n${tail}`;
}

/** Check if text contains a <done/> signal. */
export { isDone, stripToolMarkup, getOllamaTools };
export type { OllamaTool };
