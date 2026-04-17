/**
 * CLI agent loop — multi-turn conversation with Ollama + tool execution.
 *
 * The loop coordinates: system prompt → RAG context → streaming LLM call →
 * tool call parsing → tool dispatch → lint feedback → response formatting.
 *
 * Helpers extracted to {@link ./agent-helpers.ts} for modularity.
 */

import { streamChat } from './ollama.js';
import type { OllamaMessage, OllamaOptions } from './ollama.js';
import { TOOLS_DESCRIPTION, executeTool } from './tools.js';
import type { ToolCallbacks, ToolResult } from './tools.js';
import { queryIndex, formatRAGContext, invalidateIndex } from './rag.js';
import { compactConversation, resetCompactionIndex } from './compaction.js';
import { initMCP, closeMCP } from './mcp.js';
import { closeBrowser } from './browser.js';
import {
  parseToolCallsFromTurn, dispatchTools, runAutoLint, formatToolResultMessages,
  READ_ONLY_TOOLS, isDone, stripToolMarkup, getOllamaTools,
} from './agent-helpers.js';
import { debugLog } from './debug.js';

/** Strip <think>...</think> blocks from text so thinking never enters history. */
function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

// Re-export compaction symbols so existing consumers are not broken
export { compactConversation, MAX_CONVERSATION_CHARS, COMPACT_KEEP_RECENT, MAX_FULLHISTORY_ENTRIES, trimFullHistory, resetCompactionIndex } from './compaction.js';
// Re-export helpers so existing imports from agent.ts still work
export { parseToolCallsFromTurn, dispatchTools, runAutoLint, formatToolResultMessages, truncateOutput, READ_ONLY_TOOLS, WRITE_TOOLS } from './agent-helpers.js';

// ── Constants ──────────────────────────────────────────────────────────────

/** Maximum retries for nudging a non-acting model to use tools. */
const MAX_NUDGE_RETRIES = 3;

/** Escalating nudge messages to get the model to use tools. */
const NUDGE_MESSAGES = [
  'You MUST use tools. Do not explain — act. Start with list_files or read_file.',
  'STOP talking. Use a tool call RIGHT NOW. Example:\n<tool_call>\n<name>list_files</name>\n</tool_call>',
  'FINAL WARNING: Output a <tool_call> tag immediately or I will terminate this session.',
];

/** Maximum consecutive identical tool call sequences before forcing the model to stop. */
const MAX_REPEATED_TOOL_CALLS = 3;

function isActionableRequest(message: string): boolean {
  // Almost every user message to a coding agent implies action.
  // Only short greetings / "thanks" / pure questions with no imperative are non-actionable.
  const nonActionable = /^\s*(hi|hello|hey|thanks|thank you|ok|okay|sure|yes|no|bye|goodbye)\s*[.!?]?\s*$/i;
  if (nonActionable.test(message)) return false;
  if (message.split(/\s+/).length >= 4) return true;
  return /\b(create|write|edit|delete|install|run|execute|build|test|compile|deploy|generate|fix|update|add|remove|launch|open|serve|start|configure|analyze|find|check|review|scan|debug|refactor|optimize|migrate|convert|setup|implement|show|list|explain|read|fetch|get|search|examine|inspect|look|improve|make|change|move|rename|copy|merge|revert|undo|reset|clean|lint|format|validate|verify|ensure|tell|describe|help|solve|resolve|diagnose|identify|detect|monitor|profile|benchmark|measure|count|compare|diff|patch)\b/i.test(message);
}

/** Accumulated token usage across an agent session. */
export interface TokenStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Callbacks for the agent to communicate progress to the UI layer. */
export interface AgentCallbacks {
  onToken: (token: string) => void;
  onThinkingToken?: (token: string) => void;
  onToolStart: (toolName: string, params: Record<string, string>) => void;
  onToolResult: (result: ToolResult) => void;
  onToolOutput?: (chunk: string) => void;
  onDiff: (filePath: string, diff: string) => void;
  onDone: (summary: string) => void;
  onError: (error: string) => void;
  confirm: (question: string) => Promise<boolean>;
}

/** Result returned from a completed agent loop session. */
export interface AgentResult {
  history: OllamaMessage[];
  changedFiles: string[];
  stats: TokenStats;
}

