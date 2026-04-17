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



/** Default character budget for the full conversation (≈ 32k tokens at ~4 chars/token).
 *  Overridden at runtime when contextSize is known — uses 75% of context window. */
const MAX_CONVERSATION_CHARS = 128_000;

/** Number of recent messages to always keep when compacting. */
const MIN_KEEP = 6;

/** Max chars for the compacted summary itself. */
const MAX_SUMMARY_CHARS = 24_000;

/** Chars-per-token estimate used to derive compaction threshold from context size. */
const CHARS_PER_TOKEN = 4;

/** Maximum number of entries to keep in fullHistory before trimming old ones. */
const MAX_FULLHISTORY_ENTRIES = 500;

/**
 * Trim fullHistory in-place if it exceeds the cap.
 * Keeps the most recent entries.
 */
function trimFullHistory(history: Array<{ role: string; content: string }>, max: number = MAX_FULLHISTORY_ENTRIES): void {
  if (history.length > max) {
    history.splice(0, history.length - max);
  }
}

/**
 * Extract structured details from tool call XML in assistant messages.
 */
function extractToolCalls(content: string): Array<{ tool: string; params: Record<string, string> }> {
  const calls: Array<{ tool: string; params: Record<string, string> }> = [];
  const toolCallRegex = /<tool_call>\s*\{?\s*"?name"?\s*:\s*"([^"]+)"[\s\S]*?<\/tool_call>/g;
  let match;
  while ((match = toolCallRegex.exec(content)) !== null) {
    const tool = match[1]!;
    const params: Record<string, string> = {};
    const block = match[0];
    const paramMatches = block.matchAll(/"(\w+)"\s*:\s*"([^"]*?)"/g);
    for (const pm of paramMatches) {
      if (pm[1] !== 'name') params[pm[1]!] = pm[2]!;
    }
    calls.push({ tool, params });
  }
  // Also match <name>/<param> style
  const xmlRegex = /<tool_call>\s*<name>(\w+)<\/name>([\s\S]*?)<\/tool_call>/g;
  while ((match = xmlRegex.exec(content)) !== null) {
    const tool = match[1]!;
    const params: Record<string, string> = {};
    const paramMatches = match[2]!.matchAll(/<param\s+name="(\w+)">([\s\S]*?)<\/param>/g);
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
function buildRichSummary(toSummarize: Array<{ role: string; content: string }>): string {
  const userRequests: string[] = [];
  const filesRead = new Set<string>();
  const filesWritten = new Set<string>();
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
          toolResults.push({ tool: r.tool, output: `(${r.output.length} chars)` });
        } else if (r.tool === 'run_command') {
          toolResults.push({ tool: r.tool, output: r.output.slice(0, 500) });
        } else {
          toolResults.push({ tool: r.tool, output: r.output.slice(0, 200) });
        }
      }
    }

    if (msg.role === 'assistant') {
      for (const tc of extractToolCalls(msg.content)) {
        if (tc.tool === 'read_file' && tc.params['path']) {
          filesRead.add(tc.params['path']);
        } else if ((tc.tool === 'write_files' || tc.tool === 'edit_file' || tc.tool === 'multi_edit') && tc.params['path']) {
          filesWritten.add(tc.params['path']);
        } else if (tc.tool === 'run_command' && tc.params['command']) {
          commandsRun.push({ cmd: tc.params['command'], output: '' });
        }
      }
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

  let summary = parts.join('\n');
  if (summary.length > MAX_SUMMARY_CHARS) {
    summary = summary.slice(0, MAX_SUMMARY_CHARS) + '\n\n[...summary truncated]';
  }
  return summary;
}

/** Tracks how many fullHistory entries were covered by the last compaction summary. */
let lastCompactedIndex = 0;

/**
 * Compact the conversation when it exceeds the character budget.
 * Uses incremental summaries — only processes new fullHistory entries since
 * the last compaction, and prepends the previous summary to avoid re-scanning
 * the entire history each time.
 */
function compactConversation(
  messages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_name?: string }>,
  fullHistory?: Array<{ role: string; content: string }>,
  contextTokens?: number,
  maxFullHistory?: number,
): void {
  const maxChars = contextTokens
    ? Math.floor(contextTokens * 0.75 * CHARS_PER_TOKEN)
    : MAX_CONVERSATION_CHARS;
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (totalChars <= maxChars) return;

  // Find where non-system messages begin
  let firstNonSystem = 0;
  while (firstNonSystem < messages.length && messages[firstNonSystem].role === 'system') {
    firstNonSystem++;
  }

  const nonSystemCount = messages.length - firstNonSystem;
  if (nonSystemCount <= MIN_KEEP) return;

  const compactEnd = messages.length - MIN_KEEP;
  const toSummarize = messages.slice(firstNonSystem, compactEnd);

  // Find the existing summary (if any) from a prior compaction
  let existingSummary = '';
  for (let i = firstNonSystem; i < compactEnd; i++) {
    if (messages[i].role === 'system' && messages[i].content.startsWith('[Earlier conversation')) {
      existingSummary = messages[i].content;
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
  /** Context window size in tokens — sent as num_ctx to Ollama. */
  contextSize?: number;
  /** Full uncompacted conversation history — used for richer compaction summaries. */
  fullHistory?: Array<{ role: string; content: string }>;
  /** Maximum entries to keep in fullHistory before trimming (default: 500). */
  maxFullHistory?: number;
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
  modelOptions?: { temperature?: number; top_p?: number; repeat_penalty?: number; num_ctx?: number },
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
  const { appId, appType, dbProvider, dbStatus, model, userMessage, appFiles, selectedFile, history, embedModel, modelOptions, contextSize, fullHistory, callbacks } = options;
  let aborted = false;

  // Reset incremental compaction index for this loop session
  lastCompactedIndex = 0;

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

      // Add full conversation history — compaction handles trimming
      for (const msg of history) {
        messages.push(msg);
      }

      // Add the user's current message (always last, never duplicated)
      messages.push({ role: 'user', content: userMessage });

      let fullOutput = '';
      const allChangedFiles = new Set<string>();
      const allCommands: string[] = [];

      // Get Ollama-native tool definitions
      const ollamaTools = getDesktopOllamaTools();

      const MAX_ITERATIONS = 50;
      let iteration = 0;

      // Agent loop — runs until task is done, aborted, or hits iteration safeguard
      while (!aborted) {
        if (iteration >= MAX_ITERATIONS) {
          fullOutput += `\n\n[Reached ${MAX_ITERATIONS} iteration safeguard — stopping. You can send another message to continue.]`;
          callbacks.onContent(fullOutput);
          break;
        }
        // Compact conversation if it's getting too large for the context window
        compactConversation(messages, fullHistory, contextSize, options.maxFullHistory);

        // Stream one turn from Ollama (with native tools)
        const ollamaOpts = contextSize
          ? { ...modelOptions, num_ctx: contextSize }
          : modelOptions;
        const { text: turnResponse, nativeToolCalls } = await streamOllamaTurn(model, messages, (token) => {
          fullOutput += token;
          callbacks.onContent(fullOutput);
        }, () => aborted, ollamaOpts, ollamaTools);

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

          let result: ToolResult;
          try {
            result = await executeTool(call, appId);
          } catch (err) {
            result = { tool: call.name, success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
          }
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
        iteration++;
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
