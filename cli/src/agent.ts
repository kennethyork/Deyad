/**
 * CLI agent loop — multi-turn conversation with Ollama + tool execution.
 */

import { streamChat, estimateTokens } from './ollama.js';
import type { OllamaMessage, OllamaOptions, OllamaUsage } from './ollama.js';
import { parseToolCalls, isDone, stripToolMarkup, executeTool, TOOLS_DESCRIPTION } from './tools.js';
import type { ToolResult, ToolCallbacks } from './tools.js';
import type { McpManager } from './mcp.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
const MAX_CONVERSATION_CHARS = 128_000;

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

function getSystemPrompt(cwd: string, mcpToolsDesc: string = ''): string {
  return `You are Deyad CLI, an autonomous AI coding agent powered by Ollama.
You can independently read code, write files, run shell commands, and iterate until the task is complete.
You work directly in the user's project directory: ${cwd}

${TOOLS_DESCRIPTION}${mcpToolsDesc}

WORKFLOW:
1. First, understand the request and explore the current project (list_files, read_file).
2. Plan your approach briefly in prose.
3. Implement changes using write_files, edit_file, and run_command.
4. Verify your work (e.g. check for errors, read files to confirm).
5. When everything is done, write a brief SUMMARY of what you did (which files you created/modified and what changed), then output <done/>.

RULES:
- ALWAYS follow the user's instructions and constraints exactly. If the user says "only modify X", or any other constraint, obey it literally.
- Only modify files and components that are directly relevant to the user's request. Do NOT change unrelated code unless explicitly asked.
- Always explore the project structure before making changes.
- Prefer edit_file for small, targeted changes. Use write_files only for new files or complete rewrites.
- After writing files, run build/lint commands to verify if applicable.
- If a command fails, read the error and fix the issue.
- Keep your prose explanations concise — focus on actions.
- Make reasonable decisions autonomously for implementation details, but never override the user's explicit constraints.
- You can make multiple tool calls in a single response — they execute in parallel.
- Use memory_read at the start to check for project conventions in DEYAD.md.
- Use memory_write to save important project notes and conventions.
- When the user asks for any git operation, use the dedicated git_* tools directly — do NOT use run_command with git.

SELF-REVIEW — After writing code, verify these before outputting <done/>:
- Array/list lengths match their declared count.
- Loop bounds and index offsets are correct (0-based vs 1-based).
- All state variables referenced in JSX/templates are initialized with valid values matching their types.
- Conditional gates (disabled, hidden, etc.) don't accidentally block the user from progressing.
- Navigation flows are reachable end-to-end.
- Read back the files you wrote and mentally trace the user flow to catch logic errors.

OUTPUT — Always write visible prose that the user can read:
- Before tool calls, briefly state what you're about to do.
- After making changes, summarize what you did.
- NEVER output only tool calls with no prose — the user cannot see tool calls, only your text.
- Before <done/>, always write a summary like: "Done! I created/modified X, Y, Z. Here's what changed: ..."`;  
}

/**
 * Route a tool call to either the built-in executor or an MCP server.
 */
