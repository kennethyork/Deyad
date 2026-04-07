/**
 * Sandboxed execution for full-auto mode.
 * Creates a temporary git branch for agent work that can be reviewed before merging.
 */

import { execSync } from 'node:child_process';

export interface SandboxState {
  active: boolean;
  originalBranch: string;
  sandboxBranch: string;
  startRef: string;
}

let sandbox: SandboxState | null = null;

function isGitRepo(cwd: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function getCurrentBranch(cwd: string): string {
  return execSync('git branch --show-current', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

/**
 * Enter sandbox mode — creates a temporary branch for agent work.
 */
export function enterSandbox(cwd: string): { success: boolean; message: string } {
  if (!isGitRepo(cwd)) {
    return { success: false, message: 'Not a git repository. Sandbox requires git.' };
  }

  if (sandbox?.active) {
    return { success: false, message: `Already in sandbox: ${sandbox.sandboxBranch}` };
  }

  try {
    const originalBranch = getCurrentBranch(cwd);
    if (!/^[\w./-]+$/.test(originalBranch)) {
      return { success: false, message: 'Current branch name contains invalid characters.' };
    }
    const timestamp = Date.now().toString(36);
    const sandboxBranch = `deyad-sandbox-${timestamp}`;

    // Stash any pending changes instead of committing them
    let hadStash = false;
    try {
      const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
      if (status) {
        execSync('git stash push -u -m "deyad: pre-sandbox stash"', {
          cwd, stdio: 'pipe', encoding: 'utf-8',
        });
        hadStash = true;
      }
    } catch { /* no changes to stash, that's fine */ }

    const startRef = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();

    // Create and switch to sandbox branch
    execSync(`git checkout -b ${sandboxBranch}`, { cwd, stdio: 'pipe' });

    // Restore stashed changes in the sandbox
    if (hadStash) {
      try {
        execSync('git stash pop', { cwd, stdio: 'pipe', encoding: 'utf-8' });
      } catch { /* conflicts possible, leave in working dir */ }
    }

    sandbox = { active: true, originalBranch, sandboxBranch, startRef };

    return {
      success: true,
      message: `Sandbox active on branch: ${sandboxBranch} (from ${originalBranch})`,
    };
  } catch (err) {
    return { success: false, message: `Failed to create sandbox: ${String(err)}` };
  }
}

/**
 * Exit sandbox — review changes and optionally merge back.
 */
export function exitSandbox(cwd: string, merge: boolean): { success: boolean; message: string; diff?: string } {
  if (!sandbox?.active) {
    return { success: false, message: 'Not in sandbox mode.' };
  }

  try {
    // Commit any remaining changes in sandbox
    try {
      const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
      if (status) {
        execSync('git add -A', { cwd, stdio: 'pipe' });
        execSync('git commit -m "deyad: sandbox final changes"', {
          cwd, stdio: 'pipe', encoding: 'utf-8',
        });
      }
    } catch { /* nothing to commit */ }

    // Get diff summary
    const diff = execSync(`git diff ${sandbox.startRef}..HEAD --stat`, {
      cwd, encoding: 'utf-8', stdio: 'pipe',
    });

    const savedSandbox = { ...sandbox };
    sandbox = null; // Clear state early to avoid stuck sandbox on error

    if (merge) {
      // Switch back to original branch and merge
      execSync(`git checkout ${savedSandbox.originalBranch}`, { cwd, stdio: 'pipe' });
      execSync(`git merge ${savedSandbox.sandboxBranch}`, { cwd, stdio: 'pipe' });
      execSync(`git branch -d ${savedSandbox.sandboxBranch}`, { cwd, stdio: 'pipe' });

      return { success: true, message: `Merged sandbox changes into ${savedSandbox.originalBranch}`, diff };
    } else {
      // Switch back and discard sandbox
      execSync(`git checkout ${savedSandbox.originalBranch}`, { cwd, stdio: 'pipe' });
      execSync(`git branch -D ${savedSandbox.sandboxBranch}`, { cwd, stdio: 'pipe' });

      return { success: true, message: `Discarded sandbox. Back on ${savedSandbox.originalBranch}`, diff };
    }
  } catch (err) {
    return { success: false, message: `Sandbox exit failed: ${String(err)}` };
  }
}

/**
 * Check if currently in sandbox mode.
 */
export function isSandboxed(): boolean {
  return sandbox?.active ?? false;
}

/**
 * Get current sandbox state.
 */
export function getSandboxState(): SandboxState | null {
  return sandbox;
}
