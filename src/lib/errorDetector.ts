/**
 * Error detection utilities.
 * Parses build/runtime error messages from dev server logs and terminal output
 * to enable auto-fix suggestions.
 */

export interface DetectedError {
  type: 'build' | 'runtime' | 'typescript' | 'syntax' | 'module';
  message: string;
  file?: string;
  line?: number;
  column?: number;
  raw: string;
}

/**
 * Parses a log line or chunk for known error patterns.
 */
export function detectErrors(text: string): DetectedError[] {
  const errors: DetectedError[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // File-based TS error: "src/file.tsx(line,col): error TS..." (check before generic TS match)
    const tsFileMatch = trimmed.match(/^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+:\s*.+)/);
    if (tsFileMatch) {
      errors.push({
        type: 'typescript',
        file: tsFileMatch[1],
        line: parseInt(tsFileMatch[2], 10),
        column: parseInt(tsFileMatch[3], 10),
        message: tsFileMatch[4],
        raw: trimmed,
      });
      continue;
    }

    // Vite / TypeScript errors: "ERROR(TS2345): ..." or "error TS..."
    const tsMatch = trimmed.match(/(?:ERROR|error)\s*\(?TS(\d+)\)?[:\s]+(.+)/i);
    if (tsMatch) {
      errors.push({ type: 'typescript', message: tsMatch[2].trim(), raw: trimmed });
      continue;
    }

    // Vite error: "✘ [ERROR] ..." or "[vite] Internal server error: ..."
    const viteMatch = trimmed.match(/(?:✘\s*\[ERROR\]|Internal server error:)\s*(.+)/);
    if (viteMatch) {
      errors.push({ type: 'build', message: viteMatch[1].trim(), raw: trimmed });
      continue;
    }

    // Module not found: "Module not found: Error: Can't resolve..."
    const moduleMatch = trimmed.match(/Module not found:?\s*(?:Error:\s*)?(.+)/i);
    if (moduleMatch) {
      errors.push({ type: 'module', message: moduleMatch[1].trim(), raw: trimmed });
      continue;
    }

    // SyntaxError: Unexpected token...
    const syntaxMatch = trimmed.match(/SyntaxError:\s*(.+)/);
    if (syntaxMatch) {
      errors.push({ type: 'syntax', message: syntaxMatch[1].trim(), raw: trimmed });
      continue;
    }

    // Generic "error" keyword with file path
    const genericMatch = trimmed.match(/^(.+?\.[a-z]{1,4}):(\d+):(\d+):\s*(?:error|Error):?\s*(.+)/);
    if (genericMatch) {
      errors.push({
        type: 'build',
        file: genericMatch[1],
        line: parseInt(genericMatch[2], 10),
        column: parseInt(genericMatch[3], 10),
        message: genericMatch[4].trim(),
        raw: trimmed,
      });
      continue;
    }

    // Runtime errors from browser console style
    if (/\bUncaught\b|\bTypeError\b|\bReferenceError\b|\bRangeError\b/.test(trimmed)) {
      errors.push({ type: 'runtime', message: trimmed, raw: trimmed });
    }
  }

  return errors;
}

/**
 * Builds a prompt to send to the AI when auto-fixing detected errors.
 */
export function buildErrorFixPrompt(errors: DetectedError[], fileContents?: Record<string, string>): string {
  const errorSummary = errors
    .map((e) => {
      let desc = `[${e.type.toUpperCase()}] ${e.message}`;
      if (e.file) desc += ` (in ${e.file}${e.line ? `:${e.line}` : ''})`;
      return desc;
    })
    .join('\n');

  let prompt = `The project has the following errors that need to be fixed:\n\n${errorSummary}\n\nPlease fix these errors. Output the corrected files using the standard format.`;

  if (fileContents) {
    const affected = errors.map((e) => e.file).filter(Boolean) as string[];
    const unique = [...new Set(affected)];
    const relevant = unique.filter((f) => fileContents[f]);
    if (relevant.length > 0) {
      prompt += '\n\nHere are the affected files:\n';
      for (const f of relevant) {
        prompt += `\n### ${f}\n\`\`\`\n${fileContents[f]}\n\`\`\`\n`;
      }
    }
  }

  return prompt;
}
