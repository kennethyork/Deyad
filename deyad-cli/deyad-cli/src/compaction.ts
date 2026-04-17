/**
 * Conversation compaction — summarize older messages when history grows too large.
 *
 * Extracted from agent.ts for modularity and testability.
 * Produces rich summaries that preserve file paths, commands, outputs, and key decisions.
 */

import { stripToolMarkup } from './tools.js';
import type { OllamaMessage } from './ollama.js';

/** Default maximum conversation size (chars) before compaction kicks in.
 *  Overridden at runtime when contextSize is known — uses 75% of context window. */
export const MAX_CONVERSATION_CHARS = 64_000;

/** Number of recent messages to keep when compacting conversation history. */
export const COMPACT_KEEP_RECENT = 6;

/** Chars-per-token estimate used to derive compaction threshold from context size. */
const CHARS_PER_TOKEN = 4;

/** Max chars for the compacted summary itself (must fit in context with recent messages). */
const MAX_SUMMARY_CHARS = 24_000;

/** Default maximum number of entries to keep in fullHistory before trimming old ones. */
export const MAX_FULLHISTORY_ENTRIES = 500;

/**
 * Trim fullHistory in-place if it exceeds the cap.
 * Keeps the most recent entries.
 */
export function trimFullHistory(history: OllamaMessage[], max: number = MAX_FULLHISTORY_ENTRIES): void {
  if (history.length > max) {
    history.splice(0, history.length - max);
  }
}

/** Tracks how many fullHistory entries were covered by the last compaction summary. */
let lastCompactedIndex = 0;

/** Reset the incremental compaction index (call at the start of each agent loop). */
export function resetCompactionIndex(): void {
  lastCompactedIndex = 0;
}

/**
 * Extract structured details from tool call XML in assistant messages.
 */
function extractToolCalls(content: string): Array<{ tool: string; params: Record<string, string> }> {
  const calls: Array<{ tool: string; params: Record<string, string> }> = [];
  // Match <tool_call> blocks
  const toolCallRegex = /<tool_call>\s*\{?\s*"?name"?\s*:\s*"([^"]+)"[\s\S]*?<\/tool_call>/g;
  let match;
  while ((match = toolCallRegex.exec(content)) !== null) {
    const tool = match[1]!;
    const params: Record<string, string> = {};
    // Extract params from the block
    const block = match[0];
    const paramMatches = block.matchAll(/"(\w+)"\s*:\s*"([^"]*?)"/g);
    for (const pm of paramMatches) {
      if (pm[1] !== 'name') params[pm[1]!] = pm[2]!;
    }
    calls.push({ tool, params });
  }
  // Also match function-style: <function=name>{...}</function>
  const funcRegex = /<function=(\w+)>\s*\{([\s\S]*?)\}\s*<\/function>/g;
  while ((match = funcRegex.exec(content)) !== null) {
    const tool = match[1]!;
    const params: Record<string, string> = {};
    const paramMatches = match[2]!.matchAll(/"(\w+)"\s*:\s*"([^"]*?)"/g);
    for (const pm of paramMatches) {
      params[pm[1]!] = pm[2]!;
    }
    calls.push({ tool, params });
  }
  return calls;
}

/**
 * Extract tool results from user messages containing <tool_result> blocks.
 */
function extractToolResults(content: string): Array<{ tool: string; output: string; success: boolean }> {
  const results: Array<{ tool: string; output: string; success: boolean }> = [];
  const regex = /<tool_result>\s*<name>([^<]+)<\/name>\s*<status>(success|error)<\/status>\s*<output>([\s\S]*?)<\/output>\s*<\/tool_result>/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    results.push({
      tool: match[1]!,
      success: match[2] === 'success',
      output: match[3]!.trim(),
    });
  }
  return results;
}

/**
 * Build a rich summary from messages being compacted.
 * Preserves: file paths touched, commands run, key outputs, user requests, agent decisions.
 */
