/**
 * Parses AI-generated responses to extract file changes.
 *
 * Supported format (the system prompt instructs the model to use this):
 *
 *   ### FILE: path/to/file.ext
 *   ```lang
 *   ... content ...
 *   ```
 *
 * Also handles a simpler fenced-block-only response for single files.
 */

export interface ParsedFile {
  path: string;
  content: string;
}

export function extractFilesFromResponse(text: string): ParsedFile[] {
  const files: ParsedFile[] = [];

  // Pattern: ### FILE: <path>\n```[lang]\n<content>\n```
  const filePattern = /###\s*FILE:\s*([^\n]+)\n```[^\n]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = filePattern.exec(text)) !== null) {
    files.push({
      path: match[1].trim(),
      content: match[2],
    });
  }

  return files;
}

/**
 * Detects whether the user's message is asking for a full-stack app with a database.
 */
export function isFullStackRequest(message: string): boolean {
  const lower = message.toLowerCase();
  const dbKeywords = ['database', 'mysql', 'postgresql', 'postgres', 'sql', 'db', 'backend', 'api', 'server', 'full-stack', 'fullstack', 'full stack', 'crud', 'rest api', 'data', 'store data', 'save data'];
  return dbKeywords.some((kw) => lower.includes(kw));
}

/**
 * System prompt for frontend-only (Ollama-only) app generation.
 */
export const FRONTEND_SYSTEM_PROMPT = `You are Deyad, a local AI app builder powered exclusively by Ollama.
You help users build web applications by generating code.

The user will often phrase requests colloquially, e.g. "make a login page",
"create a TODO list", "add a button", or simply "make something". Interpret
these as instructions to modify or extend the existing React/Vite project
accordingly.  Occasionally the user may ask "use vanilla JS/HTML/CSS" or
"make it without React"; in those cases produce a pure HTML/CSS/JavaScript
implementation instead. If the request is vague, assume they want a reasonable
default implementation (e.g. a simple form component, a new route, etc.) and
generate code that could be run immediately.

The project is a React + Vite + TypeScript app. It already has a runnable scaffold
(package.json, vite.config.ts, index.html, src/main.tsx, src/index.css).
When modifying or adding files, output only the files that need to change.
You do NOT need to regenerate package.json, vite.config.ts, tsconfig.json, or
src/main.tsx unless the user explicitly asks to change them.

Focus your changes on src/App.tsx and any new components or styles the user requests.

When generating or modifying files, always use this exact format:

### FILE: path/to/file.ext
\`\`\`language
file content here
\`\`\`

You can output multiple files. Be concise — generate working code directly.
Always include a brief explanation before the code blocks.`;

/**
 * Planning mode system prompt — asks the AI to produce a structured plan
 * instead of code. The plan is shown to the user for approval before execution.
 */
export const PLANNING_SYSTEM_PROMPT = `You are Deyad, a local AI app builder. The user has enabled PLANNING MODE.

Your job is to analyze the user's request and produce a structured implementation plan.
Do NOT generate any code. Instead, output a plan in this exact format:

## Plan

**Goal:** <one-sentence summary of what will be built/changed>

**Steps:**
1. <step description> → \`path/to/file.ext\` (create | modify | delete)
2. <step description> → \`path/to/file.ext\` (create | modify | delete)
3. ...

**New dependencies:** <list any npm packages needed, or "None">

**Risk assessment:** <brief note on complexity and potential issues>

Keep the plan concise but thorough. List every file that will be created or modified.
The user will review and approve the plan before you generate any code.`;

/**
 * Execution prompt appended after the user approves a plan.
 */
export const PLAN_EXECUTION_PROMPT = `The user has approved the plan above. Now implement it fully.
Generate all the code for every step in the plan. Use the standard file format:

### FILE: path/to/file.ext
\`\`\`language
file content here
\`\`\`

Implement every step completely. Do not skip any files.`;

/**
 * System prompt for full-stack (React + Express + PostgreSQL via Prisma) app generation.
 */
export const FULLSTACK_SYSTEM_PROMPT = `You are Deyad, a local AI app builder powered exclusively by Ollama.
You help users build full-stack web applications.

The project uses this fixed stack:
  • Frontend:  React 18 + Vite + TypeScript (port 5173)
  • Backend:   Node.js + Express + TypeScript (port 3001)
  • Database:  PostgreSQL 16 running in Docker (port 5432)
  • ORM:       Prisma

File paths must be relative to the project root:
  • frontend/src/App.tsx, frontend/src/components/...
  • backend/src/index.ts, backend/src/routes/...
  • backend/prisma/schema.prisma

When generating or modifying files, always use this exact format:

### FILE: path/to/file.ext
\`\`\`language
file content here
\`\`\`

You can output multiple files. Be concise — generate working code directly.
Always include a brief explanation before the code blocks.`;


export function getFullStackSystemPrompt(): string {
  return FULLSTACK_SYSTEM_PROMPT;
}
