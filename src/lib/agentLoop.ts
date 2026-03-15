/**
 * Autonomous agent loop.
 *
 * Orchestrates a multi-turn conversation with Ollama where the AI can
 * call tools (read/write files, run commands, etc.) and iterate until
 * the task is complete.
 */

import { parseToolCalls, executeTool, isDone, stripToolMarkup, AGENT_TOOLS_DESCRIPTION } from './agentTools';
import type { ToolResult } from './agentTools';
import { buildSmartContext, buildSmartContextWithRAG } from './contextBuilder';
import { embedChunks } from './codebaseIndexer';

/** Maximum autonomous iterations before forcing a stop. */
const MAX_ITERATIONS = 30;

/** Approximate character budget for the full conversation (≈ 32k tokens at ~3.5 chars/token). */
const MAX_CONVERSATION_CHARS = 112_000;

/**
 * Compact the conversation when it exceeds the character budget.
 * Keeps system messages and the most recent turns, summarizing
 * older assistant+tool_result pairs into a single summary message.
 */
function compactConversation(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
): void {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (totalChars <= MAX_CONVERSATION_CHARS) return;

  // Find where non-system messages begin
  let firstNonSystem = 0;
  while (firstNonSystem < messages.length && messages[firstNonSystem].role === 'system') {
    firstNonSystem++;
  }

  // Keep at least the last 6 non-system messages
  const keepRecent = 6;
  const nonSystemCount = messages.length - firstNonSystem;
  if (nonSystemCount <= keepRecent) return; // nothing to compact

  const compactEnd = messages.length - keepRecent;
  const toSummarize = messages.slice(firstNonSystem, compactEnd);

  // Build a brief summary of the compacted turns
  const summaryParts: string[] = [];
  for (const msg of toSummarize) {
    if (msg.role === 'assistant') {
      const prose = stripToolMarkup(msg.content).slice(0, 200);
      if (prose) summaryParts.push(`Agent: ${prose}`);
    } else if (msg.role === 'user' && msg.content.startsWith('<tool_result>')) {
      // Tool results — just note tools used
      const toolNames = [...msg.content.matchAll(/<name>([^<]+)<\/name>/g)].map(m => m[1]);
      if (toolNames.length) summaryParts.push(`Tools executed: ${toolNames.join(', ')}`);
    } else if (msg.role === 'user') {
      summaryParts.push(`User: ${msg.content.slice(0, 200)}`);
    }
  }

  const summary = `[Earlier conversation compacted]\n${summaryParts.join('\n')}`;

  // Splice: remove the old messages and insert the summary
  messages.splice(firstNonSystem, compactEnd - firstNonSystem, {
    role: 'system' as const,
    content: summary,
  });
}

export interface AgentCallbacks {
  /** Called when the agent adds/updates its thinking or prose output. */
  onContent: (text: string) => void;
  /** Called when a tool starts executing. */
  onToolStart: (toolName: string, params: Record<string, string>) => void;
  /** Called when a tool finishes executing. */
  onToolResult: (result: ToolResult) => void;
  /** Called when files are written by the agent. Returns the updated file map. */
  onFilesWritten: (files: Record<string, string>) => Promise<void>;
  /** Called when the agent loop is fully done. */
  onDone: () => void;
  /** Called on error. */
  onError: (error: string) => void;
}

export interface AgentOptions {
  appId: string;
  appType: 'frontend' | 'fullstack';
  dbProvider?: 'postgresql';
  dbStatus: 'none' | 'running' | 'stopped';
  model: string;
  userMessage: string;
  /** Current project files for initial context. */
  appFiles: Record<string, string>;
  /** Currently selected file in the editor. */
  selectedFile?: string | null;
  /** Previous conversation messages (for continuity). */
  history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  /** Ollama embedding model name for RAG retrieval (optional). */
  embedModel?: string;
  callbacks: AgentCallbacks;
}