function buildRichSummary(toSummarize: OllamaMessage[]): string {
  const userRequests: string[] = [];
  const filesRead: Set<string> = new Set();
  const filesWritten: Set<string> = new Set();
  const commandsRun: Array<{ cmd: string; output: string }> = [];
  const decisions: string[] = [];
  const toolResults: Array<{ tool: string; output: string }> = [];

  for (const msg of toSummarize) {
    if (msg.role === 'user' && !msg.content.startsWith('<tool_result>')) {
      userRequests.push(msg.content.slice(0, 300));
    }

    if (msg.role === 'user' && msg.content.includes('<tool_result>')) {
      for (const r of extractToolResults(msg.content)) {
        if (r.tool === 'read_file') {
          // Output is file content — just note the length
          toolResults.push({ tool: r.tool, output: `(${r.output.length} chars)` });
        } else if (r.tool === 'run_command') {
          // Preserve command output (truncated)
          toolResults.push({ tool: r.tool, output: r.output.slice(0, 500) });
        } else if (r.tool === 'list_files' || r.tool === 'glob_files' || r.tool === 'search_files') {
          toolResults.push({ tool: r.tool, output: r.output.slice(0, 500) });
        } else {
          toolResults.push({ tool: r.tool, output: r.output.slice(0, 200) });
        }
      }
    }

    if (msg.role === 'tool') {
      toolResults.push({ tool: msg.tool_name ?? 'unknown', output: msg.content.slice(0, 200) });
    }

    if (msg.role === 'assistant') {
      // Extract tool calls for file/command tracking
      for (const tc of extractToolCalls(msg.content)) {
        if (tc.tool === 'read_file' && tc.params['path']) {
          filesRead.add(tc.params['path']);
        } else if ((tc.tool === 'write_files' || tc.tool === 'edit_file' || tc.tool === 'multi_edit') && tc.params['path']) {
          filesWritten.add(tc.params['path']);
        } else if (tc.tool === 'run_command' && tc.params['command']) {
          commandsRun.push({ cmd: tc.params['command'], output: '' });
        }
      }
      // Preserve agent reasoning (non-tool prose)
      const prose = stripToolMarkup(msg.content).trim();
      if (prose.length > 20) {
        decisions.push(prose.slice(0, 400));
      }
    }
  }

  // Fill in command outputs from tool results
  let cmdIdx = 0;
  for (const tr of toolResults) {
    if (tr.tool === 'run_command' && cmdIdx < commandsRun.length) {
      commandsRun[cmdIdx]!.output = tr.output;
      cmdIdx++;
    }
  }

  const parts: string[] = ['[Earlier conversation — detailed summary]'];

  if (userRequests.length > 0) {
    parts.push('\n## User Requests');
    for (const req of userRequests) parts.push(`- ${req}`);
  }

  if (filesRead.size > 0) {
    parts.push('\n## Files Read');
    for (const f of filesRead) parts.push(`- ${f}`);
  }

  if (filesWritten.size > 0) {
    parts.push('\n## Files Modified');
    for (const f of filesWritten) parts.push(`- ${f}`);
  }

  if (commandsRun.length > 0) {
    parts.push('\n## Commands Executed');
    for (const c of commandsRun) {
      parts.push(`- \`${c.cmd}\``);
      if (c.output) parts.push(`  Output: ${c.output.slice(0, 300)}`);
    }
  }

  if (decisions.length > 0) {
    parts.push('\n## Agent Reasoning');
    for (const d of decisions) parts.push(`- ${d}`);
  }

  // Join and enforce size limit
  let summary = parts.join('\n');
  if (summary.length > MAX_SUMMARY_CHARS) {
    summary = summary.slice(0, MAX_SUMMARY_CHARS) + '\n\n[...summary truncated]';
  }
  return summary;
}

/**
 * Compact conversation history in-place when it exceeds the size threshold.
 *
 * If `contextTokens` is provided the threshold is set to 75% of that context
 * window (in chars) so compaction fires before the model chokes.  Otherwise
 * the static {@link MAX_CONVERSATION_CHARS} fallback is used.
 *
 * When `fullHistory` is provided, the summary is built from the full uncompacted
 * history rather than the already-compacted messages, preserving maximum detail.
 *
 * Older non-system messages are replaced with a rich summary system message
 * while preserving the most recent {@link COMPACT_KEEP_RECENT} messages.
 */
export function compactConversation(messages: OllamaMessage[], contextTokens?: number, fullHistory?: OllamaMessage[], maxFullHistory?: number): void {
  const maxChars = contextTokens
    ? Math.floor(contextTokens * 0.75 * CHARS_PER_TOKEN)
    : MAX_CONVERSATION_CHARS;
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (totalChars <= maxChars) return;

  let firstNonSystem = 0;
  while (firstNonSystem < messages.length && messages[firstNonSystem]?.role === 'system') {
    firstNonSystem++;
  }

  const nonSystemCount = messages.length - firstNonSystem;
  if (nonSystemCount <= COMPACT_KEEP_RECENT) return;

  const compactEnd = messages.length - COMPACT_KEEP_RECENT;
  const toSummarize = messages.slice(firstNonSystem, compactEnd);

  // Find the existing summary (if any) from a prior compaction
  let existingSummary = '';
  for (let i = firstNonSystem; i < compactEnd; i++) {
    if (messages[i]!.role === 'system' && messages[i]!.content.startsWith('[Earlier conversation')) {
      existingSummary = messages[i]!.content;
      break;
    }
  }

  let summary: string;

  if (fullHistory && fullHistory.length > 0) {
    // Trim fullHistory if it's grown too large
    trimFullHistory(fullHistory, maxFullHistory);

    // Incremental: only summarize entries added since the last compaction
    const newEntries = fullHistory.slice(lastCompactedIndex).filter(
      m => m.role !== 'system' || !m.content.startsWith('[Earlier conversation'),
    );
    lastCompactedIndex = fullHistory.length;

    if (newEntries.length === 0 && existingSummary) {
      // Nothing new — keep existing summary
      summary = existingSummary;
    } else {
      const incrementalSummary = buildRichSummary(newEntries);
      if (existingSummary) {
        // Merge: existing summary + new incremental section
        const merged = existingSummary + '\n\n---\n\n[Continued]\n' + incrementalSummary.replace('[Earlier conversation — detailed summary]', '').trim();
        summary = merged.length > MAX_SUMMARY_CHARS
          ? merged.slice(0, MAX_SUMMARY_CHARS) + '\n\n[...summary truncated]'
          : merged;
      } else {
        summary = incrementalSummary;
      }
    }
  } else {
    summary = buildRichSummary(toSummarize);
  }

  messages.splice(firstNonSystem, compactEnd - firstNonSystem, {
    role: 'system' as const,
    content: summary,
  });
}
