/**
 * Shared git helper utilities used by sandbox.ts and undo.ts.
 */

import { execFileSync } from 'node:child_process';
import { debugLog } from './debug.js';

/** Run a git command and return trimmed stdout. */
export function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf-8' }).toString().trim();
}

/** Check whether the given directory is inside a git work tree. */
export function isGitRepo(cwd: string): boolean {
  try {
    git(['rev-parse', '--is-inside-work-tree'], cwd);
    return true;
  } catch (e) {
    debugLog('isGitRepo check failed: %s', (e as Error).message);
    return false;
  }
}

/** Return true if the working tree has uncommitted changes. */
export function hasChanges(cwd: string): boolean {
  try {
    const status = git(['status', '--porcelain'], cwd);
    return status.length > 0;
  } catch (e) {
    debugLog('hasChanges check failed: %s', (e as Error).message);
    return false;
  }
}

/** Return the current branch name. */
export function getCurrentBranch(cwd: string): string {
  return git(['branch', '--show-current'], cwd);
}