function getSystemPrompt(cwd: string, hasHistory = false): string {
  const sessionNote = hasHistory
    ? '\nYou are resuming a previous session. Review the conversation history for context — don\'t repeat work already done.\n'
    : '';
  return `You are Deyad, an expert AI coding agent that builds, debugs, refactors, and explains code. Project: ${cwd}
${sessionNote}
${TOOLS_DESCRIPTION}

TOOL FORMAT (ALWAYS close every tag):
<tool_call>
<name>TOOL_NAME</name>
<param name="KEY">VALUE</param>
</tool_call>

RULES:
- Act immediately. Do NOT explain — just use tools. Keep prose replies short (1-3 sentences).
- ALWAYS close XML tags: </tool_call>, </param>, </name>.
- One tool call per <tool_call> block. Multiple blocks allowed.
- ALWAYS read_file before using edit_file. Never edit blind.
- For edit_file, include 3+ context lines in old_string. Prefer small edits over rewriting files.
- Only reference files, functions, and variables that you have confirmed exist via tools. Never guess.
- For complex tasks, plan your steps first, then execute them one by one.
- If a tool fails, diagnose the root cause from the error message. Try a different approach rather than repeating the same call.
- After completing the task, output <done/>.
`;
}

async function buildContext(cwd: string): Promise<string> {
  const listing = await executeTool({ name: 'list_files', params: {} }, cwd);
  const files = listing.output.split('\n').filter(Boolean);

  let context = `Project files (${files.length}):\n${listing.output}\n`;

  // Read project instructions if present
  const instructionFiles = ['DEYAD.md', '.deyad.md', 'deyad.md'];
  for (const instFile of instructionFiles) {
    if (files.includes(instFile)) {
      const result = await executeTool({ name: 'read_file', params: { path: instFile } }, cwd);
      if (result.success) {
        const content = result.output.length > 4000 ? result.output.slice(0, 4000) + '\n...' : result.output;
        context += `\n--- PROJECT INSTRUCTIONS (${instFile}) ---\nFollow these project-specific instructions:\n${content}\n--- END INSTRUCTIONS ---\n`;
      }
      break;
    }
  }

  const keyFiles = [
    'package.json', 'tsconfig.json',
    'Cargo.toml',
    'pyproject.toml', 'setup.py', 'requirements.txt',
    'go.mod',
    'pom.xml', 'build.gradle', 'build.gradle.kts',
    'Gemfile',
    'composer.json',
    'pubspec.yaml',
    'Package.swift',
    'CMakeLists.txt', 'Makefile',
    '.env', 'DEYAD.md',
  ];
  const presentFiles = keyFiles.filter(f => files.includes(f));
  const readResults = await Promise.all(
    presentFiles.map(f => executeTool({ name: 'read_file', params: { path: f } }, cwd).then(r => ({ file: f, ...r })))
  );
  for (const r of readResults) {
    if (r.success) {
      const content = r.output.length > 2000 ? r.output.slice(0, 2000) + '\n...' : r.output;
      context += `\n--- ${r.file} ---\n${content}\n`;
    }
  }
  return context;
}

/**
 * Run the multi-turn agent loop: stream LLM responses, parse + execute tool calls,
 * auto-lint changed files, and compact conversation when it grows too large.
 */
