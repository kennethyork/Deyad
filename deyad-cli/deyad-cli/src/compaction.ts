/**
 * Conversation compaction — summarize older messages when history grows too large.
 *
 * Extracted from agent.ts for modularity and testability.
 */

import { stripToolMarkup } from './tools.js';
import type { OllamaMessage } from './ollama.js';

/** Maximum conversation size (chars) before compaction kicks in. ~32k tokens at ~4 chars/token. */
export const MAX_CONVERSATION_CHARS = 128_000;

/** Number of recent messages to keep when compacting conversation history. */
export const COMPACT_KEEP_RECENT = 10;

/**
 * Compact conversation history in-place when it exceeds {@link MAX_CONVERSATION_CHARS}.
 *
 * Older non-system messages are replaced with a single summary system message
 * while preserving the most recent {@link COMPACT_KEEP_RECENT} messages.
 */
export function compactConversation(messages: OllamaMessage[]): void {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (totalChars <= MAX_CONVERSATION_CHARS) return;

  let firstNonSystem = 0;
  while (firstNonSystem < messages.length && messages[firstNonSystem]?.role === 'system') {
    firstNonSystem++;
  }

  const nonSystemCount = messages.length - firstNonSystem;
  if (nonSystemCount <= COMPACT_KEEP_RECENT) return;

  const compactEnd = messages.length - COMPACT_KEEP_RECENT;
  const toSummarize = messages.slice(firstNonSystem, compactEnd);

  const summaryParts: string[] = [];
  for (const msg of toSummarize) {
    if (msg.role === 'assistant') {
      const prose = stripToolMarkup(msg.content).slice(0, 200);
      if (prose) summaryParts.push(`Agent: ${prose}`);
    } else if (msg.role === 'tool') {
      summaryParts.push(`Tool: ${msg.tool_name ?? 'unknown'} result`);
    } else if (msg.role === 'user' && msg.content.startsWith('<tool_result>')) {
      const toolNames = [...msg.content.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]);
      if (toolNames.length) summaryParts.push(`Tools: ${toolNames.join(', ')}`);
    } else if (msg.role === 'user') {
      summaryParts.push(`User: ${msg.content.slice(0, 200)}`);
    }
  }

  const summary = `[Earlier conversation compacted]\n${summaryParts.join('\n')}`;
  messages.splice(firstNonSystem, compactEnd - firstNonSystem, {
    role: 'system' as const,
    content: summary,
  });
}
