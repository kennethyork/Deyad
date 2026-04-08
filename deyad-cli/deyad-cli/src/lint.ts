/**
 * Auto-lint — detect project type and run appropriate linters after file edits.
 * Returns lint errors so the agent can self-correct.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

export interface LintResult {
  linter: string;
  errors: string;
  hasErrors: boolean;
}

interface LinterConfig {
  name: string;
  command: string;
  check: (cwd: string) => boolean;
  fileFilter?: (file: string) => boolean;
}

const LINTERS: LinterConfig[] = [
  {
    name: 'tsc',
    command: 'npx tsc --noEmit --pretty 2>&1',
    check: (cwd) => fs.existsSync(path.join(cwd, 'tsconfig.json')),
    fileFilter: (f) => /\.(ts|tsx)$/.test(f),
  },
  {
    name: 'eslint',
    command: 'npx eslint --no-warn-ignored {files} 2>&1',
    check: (cwd) =>
      fs.existsSync(path.join(cwd, 'eslint.config.mjs')) ||
      fs.existsSync(path.join(cwd, 'eslint.config.js')) ||
      fs.existsSync(path.join(cwd, '.eslintrc.json')) ||
      fs.existsSync(path.join(cwd, '.eslintrc.js')) ||
      fs.existsSync(path.join(cwd, '.eslintrc.yml')),
    fileFilter: (f) => /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(f),
  },
  {
    name: 'ruff',
    command: 'ruff check {files} 2>&1',
    check: (cwd) =>
      fs.existsSync(path.join(cwd, 'pyproject.toml')) ||
      fs.existsSync(path.join(cwd, 'ruff.toml')) ||
      fs.existsSync(path.join(cwd, '.ruff.toml')),
    fileFilter: (f) => /\.py$/.test(f),
  },
  {
    name: 'cargo check',
    command: 'cargo check --message-format=short 2>&1',
    check: (cwd) => fs.existsSync(path.join(cwd, 'Cargo.toml')),
    fileFilter: (f) => /\.rs$/.test(f),
  },
  {
    name: 'go vet',
    command: 'go vet ./... 2>&1',
    check: (cwd) => fs.existsSync(path.join(cwd, 'go.mod')),
    fileFilter: (f) => /\.go$/.test(f),
  },
];

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect which linters apply to this project and the changed files.
 */
export function detectLinters(cwd: string, changedFiles: string[]): LinterConfig[] {
  return LINTERS.filter((linter) => {
    if (!linter.check(cwd)) return false;
    if (linter.fileFilter && !changedFiles.some(linter.fileFilter)) return false;
    // Check the base command exists
    const baseCmd = linter.command.split(' ')[0]!;
    if (baseCmd === 'npx') return true; // npx handles availability
    return commandExists(baseCmd);
  });
}

/**
 * Run applicable linters and return errors.
 */
export function runLint(cwd: string, changedFiles: string[]): LintResult[] {
  const linters = detectLinters(cwd, changedFiles);
  const results: LintResult[] = [];

  for (const linter of linters) {
    try {
      // For file-specific linters, substitute changed files
      let command = linter.command;
      if (command.includes('{files}') && linter.fileFilter) {
        const relevantFiles = changedFiles.filter(linter.fileFilter);
        if (relevantFiles.length === 0) continue;
        command = command.replace('{files}', relevantFiles.map((f) => `"${f}"`).join(' '));
      } else {
        command = command.replace(' {files}', '');
      }

      const output = execSync(command, {
        cwd,
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 512 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      // Exit code 0 means no errors
      results.push({ linter: linter.name, errors: '', hasErrors: false });
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      const stdout = (e.stdout || '').trim();
      const stderr = (e.stderr || '').trim();
      const combined = [stdout, stderr].filter(Boolean).join('\n');

      // Truncate long lint output
      const truncated = combined.length > 3000
        ? combined.slice(0, 3000) + '\n... (truncated)'
        : combined;

      results.push({
        linter: linter.name,
        errors: truncated,
        hasErrors: true,
      });
    }
  }

  return results;
}

/**
 * Format lint results into a message for the agent.
 */
export function formatLintErrors(results: LintResult[]): string | null {
  const errors = results.filter((r) => r.hasErrors);
  if (errors.length === 0) return null;

  const parts = errors.map((r) =>
    `[${r.linter}] errors:\n${r.errors}`
  );

  return `AUTO-LINT: The following errors were detected after your edits. Please fix them:\n\n${parts.join('\n\n')}`;
}
