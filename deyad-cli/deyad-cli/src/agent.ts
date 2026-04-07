/**
 * CLI agent loop — multi-turn conversation with Ollama + tool execution.
 */

import { streamChat } from './ollama.js';
import type { OllamaMessage, OllamaOptions } from './ollama.js';
import { parseToolCalls, isDone, stripToolMarkup, executeTool, TOOLS_DESCRIPTION } from './tools.js';
import type { ToolResult, ToolCallbacks } from './tools.js';
import type { McpManager } from './mcp.js';
const MAX_CONVERSATION_CHARS = 128_000;

function isActionableRequest(message: string): boolean {
  // Almost every user message to a coding agent implies action.
  // Only short greetings / "thanks" / pure questions with no imperative are non-actionable.
  const nonActionable = /^\s*(hi|hello|hey|thanks|thank you|ok|okay|sure|yes|no|bye|goodbye)\s*[.!?]?\s*$/i;
  if (nonActionable.test(message)) return false;
  // If it's longer than a few words, assume it's actionable
  if (message.split(/\s+/).length >= 4) return true;
  return /\b(create|write|edit|delete|install|run|execute|build|test|compile|deploy|generate|fix|update|add|remove|launch|open|serve|start|configure|analyze|find|check|review|scan|debug|refactor|optimize|migrate|convert|setup|implement|show|list|explain|read|fetch|get|search|examine|inspect|look|improve|make|change|move|rename|copy|merge|revert|undo|reset|clean|lint|format|validate|verify|ensure|tell|describe|help|solve|resolve|diagnose|identify|detect|monitor|profile|benchmark|measure|count|compare|diff|patch)\b/i.test(message);
}

export interface TokenStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AgentCallbacks {
  onToken: (token: string) => void;
  onToolStart: (toolName: string, params: Record<string, string>) => void;
  onToolResult: (result: ToolResult) => void;
  onDiff: (filePath: string, diff: string) => void;
  onDone: (summary: string) => void;
  onError: (error: string) => void;
  confirm: (question: string) => Promise<boolean>;
}

export interface AgentResult {
  history: OllamaMessage[];
  changedFiles: string[];
  stats: TokenStats;
}

