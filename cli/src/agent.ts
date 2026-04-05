/**
 * CLI agent loop — multi-turn conversation with Ollama + tool execution.
 */

import { streamChat } from './ollama.js';
import type { OllamaMessage, OllamaOptions } from './ollama.js';
import { parseToolCalls, isDone, stripToolMarkup, executeTool, TOOLS_DESCRIPTION } from './tools.js';
import type { ToolResult, ToolCallbacks } from './tools.js';

const MAX_ITERATIONS = 30;
const MAX_CONVERSATION_CHARS = 112_000;

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
  while (firstNonSystem < messages.length && messages[firstNonSystem].role === 'system') {
    firstNonSystem++;
  }

  const keepRecent = 6;
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
      const toolNames = [...msg.content.matchAll(/<name>([^<]+)<\/name>/g)].map(m => m[1]);
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

function getSystemPrompt(cwd: string): string {
  return `You are Deyad CLI, an autonomous AI coding agent powered by Ollama.
You work directly in the user's project directory: ${cwd}

${TOOLS_DESCRIPTION}

WORKFLOW:
1. Understand the request. Explore the project first (list_files, read_file).
2. Plan your approach briefly.
3. Implement changes using write_files, edit_file, and run_command.
4. Verify your work (read files, run tests/build).
5. When done, write a summary and output <done/>.

RULES:
- Follow the user's instructions exactly.
- Explore before editing — understand the codebase first.
- Prefer edit_file for small changes, write_files for new files.
- After changes, verify by running build/test commands if applicable.
- If a command fails, read the error and fix the issue.
- Keep explanations concise — focus on actions.
- You can make multiple tool calls in a single response.`;
}

/**
 * Build initial project context — read key files and file listing.
 */
async function buildContext(cwd: string): Promise<string> {
  const { executeTool: exec } = await import('./tools.js');
  const listing = await exec({ name: 'list_files', params: {} }, cwd);
  const files = listing.output.split('\n').filter(Boolean);

  let context = `Project files (${files.length}):\n${listing.output}\n`;

  // Auto-read key config files
  const keyFiles = ['package.json', 'tsconfig.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', 'Makefile', '.env'];
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
 * Run the agent loop. Returns when the agent finishes or is aborted.
 */
export async function runAgentLoop(
  model: string,
  userMessage: string,
  cwd: string,
  callbacks: AgentCallbacks,
  history: OllamaMessage[] = [],
  ollamaOptions?: OllamaOptions,
): Promise<AgentResult> {
  const abortController = new AbortController();
  const changedFiles: string[] = [];
  const stats: TokenStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  // Handle Ctrl+C gracefully within the loop
  const sigHandler = () => { abortController.abort(); };
  process.on('SIGINT', sigHandler);

  try {
    const context = await buildContext(cwd);

    const messages: OllamaMessage[] = [
      { role: 'system', content: getSystemPrompt(cwd) },
      { role: 'system', content: `Project context:\n\n${context}` },
      ...history,
      { role: 'user', content: userMessage },
    ];

    let iteration = 0;

    while (iteration < MAX_ITERATIONS && !abortController.signal.aborted) {
      iteration++;
      compactConversation(messages);

      // Estimate prompt tokens (rough: 4 chars ≈ 1 token)
      const promptChars = messages.reduce((s, m) => s + m.content.length, 0);
      stats.promptTokens += Math.ceil(promptChars / 4);

      const turnResponse = await streamChat(
        model,
        messages,
        callbacks.onToken,
        ollamaOptions,
        abortController.signal,
      );

      if (abortController.signal.aborted) break;

      // Estimate completion tokens
      stats.completionTokens += Math.ceil(turnResponse.length / 4);
      stats.totalTokens = stats.promptTokens + stats.completionTokens;

      // Parse tool calls
      const toolCalls = parseToolCalls(turnResponse);

      if (toolCalls.length === 0 || isDone(turnResponse)) {
        const summary = stripToolMarkup(turnResponse);
        callbacks.onDone(summary);
        messages.push({ role: 'assistant', content: turnResponse });
        return { history: messages, changedFiles, stats };
      }

      // Record assistant message
      messages.push({ role: 'assistant', content: turnResponse });

      // Execute tools with diff callback
      const toolCb: ToolCallbacks = {
        confirm: callbacks.confirm,
        onDiff: callbacks.onDiff,
      };
      const results: ToolResult[] = [];
      for (const call of toolCalls) {
        if (abortController.signal.aborted) break;
        callbacks.onToolStart(call.name, call.params);
        const result = await executeTool(call, cwd, toolCb);
        results.push(result);
        callbacks.onToolResult(result);
        // Track changed files
        if (result.changedFiles) {
          for (const f of result.changedFiles) {
            if (!changedFiles.includes(f)) changedFiles.push(f);
          }
        }
      }

      // Feed results back to the model
      const resultXml = results.map(r =>
        `<tool_result>\n<name>${r.tool}</name>\n<success>${r.success}</success>\n<output>${r.output}</output>\n</tool_result>`
      ).join('\n');

      messages.push({ role: 'user', content: resultXml });
    }

    if (iteration >= MAX_ITERATIONS) {
      callbacks.onError(`Reached maximum iterations (${MAX_ITERATIONS}).`);
    }

    return { history: messages, changedFiles, stats };
  } finally {
    process.removeListener('SIGINT', sigHandler);
  }
}
