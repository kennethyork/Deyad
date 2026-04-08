/**
 * Autonomous agent loop.
 *
 * Orchestrates a multi-turn conversation with Ollama where the AI can
 * call tools (read/write files, run commands, etc.) and iterate until
 * the task is complete.
 */

import { parseToolCalls, executeTool, isDone, stripToolMarkup, AGENT_TOOLS_DESCRIPTION, getDesktopOllamaTools } from './agentTools';
import type { ToolResult, ToolCall } from './agentTools';
import { buildSmartContext, buildSmartContextWithRAG } from './contextBuilder';
import { embedChunks } from './codebaseIndexer';



/** Approximate character budget for the full conversation (≈ 32k tokens at ~4 chars/token). */
const MAX_CONVERSATION_CHARS = 128_000;

/** Minimum messages to always keep regardless of budget. */
const MIN_KEEP = 4;

/**
 * Score a message's importance for retention during compaction.
 * Higher scores → more likely to survive compaction.
 */
function messageImportance(msg: { role: string; content: string }): number {
  // User messages with real questions are high-value
  if (msg.role === 'user' && !msg.content.startsWith('<tool_result>')) {
    // Longer user messages (actual questions/instructions) are more important
    return 10 + Math.min(msg.content.length / 100, 5);
  }

  // Tool results that wrote/edited files are high-value (evidence of changes)
  if (msg.role === 'user' && msg.content.startsWith('<tool_result>')) {
    if (/write_files|edit_file|multi_edit|delete_file|run_command/.test(msg.content)) return 8;
    // Read-only tool results are low-value (can be re-read)
    if (/read_file|list_files|search_files|glob_files|git_status|git_log/.test(msg.content)) return 2;
    return 4;
  }

  // Assistant messages with tool calls are medium-high (show intent)
  if (msg.role === 'assistant') {
    const hasToolCalls = /<tool_call>/.test(msg.content) || (msg as Record<string, unknown>).tool_calls;
    const prose = stripToolMarkup(msg.content).trim();
    // Agent explanation + tool calls = high value
    if (hasToolCalls && prose.length > 50) return 9;
    // Agent tool calls only = medium
    if (hasToolCalls) return 6;
    // Agent prose (progress updates, explanations) = medium
    if (prose.length > 100) return 7;
    // Short ack messages = low
    return 3;
  }

  return 5; // default
}

/**
 * Compact the conversation when it exceeds the character budget.
 * Uses importance-weighted retention: high-importance messages survive
 * longer than low-importance ones (e.g. read-only tool results).
 */
