/**
 * Tests for compaction — conversation summarization and trimming.
 */
import { describe, it, expect } from 'vitest';
import { compactConversation, MAX_CONVERSATION_CHARS, COMPACT_KEEP_RECENT } from '../src/compaction.js';
import type { OllamaMessage } from '../src/ollama.js';

describe('compactConversation', () => {
  it('does nothing when total chars are below the threshold', () => {
    const msgs: OllamaMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const copy = [...msgs];
    compactConversation(msgs);
    expect(msgs).toEqual(copy);
  });

  it('compacts older messages when total exceeds threshold', () => {
    const msgs: OllamaMessage[] = [
      { role: 'system', content: 'sys' },
    ];
    // Add enough messages to exceed the threshold
    const bigContent = 'x'.repeat(Math.ceil(MAX_CONVERSATION_CHARS / 12));
    for (let i = 0; i < COMPACT_KEEP_RECENT + 5; i++) {
      msgs.push({ role: 'user', content: `user ${i} ${bigContent}` });
      msgs.push({ role: 'assistant', content: `asst ${i} ${bigContent}` });
    }
    const totalBefore = msgs.length;
    compactConversation(msgs);
    expect(msgs.length).toBeLessThan(totalBefore);
    // Should keep system + compacted summary + COMPACT_KEEP_RECENT recent messages
    expect(msgs[0]!.role).toBe('system');
    // A compacted message should exist
    const compactedMsg = msgs.find((m) => m.content.includes('[Earlier conversation compacted]'));
    expect(compactedMsg).toBeDefined();
  });

  it('does not compact if non-system count <= COMPACT_KEEP_RECENT', () => {
    const longStr = 'y'.repeat(MAX_CONVERSATION_CHARS + 1);
    const msgs: OllamaMessage[] = [
      { role: 'system', content: longStr },
      { role: 'user', content: 'hi' },
    ];
    const copy = [...msgs];
    compactConversation(msgs);
    expect(msgs.length).toBe(copy.length);
  });

  it('preserves tool message summaries', () => {
    const msgs: OllamaMessage[] = [
      { role: 'system', content: 'sys' },
    ];
    const big = 'z'.repeat(Math.ceil(MAX_CONVERSATION_CHARS / 10));
    msgs.push({ role: 'user', content: big });
    msgs.push({ role: 'tool', content: 'result', tool_name: 'read_file' });
    msgs.push({ role: 'user', content: `<tool_result><name>edit_file</name><output>ok</output></tool_result>${big}` });
    msgs.push({ role: 'assistant', content: `I edited the file. ${big}` });
    // Add COMPACT_KEEP_RECENT recent messages
    for (let i = 0; i < COMPACT_KEEP_RECENT; i++) {
      msgs.push({ role: 'user', content: `recent ${i} ${big}` });
    }
    compactConversation(msgs);
    const compacted = msgs.find((m) => m.content.includes('[Earlier conversation compacted]'));
    expect(compacted).toBeDefined();
    expect(compacted!.content).toContain('Tool: read_file result');
    expect(compacted!.content).toContain('Tools: edit_file');
  });

  it('exports constants with expected values', () => {
    expect(MAX_CONVERSATION_CHARS).toBe(128_000);
    expect(COMPACT_KEEP_RECENT).toBe(10);
  });
});