function getAgentSystemPrompt(appType: string, _dbProvider?: string): string {
  const stackInfo = appType === 'fullstack'
    ? 'This is a full-stack project (React + Vite + TypeScript frontend, Express + Prisma backend, PostgreSQL database).'
    : 'This is a frontend project (React + Vite + TypeScript).';

  return `You are Deyad Agent, an autonomous AI developer powered by Ollama.
You can independently read code, write files, run shell commands, and iterate until the task is complete.

${stackInfo}

${AGENT_TOOLS_DESCRIPTION}

WORKFLOW:
1. First, understand the request and explore the current project (list_files, read_file).
2. Plan your approach briefly in prose.
3. Implement changes using write_files and run_command as needed.
4. Verify your work (e.g. check for errors, read files to confirm).
5. When everything is done, output <done/>.

RULES:
- Always explore the project structure before making changes.
- Prefer edit_file for small, targeted changes. Use write_files only for new files or complete rewrites.
- After writing files, run build/lint commands to verify if applicable.
- If a command fails, read the error and fix the issue.
- Keep your prose explanations concise — focus on actions.
- Do not ask the user questions; make reasonable decisions autonomously.
- You can make multiple tool calls in a single response.
- Use ### FILE: format inside write_files content param for code.
- When the user asks for any git operation (push, pull, commit, branch, status, log, remote, etc.), use the dedicated git_* tools directly — do NOT use run_command with git. For example: use git_push instead of run_command "git push".

When writing files with write_files, put the raw file content directly in the content param (no markdown fences).`;
}

/**
 * Streams a single Ollama turn and returns the full response text.
 */
function streamOllamaTurn(
  model: string,
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  onToken: (token: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const requestId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const unsubToken = window.deyad.onStreamToken(requestId, (token: string) => {
      buf += token;
      onToken(token);
    });

    const unsubDone = window.deyad.onStreamDone(requestId, () => {
      cleanup();
      resolve(buf);
    });

    const unsubError = window.deyad.onStreamError(requestId, (err: string) => {
      cleanup();
      reject(new Error(err));
    });

    function cleanup() {
      unsubToken();
      unsubDone();
      unsubError();
    }

    window.deyad.chatStream(model, messages, requestId).catch((err) => {
      cleanup();
      reject(err);
    });
  });
}

/**
 * Run the autonomous agent loop.
 *
 * Returns a cleanup function that can abort the loop.
 */
