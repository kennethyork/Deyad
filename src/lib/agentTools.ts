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

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      unsubData();
      unsubExit();
      window.deyad.terminalKill(termId).catch(() => {});
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
    const checkInterval = setInterval(() => {
      if (output.includes(sentinel)) {
        clearInterval(checkInterval);
        // Give a moment for trailing output
        setTimeout(() => finish(), 500);
      }
    }, 200);

    // Also clear interval on finish
    const origFinish = finish;
    function finishAndClear() {
      clearInterval(checkInterval);
      origFinish();
    }
    // Replace timeout callback
    clearTimeout(timeout);
    setTimeout(() => finishAndClear(), 30_000);
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

After your tool calls, you will receive results in <tool_result> blocks.
You can make multiple tool calls in a single response.
When you are completely finished with the task, output <done/> at the end.
`;