export async function runAgentLoop(
  model: string,
  userMessage: string | OllamaMessage,
  cwd: string,
  callbacks: AgentCallbacks,
  history: OllamaMessage[] = [],
  ollamaOptions?: OllamaOptions,
  think?: boolean,
  options?: {
    temperature?: number;
    contextSize?: number;
    ollamaHost?: string;
    maxIterations?: number;
    allowedTools?: string[];
    restrictedTools?: string[];
    numThread?: number;
    numGpu?: number;
    fullHistory?: OllamaMessage[];
    maxFullHistory?: number;
  },
): Promise<AgentResult> {
  const abortController = new AbortController();
  const changedFiles: string[] = [];
  const stats: TokenStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const sigHandler = () => { abortController.abort(); };
  process.on('SIGINT', sigHandler);
  process.on('SIGTERM', sigHandler);
  process.on('SIGHUP', sigHandler);

  // Use provided options or defaults
  const maxIterations = options?.maxIterations ?? 50;
  const allowedTools = options?.allowedTools ?? [];
  const restrictedTools = options?.restrictedTools ?? [];

  // Reset incremental compaction index for this loop session
  resetCompactionIndex();

  try {
    // Initialize MCP + build context in parallel (independent operations)
    const [, context] = await Promise.all([
      initMCP(cwd),
      buildContext(cwd),
    ]);

    // RAG: retrieve relevant codebase chunks for the user's query
    const userQuery = typeof userMessage === 'string' ? userMessage : userMessage.content;
    const ragResults = queryIndex(userQuery, cwd, 5);
    const ragContext = formatRAGContext(ragResults);

    const messages: OllamaMessage[] = [
      { role: 'system', content: getSystemPrompt(cwd, history.length > 0) },
      { role: 'system', content: `Project context:\n\n${context}${ragContext}` },
      ...history,
      typeof userMessage === 'string' ? { role: 'user', content: userMessage } : userMessage,
    ];

    // Apply Ollama options from config
    const ollamaOpts: OllamaOptions = {
      ...(ollamaOptions || {}),
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.contextSize !== undefined ? { num_ctx: options.contextSize } : {}),
      ...(options?.numThread !== undefined ? { num_thread: options.numThread } : {}),
      ...(options?.numGpu !== undefined ? { num_gpu: options.numGpu } : {}),
    };

    let iteration = 0;
    let hasPerformedAction = false;
    let lastToolCallSignature = '';
    let repeatedToolCallCount = 0;
    /** Track how many times each read-only tool has been called to detect weak-model looping. */
    const readOnlyToolCallCounts = new Map<string, number>();
    /** Maximum times a single read-only tool can be called before we force the model to stop. */
    const MAX_READONLY_TOOL_REPEATS = 5;

    while (!abortController.signal.aborted) {
      if (iteration >= maxIterations) {
        callbacks.onError(`Reached maximum iterations (${maxIterations}). Stopping.`);
        break;
      }
      compactConversation(messages, options?.contextSize, options?.fullHistory, options?.maxFullHistory);
      const nativeTools = getOllamaTools();
      // Filter tools based on allowed/restricted lists
      const filteredTools = nativeTools.filter(tool => {
        if (restrictedTools.length > 0 && restrictedTools.includes(tool.function.name)) {
          return false;
        }
        if (allowedTools.length > 0 && !allowedTools.includes(tool.function.name)) {
          return false;
        }
        return true;
      });
      // When think=true (default), think on iteration 0 (planning) but skip for
      // follow-ups to keep tool-result processing fast. think=false disables entirely.
      const iterThink = think === false ? false : (iteration === 0 ? (think ?? true) : false);
      let result;
      try {
        result = await streamChat(
          model,
          messages,
          callbacks.onToken,
          ollamaOpts,
          abortController.signal,
          callbacks.onThinkingToken,
          filteredTools,
          iterThink,
          options?.ollamaHost,
        );
      } catch (err: unknown) {
        const errMsg = String((err as Error).message || err);
        // If Ollama's native tool-call XML parser failed (500 + "XML syntax error"),
        // retry WITHOUT native tools — let the model output raw XML that we parse ourselves.
        if (/XML syntax error|xml.*unexpected/i.test(errMsg)) {
          try {
            result = await streamChat(
              model,
              messages,
              callbacks.onToken,
              ollamaOpts,
              abortController.signal,
              callbacks.onThinkingToken,
              undefined, // no native tools — fall back to text-based XML parsing
              iterThink,
              options?.ollamaHost,
            );
          } catch (retryErr: unknown) {
            const retryMsg = String((retryErr as Error).message || retryErr);
            callbacks.onError(`Ollama error (retry): ${retryMsg}`);
            if (iteration > 0) { iteration++; continue; }
            break;
          }
        } else {
          callbacks.onError(`Ollama error: ${errMsg}`);
          if (iteration > 0) { iteration++; continue; }
          break;
        }
      }
      if (abortController.signal.aborted) break;

      const turnResponse = result.content;
      const turnThinking = result.thinking || '';
      const nativeToolCalls = result.toolCalls || [];
      stats.promptTokens += result.usage.promptTokens;
      stats.completionTokens += result.usage.completionTokens;
      stats.totalTokens = stats.promptTokens + stats.completionTokens;

      // ── Parse tool calls ────────────────────────────────────────────
      const { toolCalls, usedNativeTools } = parseToolCallsFromTurn(
        nativeToolCalls, turnResponse, turnThinking,
      );

      // ── No tools → nudge or finish ─────────────────────────────────
      if (toolCalls.length === 0) {
        const userMessageText = typeof userMessage === 'string' ? userMessage : userMessage.content;
        if (isActionableRequest(userMessageText) && !hasPerformedAction && iteration < MAX_NUDGE_RETRIES) {
          messages.push({ role: 'assistant', content: stripThinkTags(turnResponse) });
          messages.push({
            role: 'user',
            content: NUDGE_MESSAGES[Math.min(iteration, NUDGE_MESSAGES.length - 1)]!,
          });
          iteration++;
          continue;
        }
        const summary = stripToolMarkup(turnResponse) || stripToolMarkup(turnThinking);
        callbacks.onDone(summary);
        messages.push({ role: 'assistant', content: stripThinkTags(turnResponse) });
        return { history: messages, changedFiles, stats };
      }

      // ── Detect repeated tool calls (weak model looping) ──────────
      const currentToolSig = toolCalls.map(tc => `${tc.name}:${JSON.stringify(tc.params)}`).join('|');
      const forceStop = (() => {
        // Exact duplicate detection
        if (currentToolSig === lastToolCallSignature) {
          repeatedToolCallCount++;
          if (repeatedToolCallCount >= MAX_REPEATED_TOOL_CALLS) return true;
        } else {
          lastToolCallSignature = currentToolSig;
          repeatedToolCallCount = 1;
        }
        // Per-tool read-only call count — catch models calling list_files with different params
        for (const tc of toolCalls) {
          if (READ_ONLY_TOOLS.has(tc.name)) {
            const cnt = (readOnlyToolCallCounts.get(tc.name) || 0) + 1;
            readOnlyToolCallCounts.set(tc.name, cnt);
            if (cnt >= MAX_READONLY_TOOL_REPEATS) return true;
          }
        }
        return false;
      })();

      if (forceStop) {
        messages.push({ role: 'assistant', content: stripThinkTags(turnResponse) });
        messages.push({
          role: 'user',
          content: 'You are repeating tool calls. Stop calling tools and give your final answer based on the information you already have.',
        });
        iteration++;
        lastToolCallSignature = '';
        repeatedToolCallCount = 0;
        continue;
      }

      // ── Push assistant message (never store thinking in history — saves context) ──
      if (usedNativeTools) {
        messages.push({ role: 'assistant', content: turnResponse, tool_calls: nativeToolCalls });
      } else {
        messages.push({ role: 'assistant', content: stripThinkTags(turnResponse) });
      }

      // ── Dispatch tools ──────────────────────────────────────────────
      const toolCb: ToolCallbacks = { confirm: callbacks.confirm, onDiff: callbacks.onDiff, onOutput: callbacks.onToolOutput };
      const { results, filesChanged } = await dispatchTools(
        toolCalls, cwd, toolCb, callbacks, changedFiles, abortController.signal,
      );
      hasPerformedAction = true;

      // ── Send tool results back ──────────────────────────────────────
      const resultMessages = formatToolResultMessages(results, usedNativeTools);

      // ── Post-write: refresh context + auto-lint ─────────────────────
      if (filesChanged) {
        invalidateIndex();
        // Only rebuild full context if key config files changed
        const KEY_CONFIG_FILES = ['package.json', 'tsconfig.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', 'pom.xml', 'build.gradle', 'Makefile'];
        const keyFileChanged = changedFiles.some(f => KEY_CONFIG_FILES.some(k => f.endsWith(k)));
        if (keyFileChanged) {
          try {
            const freshContext = await buildContext(cwd);
            const second = messages[1];
            if (messages.length > 1 && second?.role === 'system' && second.content.startsWith('Project context:')) {
              messages[1] = { role: 'system', content: `Project context:\n\n${freshContext}` };
            }
          } catch (e) { debugLog('context refresh failed: %s', (e as Error).message); }
        }

        const lintMsg = runAutoLint(cwd, changedFiles, callbacks);
        if (lintMsg) {
          // Push tool results FIRST so model knows what succeeded, then lint errors
          messages.push(...resultMessages);
          messages.push({ role: 'user' as const, content: lintMsg });
          iteration++;
          continue;
        }
      }

      if (!usedNativeTools) {
        if (isDone(turnResponse) || isDone(turnThinking)) {
          const summary = stripToolMarkup(turnResponse) || stripToolMarkup(turnThinking);
          callbacks.onDone(summary);
          messages.push(...resultMessages);
          return { history: messages, changedFiles, stats };
        }
      }

      messages.push(...resultMessages);
      iteration++;
    }

    return { history: messages, changedFiles, stats };
  } finally {
    closeBrowser();
    closeMCP();
    process.removeListener('SIGINT', sigHandler);
    process.removeListener('SIGTERM', sigHandler);
    process.removeListener('SIGHUP', sigHandler);
  }
}