async function executeToolOrMcp(
  call: { name: string; params: Record<string, string> },
  cwd: string,
  cb: ToolCallbacks,
  mcpManager?: McpManager,
): Promise<ToolResult> {
  if (mcpManager?.isMcpTool(call.name)) {
    const result = await mcpManager.callTool(call.name, call.params);
    return { tool: call.name, success: result.success, output: result.output };
  }
  return executeTool(call, cwd, cb);
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
  const keyFiles = [
    'package.json', 'tsconfig.json',                    // JS / TS
    'Cargo.toml',                                        // Rust
    'pyproject.toml', 'setup.py', 'requirements.txt',   // Python
    'go.mod',                                            // Go
    'pom.xml', 'build.gradle', 'build.gradle.kts',      // Java / Kotlin
    'Gemfile',                                           // Ruby
    'composer.json',                                     // PHP
    'pubspec.yaml',                                      // Dart / Flutter
    'Package.swift',                                     // Swift
    'CMakeLists.txt', 'Makefile',                        // C / C++
    '.env', 'DEYAD.md',                                  // Deyad
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
 * Run the agent loop. Returns when the agent finishes or is aborted.
 */
export async function runAgentLoop(
  model: string,
  userMessage: string,
  cwd: string,
  callbacks: AgentCallbacks,
  history: OllamaMessage[] = [],
  ollamaOptions?: OllamaOptions,
  mcpManager?: McpManager,
): Promise<AgentResult> {
  const abortController = new AbortController();
  const changedFiles: string[] = [];
  const stats: TokenStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  // Handle Ctrl+C gracefully within the loop
  const sigHandler = () => { abortController.abort(); };
  process.on('SIGINT', sigHandler);

  try {
    const context = await buildContext(cwd);
    const mcpToolsDesc = mcpManager ? mcpManager.getToolsDescription() : '';

    const messages: OllamaMessage[] = [
      { role: 'system', content: getSystemPrompt(cwd, mcpToolsDesc) },
      { role: 'system', content: `Project context:\n\n${context}` },
      ...history,
      { role: 'user', content: userMessage },
    ];

    // Agent loop — runs until task is done or aborted (no iteration cap; Ollama is local)
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

      // Accumulate token counts from Ollama (uses real counts or 3.5-ratio estimate)
      stats.promptTokens += result.usage.promptTokens;
      stats.completionTokens += result.usage.completionTokens;
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

      // Execute tools — parallel for read-only, sequential for writes
      const toolCb: ToolCallbacks = {
        confirm: callbacks.confirm,
        onDiff: callbacks.onDiff,
      };

      const readOnlyTools = new Set(['list_files', 'read_file', 'search_files', 'glob_files', 'fetch_url', 'memory_read', 'git_status', 'git_log', 'git_diff', 'git_branch', 'git_remote_get']);
      const allReadOnly = toolCalls.every(c => readOnlyTools.has(c.name) || (mcpManager?.isMcpTool(c.name) ?? false));
      const writeTools = new Set(['write_files', 'edit_file', 'delete_file', 'multi_edit']);

      let results: ToolResult[];
      let filesChanged = false;
      if (allReadOnly && toolCalls.length > 1) {
        // Parallel execution for read-only tools
        for (const call of toolCalls) callbacks.onToolStart(call.name, call.params);
        results = await Promise.all(
          toolCalls.map(call => executeToolOrMcp(call, cwd, toolCb, mcpManager))
        );
        for (const result of results) {
          callbacks.onToolResult(result);
          if (result.changedFiles) {
            for (const f of result.changedFiles) {
              if (!changedFiles.includes(f)) changedFiles.push(f);
            }
          }
        }
      } else {
        // Sequential execution (for writes or mixed)
        results = [];
        for (const call of toolCalls) {
          if (abortController.signal.aborted) break;
          callbacks.onToolStart(call.name, call.params);
          const result = await executeToolOrMcp(call, cwd, toolCb, mcpManager);
          results.push(result);
          callbacks.onToolResult(result);
          if (result.changedFiles) {
            for (const f of result.changedFiles) {
              if (!changedFiles.includes(f)) changedFiles.push(f);
            }
          }
          if (writeTools.has(call.name) && result.success) filesChanged = true;
        }
      }

      // Re-read project context after writes so the next iteration sees updated code
      if (filesChanged) {
        try {
          const freshContext = await buildContext(cwd);
          // Replace the stale project context message (index 1)
          if (messages.length > 1 && messages[1].role === 'system' && messages[1].content.startsWith('Project context:')) {
            messages[1] = { role: 'system', content: `Project context:\n\n${freshContext}` };
          }
        } catch (_err) { /* context stays as-is */ }
      }

      // Feed results back to the model (matching desktop format: <status> not <success>)
      const resultsText = results.map(r =>
        `<tool_result>\n<name>${r.tool}</name>\n<status>${r.success ? 'success' : 'error'}</status>\n<output>\n${r.output}\n</output>\n</tool_result>`
      ).join('\n\n');

      // Auto-lint: after file changes, detect project language and run appropriate linter
      let autoLintText = '';
      if (filesChanged && !abortController.signal.aborted) {
        const lintErrors: string[] = [];
        try {
          // TypeScript / JavaScript
          if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) {
            try {
              const out = execSync('timeout 10 npx tsc --noEmit --pretty false 2>&1 | head -40', { cwd, encoding: 'utf-8', timeout: 15_000 }).trim();
              if (out && /error\s+TS/i.test(out)) lintErrors.push(`[TypeScript]\n${out}`);
            } catch (_e) { /* tsc not available */ }
          } else if (fs.existsSync(path.join(cwd, 'package.json'))) {
            // ESLint for JS projects without TS
            try {
              const changed = changedFiles.filter(f => /\.[jt]sx?$/.test(f)).slice(0, 10).join(' ');
              if (changed) {
                const out = execSync(`timeout 10 npx eslint --no-error-on-unmatched-pattern --format compact ${changed} 2>&1 | head -40`, { cwd, encoding: 'utf-8', timeout: 15_000 }).trim();
                if (out && /Error/i.test(out)) lintErrors.push(`[ESLint]\n${out}`);
              }
            } catch (_e) { /* eslint not available */ }
          }

          // Python
          if (fs.existsSync(path.join(cwd, 'pyproject.toml')) || fs.existsSync(path.join(cwd, 'setup.py')) || fs.existsSync(path.join(cwd, 'requirements.txt'))) {
            const pyFiles = changedFiles.filter(f => f.endsWith('.py')).slice(0, 10);
            if (pyFiles.length > 0) {
              // Try ruff first (fast), fall back to flake8, then python -m py_compile
              const pyList = pyFiles.join(' ');
              let pyLinted = false;
              try {
                const out = execSync(`timeout 10 ruff check --output-format concise ${pyList} 2>&1 | head -40`, { cwd, encoding: 'utf-8', timeout: 15_000 }).trim();
                if (out && out.length > 0) { lintErrors.push(`[Python/Ruff]\n${out}`); pyLinted = true; }
                else pyLinted = true; // ruff ran but no errors
              } catch (_e) { /* ruff not available */ }
              if (!pyLinted) {
                try {
                  const out = execSync(`timeout 10 flake8 --max-line-length 120 ${pyList} 2>&1 | head -40`, { cwd, encoding: 'utf-8', timeout: 15_000 }).trim();
                  if (out && out.length > 0) { lintErrors.push(`[Python/Flake8]\n${out}`); pyLinted = true; }
                  else pyLinted = true;
                } catch (_e) { /* flake8 not available */ }
              }
              if (!pyLinted) {
                // Fallback: syntax check only
                for (const pf of pyFiles.slice(0, 5)) {
                  try {
                    const out = execSync(`python3 -m py_compile "${pf}" 2>&1`, { cwd, encoding: 'utf-8', timeout: 10_000 }).trim();
                    if (out) lintErrors.push(`[Python/Syntax] ${pf}\n${out}`);
                  } catch (_e) { /* python3 not available */ }
                }
              }
            }
          }

          // Rust
          if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
            try {
              const out = execSync('timeout 30 cargo check --message-format short 2>&1 | grep "^error" | head -20', { cwd, encoding: 'utf-8', timeout: 35_000 }).trim();
              if (out) lintErrors.push(`[Rust]\n${out}`);
            } catch (_e) { /* cargo not available */ }
          }

          // Go
          if (fs.existsSync(path.join(cwd, 'go.mod'))) {
            try {
              const out = execSync('timeout 15 go vet ./... 2>&1 | head -20', { cwd, encoding: 'utf-8', timeout: 20_000 }).trim();
              if (out) lintErrors.push(`[Go/vet]\n${out}`);
            } catch (_e) { /* go not available */ }
            try {
              const out = execSync('timeout 15 go build ./... 2>&1 | grep -E "^\\./|error" | head -20', { cwd, encoding: 'utf-8', timeout: 20_000 }).trim();
              if (out && /error/i.test(out)) lintErrors.push(`[Go/build]\n${out}`);
            } catch (_e) { /* go build failed or not available */ }
          }

          // Java (Maven or Gradle)
          if (fs.existsSync(path.join(cwd, 'pom.xml'))) {
            try {
              const out = execSync('timeout 30 mvn compile -q 2>&1 | grep -E "ERROR|error" | head -20', { cwd, encoding: 'utf-8', timeout: 35_000 }).trim();
              if (out) lintErrors.push(`[Java/Maven]\n${out}`);
            } catch (_e) { /* mvn not available */ }
          } else if (fs.existsSync(path.join(cwd, 'build.gradle')) || fs.existsSync(path.join(cwd, 'build.gradle.kts'))) {
            try {
              const out = execSync('timeout 30 gradle compileJava -q 2>&1 | grep -E "error:" | head -20', { cwd, encoding: 'utf-8', timeout: 35_000 }).trim();
              if (out) lintErrors.push(`[Java/Gradle]\n${out}`);
            } catch (_e) { /* gradle not available */ }
          }

          // C / C++ (Makefile-based)
          if (fs.existsSync(path.join(cwd, 'Makefile')) || fs.existsSync(path.join(cwd, 'CMakeLists.txt'))) {
            const cFiles = changedFiles.filter(f => /\.[ch](pp|xx)?$/.test(f) || f.endsWith('.cc'));
            if (cFiles.length > 0) {
              // Try compiling changed files with syntax check only
              for (const cf of cFiles.slice(0, 5)) {
                const ext = cf.endsWith('.c') ? 'c' : 'c++';
                const compiler = ext === 'c' ? 'gcc' : 'g++';
                try {
                  const out = execSync(`timeout 10 ${compiler} -fsyntax-only "${cf}" 2>&1 | head -10`, { cwd, encoding: 'utf-8', timeout: 15_000 }).trim();
                  if (out && /error/i.test(out)) lintErrors.push(`[C/${compiler}] ${cf}\n${out}`);
                } catch (_e) { /* compiler not available */ }
              }
            }
          }

          // Ruby
          if (fs.existsSync(path.join(cwd, 'Gemfile'))) {
            const rbFiles = changedFiles.filter(f => f.endsWith('.rb')).slice(0, 10);
            for (const rf of rbFiles) {
              try {
                const out = execSync(`timeout 5 ruby -c "${rf}" 2>&1`, { cwd, encoding: 'utf-8', timeout: 10_000 }).trim();
                if (out && !out.includes('Syntax OK')) lintErrors.push(`[Ruby] ${rf}\n${out}`);
              } catch (_e) { /* ruby not available */ }
            }
          }

          // PHP
          const phpFiles = changedFiles.filter(f => f.endsWith('.php')).slice(0, 10);
          if (phpFiles.length > 0) {
            for (const pf of phpFiles) {
              try {
                const out = execSync(`timeout 5 php -l "${pf}" 2>&1`, { cwd, encoding: 'utf-8', timeout: 10_000 }).trim();
                if (out && !out.includes('No syntax errors')) lintErrors.push(`[PHP] ${pf}\n${out}`);
              } catch (_e) { /* php not available */ }
            }
          }

          // Dart / Flutter
          if (fs.existsSync(path.join(cwd, 'pubspec.yaml'))) {
            try {
              const out = execSync('timeout 15 dart analyze --no-fatal-infos 2>&1 | grep -E "error •|ERROR" | head -20', { cwd, encoding: 'utf-8', timeout: 20_000 }).trim();
              if (out) lintErrors.push(`[Dart]\n${out}`);
            } catch (_e) { /* dart not available */ }
          }

          // Swift
          const swiftFiles = changedFiles.filter(f => f.endsWith('.swift')).slice(0, 10);
          if (swiftFiles.length > 0 && fs.existsSync(path.join(cwd, 'Package.swift'))) {
            try {
              const out = execSync('timeout 30 swift build 2>&1 | grep -E "error:" | head -20', { cwd, encoding: 'utf-8', timeout: 35_000 }).trim();
              if (out) lintErrors.push(`[Swift]\n${out}`);
            } catch (_e) { /* swift not available */ }
          }

          // Kotlin (Gradle)
          const ktFiles = changedFiles.filter(f => f.endsWith('.kt') || f.endsWith('.kts'));
          if (ktFiles.length > 0 && (fs.existsSync(path.join(cwd, 'build.gradle.kts')) || fs.existsSync(path.join(cwd, 'build.gradle')))) {
            try {
              const out = execSync('timeout 30 gradle compileKotlin -q 2>&1 | grep -E "error:" | head -20', { cwd, encoding: 'utf-8', timeout: 35_000 }).trim();
              if (out) lintErrors.push(`[Kotlin]\n${out}`);
            } catch (_e) { /* gradle not available */ }
          }

        } catch (_err) { /* ignore outer failures */ }

        if (lintErrors.length > 0) {
          autoLintText = `\n\n<auto_lint>\nErrors detected after your changes — please fix them:\n${lintErrors.join('\n\n')}\n</auto_lint>`;
        }
      }

      // Auto-review: after file changes, scan for common logical bugs across languages
      let autoReviewText = '';
      if (filesChanged && !abortController.signal.aborted) {
        try {
          const issues: string[] = [];
          const codeExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.dart', '.swift', '.c', '.cpp', '.h', '.hpp']);
          for (const f of changedFiles) {
            const ext = path.extname(f).toLowerCase();
            if (!codeExts.has(ext)) continue;
            const fullPath = path.resolve(cwd, f);
            if (!fs.existsSync(fullPath)) continue;
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');

            // --- Universal checks ---

            // Check: array/list length vs declared count mismatch
            const countMatches = [...content.matchAll(/(?:const|let|var|val|int|size_t)\s+(\w+)\s*(?::\s*\w+)?\s*=\s*(\d+)/g)];
            for (const m of countMatches) {
              const varName = m[1];
              const declaredCount = parseInt(m[2], 10);
              const lowerName = varName.toLowerCase();
              if (!(lowerName.includes('total') || lowerName.includes('count') || lowerName.includes('steps') || lowerName.includes('size') || lowerName.includes('len'))) continue;
              const arrayPattern = /\[([^\]]{20,})\]/g;
              for (const arrMatch of content.matchAll(arrayPattern)) {
                const arrContent = arrMatch[0];
                let depth = 0;
                let commas = 0;
                for (const ch of arrContent) {
                  if (ch === '[' || ch === '(' || ch === '{') depth++;
                  else if (ch === ']' || ch === ')' || ch === '}') depth--;
                  else if (ch === ',' && depth === 1) commas++;
                }
                const elementCount = commas > 0 ? commas + 1 : 0;
                if (elementCount > 0 && Math.abs(elementCount - declaredCount) === 1) {
                  issues.push(`${f}: ${varName} = ${declaredCount} but the associated array appears to have ${elementCount} elements (off-by-one?)`);
                }
              }
            }

            // Check: TODO/FIXME/HACK/XXX left in code
            for (let i = 0; i < lines.length; i++) {
              if (/\b(TODO|FIXME|HACK|XXX)\b/.test(lines[i]) && lines[i].trim().length < 200) {
                issues.push(`${f}:${i + 1}: ${lines[i].trim().slice(0, 120)}`);
              }
            }

            // --- TypeScript / JavaScript specific ---
            if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
              // useState with wrong init
              const stateMatches = [...content.matchAll(/useState<([^>]+)>\(([^)]+)\)/g)];
              for (const sm of stateMatches) {
                const type = sm[1];
                const init = sm[2].trim();
                if (init === 'undefined' && !type.includes('undefined') && !type.includes('null')) {
                  issues.push(`${f}: useState<${type}> initialized with undefined but type doesn't allow it`);
                }
              }
              // console.log left in production code (not test files)
              if (!f.includes('test') && !f.includes('spec')) {
                for (let i = 0; i < lines.length; i++) {
                  if (/console\.log\(/.test(lines[i]) && !lines[i].trim().startsWith('//')) {
                    issues.push(`${f}:${i + 1}: console.log left in code`);
                  }
                }
              }
            }

            // --- Python specific ---
            if (ext === '.py') {
              // Mutable default arguments
              const mutDefaultMatch = [...content.matchAll(/def\s+\w+\([^)]*(\w+)\s*=\s*(\[\]|\{\})/g)];
              for (const m of mutDefaultMatch) {
                issues.push(`${f}: mutable default argument '${m[1]}=${m[2]}' — use None and assign inside function`);
              }
              // bare except
              for (let i = 0; i < lines.length; i++) {
                if (/^\s*except\s*:/.test(lines[i])) {
                  issues.push(`${f}:${i + 1}: bare 'except:' catches all exceptions including KeyboardInterrupt — use 'except Exception:'`);
                }
              }
            }

            // --- Go specific ---
            if (ext === '.go') {
              // Unchecked error (common Go issue)
              for (let i = 0; i < lines.length; i++) {
                // Pattern: function call result assigned but err not checked
                if (/,\s*_\s*:?=\s*\w+/.test(lines[i]) && /\(/.test(lines[i])) {
                  // Only flag if it looks like an error is being discarded
                  if (/err|error/i.test(lines[i]) === false && lines[i].includes('_ =')) {
                    // Skip, this is intentional discard of non-error
                  }
                }
              }
            }

            // --- Rust specific ---
            if (ext === '.rs') {
              // unwrap() in non-test code
              if (!f.includes('test')) {
                for (let i = 0; i < lines.length; i++) {
                  if (/\.unwrap\(\)/.test(lines[i]) && !lines[i].trim().startsWith('//')) {
                    issues.push(`${f}:${i + 1}: .unwrap() used — consider .expect() or proper error handling`);
                  }
                }
              }
            }
          }
          // Dedupe and limit
          const uniqueIssues = [...new Set(issues)].slice(0, 20);
          if (uniqueIssues.length > 0) {
            autoReviewText = `\n\n<auto_review>\nPotential issues detected — please verify and fix:\n${uniqueIssues.join('\n')}\n</auto_review>`;
          }
        } catch (_err) { /* ignore review failures */ }
      }

      messages.push({ role: 'user', content: resultsText + autoLintText + autoReviewText });
    }

    return { history: messages, changedFiles, stats };
  } finally {
    process.removeListener('SIGINT', sigHandler);
  }
}
