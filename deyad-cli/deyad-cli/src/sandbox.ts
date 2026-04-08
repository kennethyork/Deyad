/**
 * Sandboxed execution for full-auto mode.
 * Creates a temporary git branch for agent work that can be reviewed before merging.
 */

import { execFileSync } from 'node:child_process';

export interface SandboxState {
  active: boolean;
  originalBranch: string;
  sandboxBranch: string;
  startRef: string;
}

let sandbox: SandboxState | null = null;

function git(args: string[], cwd: string, encoding?: 'utf-8'): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: encoding ?? 'utf-8' }).toString().trim();
}

function isGitRepo(cwd: string): boolean {
  try {
    git(['rev-parse', '--is-inside-work-tree'], cwd);
    return true;
  } catch {
    return false;
  }
}

function getCurrentBranch(cwd: string): string {
  return git(['branch', '--show-current'], cwd);
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
      const status = git(['status', '--porcelain'], cwd);
      if (status) {
        git(['stash', 'push', '-u', '-m', 'deyad: pre-sandbox stash'], cwd);
        hadStash = true;
      }
    } catch { /* no changes to stash, that's fine */ }

    const startRef = git(['rev-parse', 'HEAD'], cwd);

    // Create and switch to sandbox branch
    git(['checkout', '-b', sandboxBranch], cwd);

    // Restore stashed changes in the sandbox
    if (hadStash) {
      try {
        git(['stash', 'pop'], cwd);
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

  const savedSandbox = { ...sandbox };
  
  try {
    // Commit any remaining changes in sandbox
    try {
      const status = git(['status', '--porcelain'], cwd);
      if (status) {
        git(['add', '-A'], cwd);
        git(['commit', '-m', 'deyad: sandbox final changes'], cwd);
      }
    } catch { /* nothing to commit */ }

    // Get diff summary
    const diff = git(['diff', `${savedSandbox.startRef}..HEAD`, '--stat'], cwd);

    let result: { success: boolean; message: string; diff?: string };

    if (merge) {
      // Switch back to original branch and merge
      git(['checkout', savedSandbox.originalBranch], cwd);
      try {
        git(['merge', savedSandbox.sandboxBranch, '--no-edit'], cwd);
      } catch (mergeErr) {
        // Merge conflict — parse and present to user
        let conflictInfo = '';
        try {
          conflictInfo = git(['diff', '--name-only', '--diff-filter=U'], cwd);
        } catch { /* ignore */ }

        // Abort the merge so we don't leave the repo in a broken state
        try { git(['merge', '--abort'], cwd); } catch { /* ignore */ }

        const conflictFiles = conflictInfo ? conflictInfo.split('\n').filter(Boolean) : [];
        const conflictMsg = conflictFiles.length > 0
          ? `Merge conflict in ${conflictFiles.length} file(s):\n  ${conflictFiles.join('\n  ')}\n\nThe merge was aborted. The sandbox branch "${savedSandbox.sandboxBranch}" is preserved.\nYou can resolve manually: git checkout ${savedSandbox.sandboxBranch} && git rebase ${savedSandbox.originalBranch}`
          : `Merge conflict detected. The merge was aborted.\nSandbox branch "${savedSandbox.sandboxBranch}" is preserved for manual resolution.`;

        return { success: false, message: conflictMsg, diff };
      }
      git(['branch', '-d', savedSandbox.sandboxBranch], cwd);

      result = { success: true, message: `Merged sandbox changes into ${savedSandbox.originalBranch}`, diff };
    } else {
      // Switch back and discard sandbox
      git(['checkout', savedSandbox.originalBranch], cwd);
      git(['branch', '-D', savedSandbox.sandboxBranch], cwd);

      result = { success: true, message: `Discarded sandbox. Back on ${savedSandbox.originalBranch}`, diff };
    }

    // Only clear state after all git operations succeed
    sandbox = null;
    return result;
  } catch (err) {
    // Don't clear state on error - allows retry
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
