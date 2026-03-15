/**
 * Agent tool definitions and executor for autonomous mode.
 *
 * The AI model outputs XML tool calls like:
 *   <tool_call>
 *   <name>tool_name</name>
 *   <param name="key">value</param>
 *   </tool_call>
 *
 * This module parses those calls and executes them against the Deyad IPC API.
 */

export interface ToolCall {
  name: string;
  params: Record<string, string>;
}

export interface ToolResult {
  tool: string;
  success: boolean;
  output: string;
}

/** Parse all <tool_call> blocks from an AI response. */
export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const pattern = /<tool_call>\s*<name>([\s\S]*?)<\/name>([\s\S]*?)<\/tool_call>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const name = match[1].trim();
    const body = match[2];
    const params: Record<string, string> = {};
    const paramPattern = /<param\s+name="([^"]+)">([\s\S]*?)<\/param>/g;
    let pm: RegExpExecArray | null;
    while ((pm = paramPattern.exec(body)) !== null) {
      params[pm[1].trim()] = pm[2];
    }
    calls.push({ name, params });
  }
  return calls;
}

/** Check whether the response contains a <done/> signal. */
export function isDone(text: string): boolean {
  return /<done\s*\/?>/.test(text);
}

/** Strip tool_call and done tags from response, leaving only prose/code for display. */
export function stripToolMarkup(text: string): string {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .replace(/<tool_result>[\s\S]*?<\/tool_result>/g, '')
    .replace(/<done\s*\/?>/g, '')
    .trim();
}

/**
 * Execute a single tool call. Returns a human-readable result string.
 *
 * appId is required so all file/terminal operations are scoped to the project.
 */