function compactConversation(messages: OllamaMessage[]): void {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (totalChars <= MAX_CONVERSATION_CHARS) return;

  let firstNonSystem = 0;
  while (firstNonSystem < messages.length && messages[firstNonSystem]?.role === 'system') {
    firstNonSystem++;
  }

  const keepRecent = 10;
  const nonSystemCount = messages.length - firstNonSystem;
  if (nonSystemCount <= keepRecent) return;

  const compactEnd = messages.length - keepRecent;
  const toSummarize = messages.slice(firstNonSystem, compactEnd);

  const summaryParts: string[] = [];
  for (const msg of toSummarize) {
    if (msg.role === 'assistant') {
      const prose = stripToolMarkup(msg.content).slice(0, 200);
      if (prose) summaryParts.push(`Agent: ${prose}`);
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

function getSystemPrompt(cwd: string, mcpToolsDesc: string = ''): string {
  return `You are Deyad, an expert AI coding agent running in the user's terminal.
You have full access to their project at: ${cwd}
You can read, write, edit, and delete files, run shell commands, search code, manage git, and fetch URLs.

${TOOLS_DESCRIPTION}${mcpToolsDesc}

TOOL CALL FORMAT — you MUST use this exact XML format:
<tool_call>
<name>TOOL_NAME</name>
<param name="KEY">VALUE</param>
</tool_call>

You can make multiple tool calls in a single response. Each must be wrapped in its own <tool_call> tags.

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

export async function runAgentLoop(
  model: string,
  userMessage: string | OllamaMessage,
  cwd: string,
  callbacks: AgentCallbacks,
  history: OllamaMessage[] = [],
  ollamaOptions?: OllamaOptions,
  mcpManager?: McpManager,
): Promise<AgentResult> {
  const abortController = new AbortController();
  const changedFiles: string[] = [];
  const stats: TokenStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const sigHandler = () => { abortController.abort(); };
  process.on('SIGINT', sigHandler);

  try {
    const context = await buildContext(cwd);
    const mcpToolsDesc = mcpManager ? mcpManager.getToolsDescription() : '';
    const messages: OllamaMessage[] = [
      { role: 'system', content: getSystemPrompt(cwd, mcpToolsDesc) },
      { role: 'system', content: `Project context:\n\n${context}` },
      ...history,
      typeof userMessage === 'string' ? { role: 'user', content: userMessage } : userMessage,
    ];

    let iteration = 0;
    let hasPerformedAction = false;

    const MAX_ITERATIONS = 50;

    while (!abortController.signal.aborted) {
      if (iteration >= MAX_ITERATIONS) {
        callbacks.onError(`Reached maximum iterations (${MAX_ITERATIONS}). Stopping.`);
        break;
      }
      compactConversation(messages);
      let result;
      try {
        result = await streamChat(
          model,
          messages,
          callbacks.onToken,
          ollamaOptions,
          abortController.signal,
        );
      } catch (err: unknown) {
        const errMsg = String((err as Error).message || err);
        callbacks.onError(`Ollama error: ${errMsg}`);
        if (iteration > 0) {
          // Retry once on transient errors
          iteration++;
          continue;
        }
        break;
      }
      if (abortController.signal.aborted) break;

      const turnResponse = result.content;
      stats.promptTokens += result.usage.promptTokens;
      stats.completionTokens += result.usage.completionTokens;
      stats.totalTokens = stats.promptTokens + stats.completionTokens;

      const toolCalls = parseToolCalls(turnResponse);

      if (toolCalls.length === 0) {
        // If the model just narrated without acting, nudge it to use tools (up to 2 retries)
        const userMessageText = typeof userMessage === 'string' ? userMessage : userMessage.content;
        if (isActionableRequest(userMessageText) && !hasPerformedAction && iteration < 2) {
          messages.push({ role: 'assistant', content: turnResponse });
          messages.push({
            role: 'user',
            content: 'Your response did not contain any tool calls. You MUST respond with tool_call XML to take action. Start by reading relevant files. Example:\n<tool_call>\n<name>list_files</name>\n</tool_call>\n\nDo not describe what you would do — actually do it with tools NOW.',
          });
          iteration++;
          continue;
        }
        const summary = stripToolMarkup(turnResponse);
        callbacks.onDone(summary);
        messages.push({ role: 'assistant', content: turnResponse });
        return { history: messages, changedFiles, stats };
      }

      messages.push({ role: 'assistant', content: turnResponse });
      const toolCb: ToolCallbacks = { confirm: callbacks.confirm, onDiff: callbacks.onDiff };
      const readOnlyTools = new Set(['list_files', 'read_file', 'search_files', 'glob_files', 'fetch_url', 'git_status', 'git_log', 'git_diff', 'git_branch']);
      const writeTools = new Set(['write_files', 'edit_file', 'delete_file', 'multi_edit', 'run_command', 'git_add', 'git_commit', 'git_stash']);

      let results: ToolResult[] = [];
      let filesChanged = false;
      const allReadOnly = toolCalls.every((c) => readOnlyTools.has(c.name) || (mcpManager?.isMcpTool(c.name) ?? false));
      if (allReadOnly && toolCalls.length > 1) {
        for (const call of toolCalls) callbacks.onToolStart(call.name, call.params);
        results = await Promise.all(toolCalls.map((call) => executeTool(call, cwd, toolCb)));
        for (const result of results) {
          callbacks.onToolResult(result);
          if (result.changedFiles) {
            for (const f of result.changedFiles) {
              if (!changedFiles.includes(f)) changedFiles.push(f);
            }
          }
        }
        if (toolCalls.length > 0) hasPerformedAction = true;
      } else {
        results = [];
        for (const call of toolCalls) {
          if (abortController.signal.aborted) break;
          callbacks.onToolStart(call.name, call.params);
          const result = await executeTool(call, cwd, toolCb);
          results.push(result);
          callbacks.onToolResult(result);
          if (result.changedFiles) {
            for (const f of result.changedFiles) {
              if (!changedFiles.includes(f)) changedFiles.push(f);
            }
          }
          if (writeTools.has(call.name) && result.success) filesChanged = true;
        }
        if (toolCalls.length > 0) hasPerformedAction = true;
      }

      if (filesChanged) {
        try {
          const freshContext = await buildContext(cwd);
          const second = messages[1];
          if (messages.length > 1 && second?.role === 'system' && second.content.startsWith('Project context:')) {
            messages[1] = { role: 'system', content: `Project context:\n\n${freshContext}` };
          }
        } catch {
          // ignore
        }
      }

      const resultsText = results.map((r) =>
        `<tool_result>\n<name>${r.tool}</name>\n<status>${r.success ? 'success' : 'error'}</status>\n<output>\n${r.output}\n</output>\n</tool_result>`,
      ).join('\n\n');

      if (isDone(turnResponse)) {
        const summary = stripToolMarkup(turnResponse);
        callbacks.onDone(summary);
        messages.push({ role: 'user', content: resultsText });
        return { history: messages, changedFiles, stats };
      }

      messages.push({ role: 'user', content: resultsText });
    }

    return { history: messages, changedFiles, stats };
  } finally {
    process.removeListener('SIGINT', () => abortController.abort());
  }
}
