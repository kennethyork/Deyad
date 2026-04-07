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
  return /\b(create|write|edit|delete|install|run|execute|build|test|compile|deploy|generate|fix|update|add|remove|launch|open|serve|start|configure)\b/i.test(message);
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
  return `You are a terminal-based Ollama coding agent.
You can independently read code, write files, run shell commands, and iterate until the task is complete.
You work directly in the user's project directory: ${cwd}

${TOOLS_DESCRIPTION}${mcpToolsDesc}

IMPORTANT: For any request that modifies the project, runs a command, or performs a task, reply with tool_call XML only. If you have not executed any tools yet, do not return <done/>. Only use plain language for general chat or final summaries after tools have executed.

WORKFLOW:
1. First, understand the request and explore the current project (list_files, read_file).
2. Plan your approach briefly in prose.
3. Implement changes using write_files, edit_file, and run_command.
4. Verify your work (e.g. check for errors, read files to confirm).
5. When everything is done, write a brief SUMMARY of what you did, then output <done/>.

RULES:
- ALWAYS follow the user's instructions exactly.
- NEVER just describe what you would do — actually perform the actions with tool calls.
- Do not output <done/> until the task is complete.
`;
}

async function buildContext(cwd: string): Promise<string> {
  const { executeTool: exec } = await import('./tools.js');
  const listing = await exec({ name: 'list_files', params: {} }, cwd);
  const files = listing.output.split('\n').filter(Boolean);

  let context = `Project files (${files.length}):\n${listing.output}\n`;
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

    while (!abortController.signal.aborted) {
      compactConversation(messages);
      const result = await streamChat(
        model,
        messages,
        callbacks.onToken,
        ollamaOptions,
        abortController.signal,
      );
      if (abortController.signal.aborted) break;

      const turnResponse = result.content;
      stats.promptTokens += result.usage.promptTokens;
      stats.completionTokens += result.usage.completionTokens;
      stats.totalTokens = stats.promptTokens + stats.completionTokens;

      const toolCalls = parseToolCalls(turnResponse);
      const userMessageText = typeof userMessage === 'string' ? userMessage : userMessage.content;
      const actionable = isActionableRequest(userMessageText);

      if (toolCalls.length === 0) {
        if (actionable && !hasPerformedAction && iteration < 3) {
          messages.push({ role: 'assistant', content: turnResponse });
          messages.push({
            role: 'user',
            content: 'This request requires action, but no tool_call was produced. Reply with tool_call XML only. Use write_files/edit_file/delete_file/multi_edit for file updates, run_command for shell operations, read_file/search_files/glob_files/list_files for inspection, and do not output <done/> until the task is complete.',
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
      const readOnlyTools = new Set(['list_files', 'read_file', 'search_files', 'glob_files', 'fetch_url', 'memory_read', 'git_status', 'git_log', 'git_diff', 'git_branch', 'git_remote_get', 'web_search', 'analyze_image']);
      const writeTools = new Set(['write_files', 'edit_file', 'delete_file', 'multi_edit']);

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
