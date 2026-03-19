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

/**
 * Returns a user-friendly hint for a detected error, or null if no hint applies.
 */
export function getErrorHint(error: DetectedError): string | null {
  const msg = error.message;

  // Module / dependency not found
  if (error.type === 'module' || /Can't resolve|Cannot find module/i.test(msg)) {
    const pkgMatch = msg.match(/(?:Can't resolve|Cannot find module)\s+['"]([^'"]+)['"]/);
    if (pkgMatch) return `Missing dependency — try: npm install ${pkgMatch[1]}`;
    return 'Check the import path or install the missing package.';
  }

  // Port already in use
  if (/EADDRINUSE/i.test(msg)) {
    return 'Port is already in use. Stop the other process or change the port.';
  }

  // Syntax errors
  if (error.type === 'syntax' || /Unexpected token/i.test(msg)) {
    return 'Check for missing brackets, semicolons, or mismatched quotes near the reported line.';
  }

  // TypeScript type errors
  if (error.type === 'typescript') {
    if (/is not assignable to type/i.test(msg)) return 'Type mismatch — check the expected vs. provided type.';
    if (/Property .+ does not exist/i.test(msg)) return 'Accessing a property that doesn\'t exist on this type. Check spelling or add a type declaration.';
    if (/Cannot find name/i.test(msg)) {
      const nameMatch = msg.match(/Cannot find name\s+'([^']+)'/);
      if (nameMatch) return `'${nameMatch[1]}' is not defined. Import it or check for typos.`;
    }
    if (/has no exported member/i.test(msg)) return 'The import target doesn\'t export this name. Check the library\'s exports.';
    return 'TypeScript type error — review the types at the reported location.';
  }

  // Runtime errors
  if (/ReferenceError/i.test(msg)) return 'A variable or function is used before it\'s defined. Check scope and imports.';
  if (/TypeError.*undefined/i.test(msg)) return 'Trying to access a property on undefined. Add a null check or verify the data flow.';
  if (/TypeError.*null/i.test(msg)) return 'Trying to access a property on null. Ensure the value is initialized.';
  if (/RangeError/i.test(msg)) return 'Value is out of range — check array indices or recursive calls for infinite loops.';
  if (/ENOENT/i.test(msg)) return 'File or directory not found. Check the path exists.';
  if (/EACCES|EPERM/i.test(msg)) return 'Permission denied. Check file permissions or run with appropriate access.';

  return null;
}