export async function executeTool(
  call: ToolCall,
  appId: string,
): Promise<ToolResult> {
  try {
    switch (call.name) {
      case 'list_files': {
        const files = await window.deyad.readFiles(appId);
        const paths = Object.keys(files).sort();
        return { tool: call.name, success: true, output: paths.join('\n') || '(no files)' };
      }

      case 'read_file': {
        const filePath = call.params.path;
        if (!filePath) return { tool: call.name, success: false, output: 'Missing "path" parameter.' };
        const files = await window.deyad.readFiles(appId);
        const content = files[filePath];
        if (content === undefined) {
          return { tool: call.name, success: false, output: `File not found: ${filePath}` };
        }
        return { tool: call.name, success: true, output: content };
      }

      case 'write_files': {
        // Expect params like file_0_path / file_0_content, file_1_path / file_1_content ...
        const fileMap: Record<string, string> = {};
        // Also support a single path/content pair
        if (call.params.path && call.params.content !== undefined) {
          fileMap[call.params.path] = call.params.content;
        }
        for (let i = 0; i < 50; i++) {
          const p = call.params[`file_${i}_path`];
          const c = call.params[`file_${i}_content`];
          if (!p) break;
          fileMap[p] = c ?? '';
        }
        if (Object.keys(fileMap).length === 0) {
          return { tool: call.name, success: false, output: 'No files specified.' };
        }
        await window.deyad.writeFiles(appId, fileMap);
        return {
          tool: call.name,
          success: true,
          output: `Wrote ${Object.keys(fileMap).length} file(s): ${Object.keys(fileMap).join(', ')}`,
        };
      }

      case 'run_command': {
        const cmd = call.params.command;
        if (!cmd) return { tool: call.name, success: false, output: 'Missing "command" parameter.' };
        return await executeCommand(appId, cmd);
      }

      case 'search_files': {
        const query = call.params.query;
        if (!query) return { tool: call.name, success: false, output: 'Missing "query" parameter.' };
        const files = await window.deyad.readFiles(appId);
        const lowerQ = query.toLowerCase();
        const matches: string[] = [];
        for (const [path, content] of Object.entries(files)) {
          if (path.toLowerCase().includes(lowerQ) || content.toLowerCase().includes(lowerQ)) {
            matches.push(path);
          }
        }
        return {
          tool: call.name,
          success: true,
          output: matches.length > 0 ? matches.join('\n') : 'No matches found.',
        };
      }

      case 'db_schema': {
        const schema = await window.deyad.dbDescribe(appId);
        if (schema.tables.length === 0) {
          return { tool: call.name, success: true, output: 'No tables found (schema may be empty or DB not running).' };
        }
        const text = schema.tables
          .map((t) => `${t.name}: ${t.columns.join(', ')}`)
          .join('\n');
        return { tool: call.name, success: true, output: text };
      }

      case 'git_status': {
        const termId = await window.deyad.createTerminal(appId);
        return await executeCommand(appId, 'git status --short');
      }

      case 'git_commit': {
        const msg = call.params.message || 'Update files';
        const res = await window.deyad.gitCommitAgent(appId, msg);
        return { tool: call.name, success: res.success, output: res.output || res.error || 'Committed.' };
      }

      case 'git_remote_set': {
        const url = call.params.url;
        if (!url) return { tool: call.name, success: false, output: 'Missing "url" parameter.' };
        const res = await window.deyad.gitRemoteSet(appId, url);
        return { tool: call.name, success: res.success, output: res.success ? `Remote origin set to ${url}` : `Failed: ${res.error}` };
      }

      case 'git_remote_get': {
        const remote = await window.deyad.gitRemoteGet(appId);
        return { tool: call.name, success: true, output: remote || 'No remote configured.' };
      }

      case 'git_push': {
        const res = await window.deyad.gitPush(appId);
        return { tool: call.name, success: res.success, output: res.success ? 'Pushed successfully.' : `Push failed: ${res.error}` };
      }

      case 'git_pull': {
        const res = await window.deyad.gitPull(appId);
        return { tool: call.name, success: res.success, output: res.success ? 'Pulled successfully.' : `Pull failed: ${res.error}` };
      }

      case 'git_branch': {
        const info = await window.deyad.gitBranch(appId);
        const list = info.branches.map(b => b === info.current ? `* ${b}` : `  ${b}`).join('\n');
        return { tool: call.name, success: true, output: `Current: ${info.current}\n${list}` };
      }

      case 'git_branch_create': {
        const name = call.params.name;
        if (!name) return { tool: call.name, success: false, output: 'Missing "name" parameter.' };
        const res = await window.deyad.gitBranchCreate(appId, name);
        return { tool: call.name, success: res.success, output: res.success ? `Created and switched to branch ${name}` : `Failed: ${res.error}` };
      }

      case 'git_branch_switch': {
        const name = call.params.name;
        if (!name) return { tool: call.name, success: false, output: 'Missing "name" parameter.' };
        const res = await window.deyad.gitBranchSwitch(appId, name);
        return { tool: call.name, success: res.success, output: res.success ? `Switched to branch ${name}` : `Failed: ${res.error}` };
      }

      case 'git_log': {
        const entries = await window.deyad.gitLog(appId);
        if (entries.length === 0) return { tool: call.name, success: true, output: 'No commits yet.' };
        const log = entries.slice(0, 10).map(e => `${e.hash.slice(0, 7)} ${e.message} (${e.date})`).join('\n');
        return { tool: call.name, success: true, output: log };
      }

      case 'edit_file': {
        const filePath = call.params.path;
        const oldStr = call.params.old_string;
        const newStr = call.params.new_string;
        if (!filePath) return { tool: call.name, success: false, output: 'Missing "path" parameter.' };
        if (oldStr === undefined) return { tool: call.name, success: false, output: 'Missing "old_string" parameter.' };
        if (newStr === undefined) return { tool: call.name, success: false, output: 'Missing "new_string" parameter.' };

        const files = await window.deyad.readFiles(appId);
        const content = files[filePath];
        if (content === undefined) {
          return { tool: call.name, success: false, output: `File not found: ${filePath}` };
        }
        const occurrences = content.split(oldStr).length - 1;
        if (occurrences === 0) {
          return { tool: call.name, success: false, output: `old_string not found in ${filePath}. Make sure the string matches exactly (including whitespace).` };
        }
        if (occurrences > 1) {
          return { tool: call.name, success: false, output: `old_string found ${occurrences} times in ${filePath}. It must match exactly once. Add more context to make it unique.` };
        }
        const updated = content.replace(oldStr, newStr);
        await window.deyad.writeFiles(appId, { [filePath]: updated });
        return { tool: call.name, success: true, output: `Edited ${filePath} (replaced 1 occurrence).` };
      }

      case 'multi_edit': {
        // Parse indexed edit operations: edit_0_path, edit_0_old_string, edit_0_new_string, ...
        const edits: Array<{ path: string; oldStr: string; newStr: string }> = [];
        for (let i = 0; i < 20; i++) {
          const p = call.params[`edit_${i}_path`];
          const o = call.params[`edit_${i}_old_string`];
          const n = call.params[`edit_${i}_new_string`];
          if (!p) break;
          if (o === undefined || n === undefined) {
            return { tool: call.name, success: false, output: `Edit ${i}: missing old_string or new_string.` };
          }
          edits.push({ path: p, oldStr: o, newStr: n });
        }
        if (edits.length === 0) {
          return { tool: call.name, success: false, output: 'No edits specified. Use edit_0_path, edit_0_old_string, edit_0_new_string, ...' };
        }

        const files = await window.deyad.readFiles(appId);
        const writeMap: Record<string, string> = {};
        const results: string[] = [];
        let hasError = false;

        for (let i = 0; i < edits.length; i++) {
          const { path: fp, oldStr: o, newStr: n } = edits[i];
          // Use already-modified version if we edited this file earlier in the batch
          const content = writeMap[fp] ?? files[fp];
          if (content === undefined) {
            results.push(`Edit ${i} (${fp}): FAILED — file not found`);
            hasError = true;
            continue;
          }
          const occurrences = content.split(o).length - 1;
          if (occurrences === 0) {
            results.push(`Edit ${i} (${fp}): FAILED — old_string not found`);
            hasError = true;
            continue;
          }
          if (occurrences > 1) {
            results.push(`Edit ${i} (${fp}): FAILED — old_string found ${occurrences} times (must be unique)`);
            hasError = true;
            continue;
          }
          writeMap[fp] = content.replace(o, n);
          results.push(`Edit ${i} (${fp}): OK`);
        }

        // Write all modified files at once
        if (Object.keys(writeMap).length > 0) {
          await window.deyad.writeFiles(appId, writeMap);
        }

        const editedCount = results.filter((r) => r.includes(': OK')).length;
        return {
          tool: call.name,
          success: !hasError,
          output: `Applied ${editedCount}/${edits.length} edits:\n${results.join('\n')}`,
        };
      }

      default:
        return { tool: call.name, success: false, output: `Unknown tool: ${call.name}` };
    }
  } catch (err) {
    return {
      tool: call.name,
      success: false,
      output: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Run a shell command inside the project directory via the terminal IPC.
 * Collects output for up to 30 seconds and returns it.
 */
async function executeCommand(appId: string, command: string): Promise<ToolResult> {
  return new Promise(async (resolve) => {
    let output = '';
    let done = false;
    const termId = await window.deyad.createTerminal(appId);
    const timeout = setTimeout(() => finish(), 30_000);

    const unsubData = window.deyad.onTerminalData(({ id, data }) => {
      if (id === termId) output += data;
    });

    const unsubExit = window.deyad.onTerminalExit(({ id }) => {
      if (id === termId) finish();
    });

    // Interval handle — must be accessible to finish() for cleanup
    let checkInterval: ReturnType<typeof setInterval> | null = null;

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      if (checkInterval) clearInterval(checkInterval);
      unsubData();
      unsubExit();
      window.deyad.terminalKill(termId).catch((err) => console.warn('terminalKill:', err));
      // Strip ANSI escape codes for cleaner output
      const cleaned = output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim();
      // Truncate to avoid blowing up context
      const truncated = cleaned.length > 4000 ? cleaned.slice(-4000) + '\n... (truncated)' : cleaned;
      resolve({ tool: 'run_command', success: true, output: truncated || '(no output)' });
    }

    // Write the command + Enter, then a sentinel so we know when it finishes
    const sentinel = `__DEYAD_DONE_${Date.now()}__`;
    await window.deyad.terminalWrite(termId, `${command} ; echo "${sentinel}"\n`);

    // Watch for sentinel in output
    checkInterval = setInterval(() => {
      if (output.includes(sentinel)) {
        clearInterval(checkInterval!);
        checkInterval = null;
        // Give a moment for trailing output
        setTimeout(() => finish(), 500);
      }
    }, 200);
  });
}

/** The list of available tools, formatted for the system prompt. */
export const AGENT_TOOLS_DESCRIPTION = `You have the following tools available. Call them using XML syntax:

<tool_call>
<name>tool_name</name>
<param name="key">value</param>
</tool_call>

Available tools:

1. **list_files** — List all files in the project.
   No parameters.

2. **read_file** — Read the contents of a file.
   <param name="path">relative/path/to/file</param>

3. **write_files** — Write one or more files to the project.
   For a single file:
   <param name="path">relative/path/to/file</param>
   <param name="content">file content here</param>
   For multiple files use indexed params:
   <param name="file_0_path">path/to/first</param>
   <param name="file_0_content">content of first</param>
   <param name="file_1_path">path/to/second</param>
   <param name="file_1_content">content of second</param>

4. **run_command** — Run a shell command in the project directory.
   <param name="command">npm install express</param>

5. **search_files** — Search for files containing a query string.
   <param name="query">search term</param>

6. **db_schema** — Get the current database schema (Prisma models).
   No parameters.

7. **edit_file** — Make a surgical edit to a file by replacing an exact string match.
   <param name="path">relative/path/to/file</param>
   <param name="old_string">exact text to find (must appear exactly once)</param>
   <param name="new_string">replacement text</param>
   Prefer edit_file over write_files when you only need to change a small part of a file.
   Include enough surrounding context in old_string so it matches exactly once.

8. **multi_edit** — Apply multiple surgical edits across one or more files in a single operation.
   Use indexed params for each edit:
   <param name="edit_0_path">path/to/first/file</param>
   <param name="edit_0_old_string">exact text to find in first file</param>
   <param name="edit_0_new_string">replacement for first file</param>
   <param name="edit_1_path">path/to/second/file</param>
   <param name="edit_1_old_string">exact text to find in second file</param>
   <param name="edit_1_new_string">replacement for second file</param>
   Supports up to 20 edits. Edits to the same file are applied sequentially (each sees previous edits).
   Use this instead of multiple edit_file calls when you need to change several files at once.

9. **git_status** — Show the current git status (changed/untracked files).
   No parameters.

10. **git_commit** — Stage all changes and commit.
   <param name="message">commit message</param>

11. **git_remote_get** — Get the current remote origin URL.
   No parameters.

12. **git_remote_set** — Set the remote origin URL (GitHub, GitLab, etc.).
   <param name="url">https://github.com/user/repo.git</param>

13. **git_push** — Push commits to the remote repository.
   No parameters.

14. **git_pull** — Pull latest changes from the remote repository.
   No parameters.

15. **git_branch** — List all branches and show the current one.
   No parameters.

16. **git_branch_create** — Create a new branch and switch to it.
   <param name="name">feature-xyz</param>

17. **git_branch_switch** — Switch to an existing branch.
   <param name="name">main</param>

18. **git_log** — Show recent commit history.
   No parameters.

After your tool calls, you will receive results in <tool_result> blocks.
You can make multiple tool calls in a single response.
When you are completely finished with the task, output <done/> at the end.
`;