function compactConversation(
  messages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_name?: string }>,
): void {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (totalChars <= MAX_CONVERSATION_CHARS) return;

  // Find where non-system messages begin
  let firstNonSystem = 0;
  while (firstNonSystem < messages.length && messages[firstNonSystem].role === 'system') {
    firstNonSystem++;
  }

  const nonSystem = messages.slice(firstNonSystem);
  if (nonSystem.length <= MIN_KEEP) return;

  // Score each non-system message by importance
  const scored = nonSystem.map((msg, idx) => ({
    msg,
    idx: firstNonSystem + idx,
    importance: messageImportance(msg),
    // Recency boost: more recent messages get a bonus (0-5 points)
    recencyBoost: (idx / nonSystem.length) * 5,
  }));

  // Sort by combined score (importance + recency), lowest first
  const sortedByScore = [...scored].sort(
    (a, b) => (a.importance + a.recencyBoost) - (b.importance + b.recencyBoost),
  );

  // Remove lowest-scored messages until we're under budget, keeping at least MIN_KEEP
  const toRemoveIndices = new Set<number>();
  let currentChars = totalChars;
  const maxRemovable = nonSystem.length - MIN_KEEP;

  for (const item of sortedByScore) {
    if (currentChars <= MAX_CONVERSATION_CHARS || toRemoveIndices.size >= maxRemovable) break;
    toRemoveIndices.add(item.idx);
    currentChars -= item.msg.content.length;
  }

  if (toRemoveIndices.size === 0) return;

  // Build summary of removed messages
  const removed = scored
    .filter((s) => toRemoveIndices.has(s.idx))
    .sort((a, b) => a.idx - b.idx);

  const summaryParts: string[] = [];
  for (const { msg } of removed) {
    if (msg.role === 'assistant') {
      const prose = stripToolMarkup(msg.content).slice(0, 200);
      if (prose) summaryParts.push(`Agent: ${prose}`);
    } else if (msg.role === 'user' && msg.content.startsWith('<tool_result>')) {
      const toolNames = [...msg.content.matchAll(/<name>([^<]+)<\/name>/g)].map(m => m[1]);
      if (toolNames.length) summaryParts.push(`Tools executed: ${toolNames.join(', ')}`);
    } else if (msg.role === 'user') {
      summaryParts.push(`User: ${msg.content.slice(0, 200)}`);
    }
  }

  const summary = `[Earlier conversation compacted — ${removed.length} messages summarized]\n${summaryParts.join('\n')}`;

  // Remove compacted messages (iterate in reverse to preserve indices)
  const sortedIndices = [...toRemoveIndices].sort((a, b) => b - a);
  for (const idx of sortedIndices) {
    messages.splice(idx, 1);
  }

  // Insert summary after system messages
  messages.splice(firstNonSystem, 0, {
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
  dbProvider?: 'sqlite';
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
  /** Model generation options (temperature, top_p, repeat_penalty). */
  modelOptions?: { temperature?: number; top_p?: number; repeat_penalty?: number };
  callbacks: AgentCallbacks;
}

function getAgentSystemPrompt(appType: string, _dbProvider?: string): string {
  const stackInfo = appType === 'fullstack'
    ? 'This is a full-stack project (React + Vite + TypeScript frontend, Express + Prisma backend, SQLite database).'
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
5. When everything is done, write a brief SUMMARY of what you did (which files you created/modified and what changed), then output <done/>.

RULES:
- ALWAYS follow the user's instructions and constraints exactly. If the user says "stay on page", "don't change navigation", "only modify X", or any other constraint, obey it literally.
- Only modify files and components that are directly relevant to the user's request. Do NOT change routing, navigation, page structure, or other unrelated code unless the user explicitly asks for it.
- Always explore the project structure before making changes.
- Prefer edit_file for small, targeted changes. Use write_files only for new files or complete rewrites.
- After writing files, run build/lint commands to verify if applicable.
- If a command fails, read the error and fix the issue.
- Keep your prose explanations concise — focus on actions.
- Make reasonable decisions autonomously for implementation details, but never override the user's explicit constraints.
- You can make multiple tool calls in a single response.
- Use ### FILE: format inside write_files content param for code.
- When the user asks for any git operation (push, pull, commit, branch, status, log, remote, etc.), use the dedicated git_* tools directly — do NOT use run_command with git. For example: use git_push instead of run_command "git push".

SELF-REVIEW — After writing code, verify these before outputting <done/>:
- Array/list lengths match their declared count (e.g. if totalSteps = 9, the steps array must have exactly 9 elements).
- Loop bounds and index offsets are correct (0-based vs 1-based).
- All state variables referenced in JSX/templates are initialized with valid values matching their types.
- Conditional gates (disabled, hidden, etc.) don't accidentally block the user from progressing.
- Navigation flows (wizards, multi-step forms, tabs) are reachable end-to-end — every step can be reached and completed.
- Read back the files you wrote and mentally trace the user flow to catch logic errors.

OUTPUT — Always write visible prose that the user can read:
- Before tool calls, briefly state what you're about to do.
- After making changes, summarize what you did: which files were created or modified and what changed.
- NEVER output only tool calls with no prose — the user cannot see tool calls, only your text.
- Before <done/>, always write a summary like: "Done! I created/modified X, Y, Z. Here's what changed: ..."

When writing files with write_files, put the raw file content directly in the content param (no markdown fences).`;
}

/**
 * Streams a single Ollama turn and returns the full response text + any native tool calls.
 * Accepts an abortSignal callback; when it returns true, the stream is abandoned.
 */
function streamOllamaTurn(
  model: string,
  messages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_name?: string }>,
  onToken: (token: string) => void,
  isAborted: () => boolean,
  modelOptions?: { temperature?: number; top_p?: number; repeat_penalty?: number },
  tools?: unknown[],
): Promise<{ text: string; nativeToolCalls: Array<{ function: { name: string; arguments: Record<string, unknown> } }> }> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const nativeToolCalls: Array<{ function: { name: string; arguments: Record<string, unknown> } }> = [];
    let cleaned = false;
    const requestId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const unsubToken = window.deyad.onStreamToken(requestId, (token: string) => {
      if (isAborted()) { cleanup(); resolve({ text: buf, nativeToolCalls }); return; }
      buf += token;
      onToken(token);
    });

    const unsubToolCalls = window.deyad.onStreamToolCalls(requestId, (toolCalls: Array<{ function: { name: string; arguments: Record<string, unknown> } }>) => {
      for (const tc of toolCalls) nativeToolCalls.push(tc);
    });

    const unsubDone = window.deyad.onStreamDone(requestId, () => {
      cleanup();
      resolve({ text: buf, nativeToolCalls });
    });

    const unsubError = window.deyad.onStreamError(requestId, (err: string) => {
      cleanup();
      reject(new Error(err));
    });

    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      unsubToken();
      unsubToolCalls();
      unsubDone();
      unsubError();
    }

    window.deyad.chatStream(model, messages as Parameters<typeof window.deyad.chatStream>[1], requestId, modelOptions, tools).catch((err) => {
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
  const { appId, appType, dbProvider, dbStatus, model, userMessage, appFiles, selectedFile, history, embedModel, modelOptions, callbacks } = options;
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
      const messages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_name?: string }> = [
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

      // Add conversation history (last 6 messages), excluding the final message
      // since it's the current user message which gets added separately below
      const historyWithoutCurrent = history.slice(0, -1).slice(-6);
      for (const msg of historyWithoutCurrent) {
        messages.push(msg);
      }

      // Add the user's current message (always last, never duplicated)
      messages.push({ role: 'user', content: userMessage });

      let fullOutput = '';
      const allChangedFiles = new Set<string>();
      const allCommands: string[] = [];

      // Get Ollama-native tool definitions
      const ollamaTools = getDesktopOllamaTools();

      // Agent loop — runs until task is done or aborted (no iteration cap; Ollama is local)
      while (!aborted) {
        // Compact conversation if it's getting too large for the context window
        compactConversation(messages);

        // Stream one turn from Ollama (with native tools)
        const { text: turnResponse, nativeToolCalls } = await streamOllamaTurn(model, messages, (token) => {
          fullOutput += token;
          callbacks.onContent(fullOutput);
        }, () => aborted, modelOptions, ollamaTools);

        if (aborted) break;

        // Determine tool calls: native tool calls take priority, fall back to XML parsing
        let toolCalls: ToolCall[];
        let usedNativePath = false;

        if (nativeToolCalls.length > 0) {
          usedNativePath = true;
          toolCalls = nativeToolCalls.map((tc) => ({
            name: tc.function.name,
            params: Object.fromEntries(
              Object.entries(tc.function.arguments || {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
            ),
          }));
        } else {
          toolCalls = parseToolCalls(turnResponse);
        }

        if (toolCalls.length === 0 || isDone(turnResponse)) {
          // If the visible content is too short, append an auto-generated summary
          const visibleContent = stripToolMarkup(fullOutput).trim();
          if (visibleContent.length < 40 && allChangedFiles.size > 0) {
            const fileList = [...allChangedFiles].map(f => `- ${f}`).join('\n');
            const summary = `\n\n**Changes made:**\n${fileList}`;
            fullOutput += summary;
            callbacks.onContent(fullOutput);
          }
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
              allChangedFiles.add(call.params.path);
            }
            for (let i = 0; i < 50; i++) {
              const p = call.params[`file_${i}_path`];
              const c = call.params[`file_${i}_content`];
              if (!p) break;
              fileMap[p] = c ?? '';
              allChangedFiles.add(p);
            }
            if (Object.keys(fileMap).length > 0) {
              await callbacks.onFilesWritten(fileMap);
            }
          }

          // edit_file also modifies files
          if (call.name === 'edit_file' && result.success) {
            filesChanged = true;
            if (call.params.path) {
              allChangedFiles.add(call.params.path);
              // Read the updated file so the UI can show the diff
              try {
                const freshFiles = await window.deyad.readFiles(appId);
                const updatedContent = freshFiles[call.params.path];
                if (updatedContent !== undefined) {
                  await callbacks.onFilesWritten({ [call.params.path]: updatedContent });
                }
              } catch (err) { console.debug('ignore edit_file notify:', err); }
            }
          }

          // multi_edit modifies files
          if (call.name === 'multi_edit' && result.success) {
            filesChanged = true;
            const editedPaths: string[] = [];
            for (let i = 0; i < 50; i++) {
              const p = call.params[`edit_${i}_path`] || call.params[`file_${i}_path`];
              if (!p) break;
              allChangedFiles.add(p);
              editedPaths.push(p);
            }
            // Read all edited files so the UI can show the diff
            if (editedPaths.length > 0) {
              try {
                const freshFiles = await window.deyad.readFiles(appId);
                const editedMap: Record<string, string> = {};
                for (const p of editedPaths) {
                  if (freshFiles[p] !== undefined) editedMap[p] = freshFiles[p];
                }
                if (Object.keys(editedMap).length > 0) {
                  await callbacks.onFilesWritten(editedMap);
                }
              } catch (err) { console.debug('ignore multi_edit notify:', err); }
            }
          }

          // Track commands run
          if (call.name === 'run_command' && call.params.command) {
            allCommands.push(call.params.command);
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

        // Auto-review: after file changes, scan for common logical bugs
        let autoReviewText = '';
        if (filesChanged && !aborted) {
          try {
            const freshFiles = await window.deyad.readFiles(appId);
            const issues: string[] = [];
            for (const [filePath, content] of Object.entries(freshFiles)) {
              if (!filePath.endsWith('.tsx') && !filePath.endsWith('.ts')) continue;
              // Check: array length vs declared count mismatch
              const countMatches = [...content.matchAll(/(?:const|let)\s+(\w+)\s*(?::\s*\w+)?\s*=\s*(\d+)/g)];
              for (const m of countMatches) {
                const varName = m[1];
                const declaredCount = parseInt(m[2], 10);
                const lowerName = varName.toLowerCase();
                if (!(lowerName.includes('total') || lowerName.includes('count') || lowerName.includes('steps'))) continue;
                const arrayPattern = new RegExp(`\\[([^\\]]{20,})\\]`, 'g');
                for (const arrMatch of content.matchAll(arrayPattern)) {
                  const arrContent = arrMatch[0];
                  // Count top-level elements by tracking bracket/paren depth
                  let depth = 0;
                  let commas = 0;
                  for (const ch of arrContent) {
                    if (ch === '[' || ch === '(' || ch === '{') depth++;
                    else if (ch === ']' || ch === ')' || ch === '}') depth--;
                    else if (ch === ',' && depth === 1) commas++;
                  }
                  const elementCount = commas > 0 ? commas + 1 : 0;
                  if (elementCount > 0 && Math.abs(elementCount - declaredCount) === 1) {
                    issues.push(`${filePath}: ${varName} = ${declaredCount} but the associated array appears to have ${elementCount} elements (off-by-one?)`);
                  }
                }
              }
              // Check: state initialized with undefined but typed without undefined
              const stateMatches = [...content.matchAll(/useState<([^>]+)>\(([^)]+)\)/g)];
              for (const sm of stateMatches) {
                const type = sm[1];
                const init = sm[2].trim();
                if (init === 'undefined' && !type.includes('undefined') && !type.includes('null')) {
                  issues.push(`${filePath}: useState<${type}> initialized with undefined but type doesn't allow it`);
                }
              }
            }
            if (issues.length > 0) {
              autoReviewText = `\n\n<auto_review>\nPotential logic issues detected — please verify and fix:\n${issues.join('\n')}\n</auto_review>`;
            }
          } catch (err) { console.debug('ignore review failures:', err); }
        }

        // Runtime error check: if dev server is running, capture logs briefly after file changes
        let runtimeErrorText = '';
        if (filesChanged && !aborted) {
          try {
            const devStatus = await window.deyad.appDevStatus(appId);
            if (devStatus.status === 'running') {
              // Collect dev server output for a few seconds to catch compilation/runtime errors
              const logChunks: string[] = [];
              let logBytes = 0;
              const MAX_LOG_BYTES = 512 * 1024; // 512KB cap
              const unsub = window.deyad.onAppDevLog(({ appId: logAppId, data }) => {
                if (logAppId === appId && logBytes < MAX_LOG_BYTES) {
                  logChunks.push(data);
                  logBytes += data.length;
                }
              });
              await new Promise(resolve => setTimeout(resolve, 3000));
              unsub();
              const logOutput = logChunks.join('');
              // Scan for error patterns
              const errorPatterns = [
                /\berror\b.*TS\d+/i,                     // TypeScript errors
                /SyntaxError:/,                           // Syntax errors
                /ReferenceError:/,                        // Undefined references
                /TypeError:/,                             // Type errors at runtime
                /Failed to compile/i,                     // Build failures
                /\[vite\].*error/i,                       // Vite errors
                /Module not found/i,                      // Missing imports
                /Cannot find module/i,                    // Missing modules
                /Uncaught.*Error/,                        // Uncaught exceptions
                /ERROR\s+in\s+/,                          // Webpack-style errors
                /\bCRASH\b/i,                             // Crashes
              ];
              const matchedErrors: string[] = [];
              for (const line of logOutput.split('\n')) {
                if (errorPatterns.some(p => p.test(line))) {
                  matchedErrors.push(line.trim());
                }
              }
              if (matchedErrors.length > 0) {
                const uniqueErrors = [...new Set(matchedErrors)].slice(0, 15);
                runtimeErrorText = `\n\n<runtime_errors>\nThe dev server reported errors after your changes — please fix them:\n${uniqueErrors.join('\n')}\n</runtime_errors>`;
              }
            }
          } catch (err) { console.debug('ignore runtime check:', err); }
        }

        // Add assistant response and tool results to conversation
        messages.push({ role: 'assistant', content: turnResponse, ...(usedNativePath ? { tool_calls: nativeToolCalls } : {}) });

        if (usedNativePath) {
          // Native path: send each tool result as a separate role:'tool' message
          for (const r of results) {
            messages.push({
              role: 'tool',
              content: `${r.success ? 'success' : 'error'}: ${r.output}`,
              tool_name: r.tool,
            });
          }
          // Append auto-lint/review/runtime errors as a user message if any exist
          const autoFeedback = autoLintText + autoReviewText + runtimeErrorText;
          if (autoFeedback) {
            messages.push({ role: 'user', content: autoFeedback.trim() });
          }
        } else {
          // XML fallback: send results as a user message with XML formatting
          messages.push({ role: 'user', content: resultsText + autoLintText + autoReviewText + runtimeErrorText });
        }

        // Add a separator in the display
        fullOutput += '\n\n---\n\n';
        callbacks.onContent(fullOutput);
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
