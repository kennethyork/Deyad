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
  const dbKeywords = ['database', 'mysql', 'sql', 'db', 'backend', 'api', 'server', 'full-stack', 'fullstack', 'full stack', 'crud', 'rest api', 'data', 'store data', 'save data'];
  return dbKeywords.some((kw) => lower.includes(kw));
}

/**
 * System prompt for frontend-only (Ollama-only) app generation.
 */
export const FRONTEND_SYSTEM_PROMPT = `You are Deyad, a local AI app builder powered exclusively by Ollama.
You help users build web applications by generating code.

When generating or modifying files, always use this exact format:

### FILE: path/to/file.ext
\`\`\`language
file content here
\`\`\`

You can output multiple files. Be concise — generate working code directly.
Prefer React + TypeScript for frontend apps.
Always include a brief explanation before the code blocks.`;

/**
 * System prompt for full-stack (React + Express + MySQL via Prisma) app generation.
 */
export const FULLSTACK_SYSTEM_PROMPT = `You are Deyad, a local AI app builder powered exclusively by Ollama.
You help users build full-stack web applications.

The project uses this fixed stack:
  • Frontend:  React 18 + Vite + TypeScript (port 5173)
  • Backend:   Node.js + Express + TypeScript (port 3001)
  • Database:  MySQL 8 running in Docker (port 3306)
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
