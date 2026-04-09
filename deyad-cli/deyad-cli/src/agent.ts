/**
 * CLI agent loop — multi-turn conversation with Ollama + tool execution.
 *
 * The loop coordinates: system prompt → RAG context → streaming LLM call →
 * tool call parsing → tool dispatch → lint feedback → response formatting.
 *
 * Key exported helpers (testable independently):
 * - {@link parseToolCallsFromTurn} — parse native or XML tool calls
 * - {@link dispatchTools} — parallel read-only / sequential write dispatch
 * - {@link runAutoLint} — lint changed files, format feedback
 * - {@link formatToolResultMessages} — format tool results for conversation
 */

import { streamChat } from './ollama.js';
import type { OllamaMessage, OllamaOptions, OllamaToolCall } from './ollama.js';
import { parseToolCalls, isDone, stripToolMarkup, executeTool, TOOLS_DESCRIPTION, getOllamaTools } from './tools.js';
import type { ToolResult, ToolCallbacks } from './tools.js';
import type { ToolCall } from './tools.js';
import { runLint, formatLintErrors } from './lint.js';
import { queryIndex, formatRAGContext, invalidateIndex } from './rag.js';
import { compactConversation } from './compaction.js';
import { initMCP, closeMCP } from './mcp.js';
import { closeBrowser } from './browser.js';

/** Strip <think>...</think> blocks from text so thinking never enters history. */
function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

// Re-export compaction symbols so existing consumers are not broken
export { compactConversation, MAX_CONVERSATION_CHARS, COMPACT_KEEP_RECENT } from './compaction.js';

// ── Documented constants ──────────────────────────────────────────────────

/** Maximum agent iterations to prevent infinite loops. */
const MAX_ITERATIONS = 50;

/** Maximum retries for nudging a non-acting model to use tools. */
const MAX_NUDGE_RETRIES = 2;

/** Maximum consecutive identical tool call sequences before forcing the model to stop. */
const MAX_REPEATED_TOOL_CALLS = 3;

/** Tools that only read data and can safely run in parallel. */
export const READ_ONLY_TOOLS = new Set([
  'list_files', 'read_file', 'search_files', 'glob_files', 'fetch_url',
  'git_status', 'git_log', 'git_diff', 'git_branch',
  'browser', // read-only browser actions (navigate, screenshot, get_text, console)
]);

/** Tools that modify files/state and must run sequentially. */
export const WRITE_TOOLS = new Set([
  'write_files', 'edit_file', 'delete_file', 'multi_edit',
  'run_command', 'git_add', 'git_commit', 'git_stash',
]);

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