export function runAgentLoop(options: AgentOptions): () => void {
  const { appId, appType, dbProvider, dbStatus, model, userMessage, appFiles, selectedFile, history, embedModel, callbacks } = options;
  let aborted = false;

  const abort = () => { aborted = true; };

  (async () => {
    try {
      // Trigger embedding of chunks in background (non-blocking for first run)
      if (embedModel) {
        embedChunks(appId, appFiles, embedModel).catch((err) => console.warn('embedChunks:', err));
      }

      // Build initial context (with RAG chunks if embeddings are available)
      const context = embedModel
        ? await buildSmartContextWithRAG({
            files: appFiles,
            selectedFile,
            userMessage,
            appId,
            embedModel,
          })
        : buildSmartContext({
            files: appFiles,
            selectedFile,
            userMessage,
            appId,
          });

      // Assemble conversation
      const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
        { role: 'system', content: getAgentSystemPrompt(appType, dbProvider) },
      ];

      if (context) {
        messages.push({ role: 'system', content: `Current project files:\n\n${context}` });
      }

      // Inject DB schema if available
      if (dbStatus === 'running' && appType === 'fullstack') {
        try {
          const schema = await window.deyad.dbDescribe(appId);
          if (schema.tables.length > 0) {
            const schemaText = schema.tables.map((t) => `${t.name}: ${t.columns.join(', ')}`).join('\n');
            messages.push({
              role: 'system',
              content: `Database schema:\n${schemaText}`,
            });
          }
        } catch (err) { console.debug('ignore:', err); }
      }

      // Add conversation history (last 6 messages)
      for (const msg of history.slice(-6)) {
        messages.push(msg);
      }

      // Add the user's current message
      messages.push({ role: 'user', content: userMessage });

      let fullOutput = '';
      let iteration = 0;

      // Agent loop
      while (iteration < MAX_ITERATIONS && !aborted) {
        iteration++;

        // Compact conversation if it's getting too large for the context window
        compactConversation(messages);

        // Stream one turn from Ollama
        const turnResponse = await streamOllamaTurn(model, messages, (token) => {
          fullOutput += token;
          callbacks.onContent(fullOutput);
        });

        if (aborted) break;

        // Check for tool calls
        const toolCalls = parseToolCalls(turnResponse);

        if (toolCalls.length === 0 || isDone(turnResponse)) {
          // No tool calls or explicit done — the agent is finished
          callbacks.onDone();
          return;
        }

        // Execute each tool call
        const results: ToolResult[] = [];
        let filesChanged = false;
        for (const call of toolCalls) {
          if (aborted) break;
          callbacks.onToolStart(call.name, call.params);

          const result = await executeTool(call, appId);
          results.push(result);
          callbacks.onToolResult(result);

          // If files were written, notify parent
          if (call.name === 'write_files' && result.success) {
            filesChanged = true;
            const fileMap: Record<string, string> = {};
            if (call.params.path && call.params.content !== undefined) {
              fileMap[call.params.path] = call.params.content;
            }
            for (let i = 0; i < 50; i++) {
              const p = call.params[`file_${i}_path`];
              const c = call.params[`file_${i}_content`];
              if (!p) break;
              fileMap[p] = c ?? '';
            }
            if (Object.keys(fileMap).length > 0) {
              await callbacks.onFilesWritten(fileMap);
            }
          }

          // edit_file also modifies files
          if (call.name === 'edit_file' && result.success) {
            filesChanged = true;
          }

          // multi_edit modifies files
          if (call.name === 'multi_edit' && result.success) {
            filesChanged = true;
          }
        }

        // Re-read project files after writes so the next iteration sees updated code
        if (filesChanged) {
          try {
            const freshFiles = await window.deyad.readFiles(appId);
            const freshContext = embedModel
              ? await buildSmartContextWithRAG({
                  files: freshFiles,
                  selectedFile,
                  userMessage,
                  appId,
                  embedModel,
                })
              : buildSmartContext({
                  files: freshFiles,
                  selectedFile,
                  userMessage,
                  appId,
                });
            // Replace the stale project files context message (index 1)
            if (messages.length > 1 && messages[1].role === 'system' && messages[1].content.startsWith('Current project files:')) {
              messages[1] = { role: 'system', content: `Current project files:\n\n${freshContext}` };
            }
          } catch (err) { console.debug('ignore — context stays as-is:', err); }
        }

        if (aborted) break;

        // Build tool results message to feed back
        const resultsText = results
          .map((r) => `<tool_result>\n<name>${r.tool}</name>\n<status>${r.success ? 'success' : 'error'}</status>\n<output>\n${r.output}\n</output>\n</tool_result>`)
          .join('\n\n');

        // Auto-lint: after file changes, run a quick type-check and append errors
        let autoLintText = '';
        if (filesChanged && !aborted) {
          try {
            const lintResult = await executeTool(
              { name: 'run_command', params: { command: 'timeout 5 npx tsc --noEmit --pretty false 2>&1 | head -40' } },
              appId,
            );
            const lintOutput = lintResult.output.trim();
            if (lintOutput && lintOutput !== '(no output)' && /error\s+TS/i.test(lintOutput)) {
              autoLintText = `\n\n<auto_lint>\nTypeScript errors detected after your changes — please fix them:\n${lintOutput}\n</auto_lint>`;
            }
          } catch (err) { console.debug('ignore lint failures:', err); }
        }

        // Add assistant response and tool results to conversation
        messages.push({ role: 'assistant', content: turnResponse });
        messages.push({ role: 'user', content: resultsText + autoLintText });

        // Add a separator in the display
        fullOutput += '\n\n---\n\n';
        callbacks.onContent(fullOutput);
      }

      if (iteration >= MAX_ITERATIONS && !aborted) {
        fullOutput += '\n\n*Agent stopped after reaching the maximum iteration limit.*';
        callbacks.onContent(fullOutput);
        callbacks.onError(`Agent stopped after reaching the maximum iteration limit (${MAX_ITERATIONS}). You can continue the conversation to pick up where it left off.`);
        return;
      }

      callbacks.onDone();
    } catch (err) {
      if (!aborted) {
        callbacks.onError(err instanceof Error ? err.message : String(err));
      }
    }
  })();

  return abort;
}
