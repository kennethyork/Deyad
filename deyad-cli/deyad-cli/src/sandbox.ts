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
    const timestamp = Date.now().toString(36);
    const sandboxBranch = `deyad-sandbox-${timestamp}`;

    // Commit any pending changes first
    try {
      execSync('git add -A && git commit --allow-empty -m "deyad: pre-sandbox checkpoint"', {
        cwd, stdio: 'pipe', encoding: 'utf-8', shell: '/bin/bash',
      });
    } catch { /* no changes to commit, that's fine */ }

    const startRef = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();

    // Create and switch to sandbox branch
    execSync(`git checkout -b ${sandboxBranch}`, { cwd, stdio: 'pipe' });

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
      execSync('git add -A && git commit -m "deyad: sandbox final changes"', {
        cwd, stdio: 'pipe', encoding: 'utf-8', shell: '/bin/bash',
      });
    } catch { /* nothing to commit */ }

    // Get diff summary
    const diff = execSync(`git diff ${sandbox.startRef}..HEAD --stat`, {
      cwd, encoding: 'utf-8', stdio: 'pipe',
    });

    if (merge) {
      // Switch back to original branch and merge
      execSync(`git checkout ${sandbox.originalBranch}`, { cwd, stdio: 'pipe' });
      execSync(`git merge ${sandbox.sandboxBranch}`, { cwd, stdio: 'pipe' });
      execSync(`git branch -d ${sandbox.sandboxBranch}`, { cwd, stdio: 'pipe' });

      const msg = `Merged sandbox changes into ${sandbox.originalBranch}`;
      sandbox = null;
      return { success: true, message: msg, diff };
    } else {
      // Switch back and discard sandbox
      execSync(`git checkout ${sandbox.originalBranch}`, { cwd, stdio: 'pipe' });
      execSync(`git branch -D ${sandbox.sandboxBranch}`, { cwd, stdio: 'pipe' });

      const msg = `Discarded sandbox. Back on ${sandbox.originalBranch}`;
      sandbox = null;
      return { success: true, message: msg, diff };
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