// ── Extracted helpers (exported for unit testing) ─────────────────────────

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
      name: tc.function.name,
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
 * Tracks changed files and reports to callbacks.
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

  const allReadOnly = toolCalls.every((c) => READ_ONLY_TOOLS.has(c.name));
  if (allReadOnly && toolCalls.length > 1) {
    for (const call of toolCalls) callbacks.onToolStart(call.name, call.params);
    results = await Promise.all(toolCalls.map((call) => executeTool(call, cwd, toolCb)));
    for (const r of results) {
      callbacks.onToolResult(r);
      if (r.changedFiles) {
        for (const f of r.changedFiles) {
          if (!changedFiles.includes(f)) changedFiles.push(f);
        }
      }
    }
  } else {
    for (const call of toolCalls) {
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
 */
export function formatToolResultMessages(
  results: ToolResult[],
  usedNativeTools: boolean,
): OllamaMessage[] {
  if (usedNativeTools) {
    return results.map((r) => ({
      role: 'tool' as const,
      content: `[${r.success ? 'success' : 'error'}] ${r.output}`,
      tool_name: r.tool,
    }));
  }
  const resultsText = results
    .map(
      (r) =>
        `<tool_result>\n<name>${r.tool}</name>\n<status>${r.success ? 'success' : 'error'}</status>\n<output>\n${r.output}\n</output>\n</tool_result>`,
    )
    .join('\n\n');
  return [{ role: 'user' as const, content: resultsText }];
}

function getSystemPrompt(cwd: string): string {
  return `You are Deyad, an expert AI coding agent running in the user's terminal.
You have full access to their project at: ${cwd}
You can read, write, edit, and delete files, run shell commands, search code, manage git, and fetch URLs.

${TOOLS_DESCRIPTION}

TOOL CALL FORMAT — you MUST use this exact XML format:
<tool_call>
<name>TOOL_NAME</name>
<param name="KEY">VALUE</param>
</tool_call>

You can make multiple tool calls in a single response. Each must be wrapped in its own <tool_call> tags.

EXAMPLE — reading a file then editing it:
User: Fix the typo in README.md
Assistant: Let me check the file first.
<tool_call>
<name>read_file</name>
<param name="path">README.md</param>
</tool_call>
[After seeing the file content with "teh" on line 3]
I see the typo on line 3. Fixing it now.
<tool_call>
<name>edit_file</name>
<param name="path">README.md</param>
<param name="old_string">This is teh readme</param>
<param name="new_string">This is the readme</param>
</tool_call>

EXAMPLE — running a command:
User: What tests are failing?
Assistant:
<tool_call>
<name>run_command</name>
<param name="command">npm test 2>&1 | tail -40</param>
</tool_call>

THINKING APPROACH:
- Before acting, briefly reason about WHAT to do and WHY.
- Break complex tasks into small steps: explore → plan → implement → verify.
- If a tool call fails, read the error carefully. Common fixes: wrong file path, wrong old_string match, missing context lines.
- When unsure which file to edit, use list_files and search_files first.

ERROR RECOVERY:
- edit_file "no match" → Re-read the file, the content may have changed. Use more context lines.
- run_command fails → Check the error output. Try a different command or fix the issue.
- If stuck after 3 attempts on the same step, explain what's blocking you and ask the user.

WORKFLOW:
1. UNDERSTAND — Read relevant files and explore the project structure before making changes.
2. PLAN — Briefly state your approach (1-2 sentences max).
3. IMPLEMENT — Use tools to make changes. Prefer edit_file for targeted edits, write_files for new files.
4. VERIFY — After changes, run tests/linting/build commands to verify. Read modified files to confirm correctness.
5. ITERATE — If verification fails, diagnose and fix. Do not give up after one attempt.
6. COMPLETE — Write a brief summary of what you did, then output <done/>.

RULES:
- ALWAYS use tool calls for actions. Never describe what you would do without doing it.
- Do NOT output <done/> until the task is fully complete and verified.
- If you have not used any tools yet, you MUST use tools before outputting <done/>.
- For edit_file, include enough context in old_string to uniquely match (3+ lines).
- For run_command, prefer specific commands over interactive ones. Use non-interactive flags.
- When creating files, always include complete, working content — never use placeholders like "// TODO".
- If a tool fails, read the error, adjust your approach, and retry.
- Ask for confirmation only when truly ambiguous. Otherwise, take action.
`;
}

async function buildContext(cwd: string): Promise<string> {
  const { executeTool: exec } = await import('./tools.js');
  const listing = await exec({ name: 'list_files', params: {} }, cwd);
  const files = listing.output.split('\n').filter(Boolean);

  let context = `Project files (${files.length}):\n${listing.output}\n`;

  // Read project instructions if present
  const instructionFiles = ['DEYAD.md', '.deyad.md', 'deyad.md'];
  for (const instFile of instructionFiles) {
    if (files.includes(instFile)) {
      const result = await exec({ name: 'read_file', params: { path: instFile } }, cwd);
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
  for (const f of keyFiles) {
    if (files.includes(f)) {
      const result = await exec({ name: 'read_file', params: { path: f } }, cwd);
      if (result.success) {
        const content = result.output.length > 2000 ? result.output.slice(0, 2000) + '\n...' : result.output;
        context += `\n--- ${f} ---\n${content}\n`;
      }
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
): Promise<AgentResult> {
  const abortController = new AbortController();
  const changedFiles: string[] = [];
  const stats: TokenStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const sigHandler = () => { abortController.abort(); };
  process.on('SIGINT', sigHandler);
  process.on('SIGTERM', sigHandler);
  process.on('SIGHUP', sigHandler);

  try {
    // Initialize MCP servers (if configured)
    await initMCP(cwd);

    const context = await buildContext(cwd);

    // RAG: retrieve relevant codebase chunks for the user's query
    const userQuery = typeof userMessage === 'string' ? userMessage : userMessage.content;
    const ragResults = queryIndex(userQuery, cwd, 5);
    const ragContext = formatRAGContext(ragResults);

    const messages: OllamaMessage[] = [
      { role: 'system', content: getSystemPrompt(cwd) },
      { role: 'system', content: `Project context:\n\n${context}${ragContext}` },
      ...history,
      typeof userMessage === 'string' ? { role: 'user', content: userMessage } : userMessage,
    ];

    let iteration = 0;
    let hasPerformedAction = false;
    let lastToolCallSignature = '';
    let repeatedToolCallCount = 0;
    /** Track how many times each read-only tool has been called to detect weak-model looping. */
    const readOnlyToolCallCounts = new Map<string, number>();
    /** Maximum times a single read-only tool can be called before we force the model to stop. */
    const MAX_READONLY_TOOL_REPEATS = 5;

    while (!abortController.signal.aborted) {
      if (iteration >= MAX_ITERATIONS) {
        callbacks.onError(`Reached maximum iterations (${MAX_ITERATIONS}). Stopping.`);
        break;
      }
      compactConversation(messages);
      const nativeTools = getOllamaTools();
      let result;
      try {
        result = await streamChat(
          model,
          messages,
          callbacks.onToken,
          ollamaOptions,
          abortController.signal,
          callbacks.onThinkingToken,
          nativeTools,
        );
      } catch (err: unknown) {
        const errMsg = String((err as Error).message || err);
        callbacks.onError(`Ollama error: ${errMsg}`);
        if (iteration > 0) {
          iteration++;
          continue;
        }
        break;
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
            content: 'Your response did not contain any tool calls. You MUST use tools to take action. Start by reading relevant files.',
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
      const toolCb: ToolCallbacks = { confirm: callbacks.confirm, onDiff: callbacks.onDiff };
      const { results, filesChanged } = await dispatchTools(
        toolCalls, cwd, toolCb, callbacks, changedFiles, abortController.signal,
      );
      hasPerformedAction = true;

      // ── Post-write: refresh context + auto-lint ─────────────────────
      if (filesChanged) {
        invalidateIndex();
        try {
          const freshContext = await buildContext(cwd);
          const second = messages[1];
          if (messages.length > 1 && second?.role === 'system' && second.content.startsWith('Project context:')) {
            messages[1] = { role: 'system', content: `Project context:\n\n${freshContext}` };
          }
        } catch { /* ignore */ }

        const lintMsg = runAutoLint(cwd, changedFiles, callbacks);
        if (lintMsg) {
          messages.push({ role: 'user' as const, content: lintMsg });
          iteration++;
          continue;
        }
      }

      // ── Send tool results back ──────────────────────────────────────
      const resultMessages = formatToolResultMessages(results, usedNativeTools);

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
