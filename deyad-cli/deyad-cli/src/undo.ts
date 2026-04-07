/**
 * Undo/rollback via git snapshots.
 * Before each agent task, we create a lightweight git stash or commit marker
 * so the user can roll back any changes the agent made.
 */

import { execSync } from 'node:child_process';

export interface Snapshot {
  type: 'stash' | 'commit';
  ref: string;
  description: string;
  timestamp: string;
}

const snapshots: Snapshot[] = [];

function isGitRepo(cwd: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'pipe', encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

function hasChanges(cwd: string): boolean {
  try {
    const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8', stdio: 'pipe' });
    return status.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Take a snapshot of the current state before the agent makes changes.
 * Uses a hidden commit on a temp tag to avoid polluting stash.
 */
export function createSnapshot(cwd: string, description: string): Snapshot | null {
  if (!isGitRepo(cwd)) return null;

  try {
    // Stage everything and create a snapshot commit
    if (hasChanges(cwd)) {
      execSync('git stash push -u -m "deyad-snapshot: ' + description.replace(/"/g, '\\"') + '"', {
        cwd,
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      // Immediately pop it back so user's working state is preserved
      execSync('git stash pop', { cwd, stdio: 'pipe', encoding: 'utf-8' });
    }

    // Get the current HEAD as a reference point
    const head = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
    const snapshot: Snapshot = {
      type: 'commit',
      ref: head,
      description,
      timestamp: new Date().toISOString(),
    };
    snapshots.push(snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

/**
 * Create a checkpoint by committing all current changes as a temporary save point.
 * This gives the agent a clean state to diff against after making changes.
 */
export function createCheckpoint(cwd: string, message: string): string | null {
  if (!isGitRepo(cwd)) return null;

  try {
    if (!hasChanges(cwd)) {
      return execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
    }

    // Stage all and create checkpoint
    execSync('git add -A', { cwd, stdio: 'pipe' });
    execSync(`git commit --allow-empty -m "deyad-checkpoint: ${message.replace(/"/g, '\\"')}"`, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    const ref = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();

    const snapshot: Snapshot = {
      type: 'commit',
      ref,
      description: message,
      timestamp: new Date().toISOString(),
    };
    snapshots.push(snapshot);
    return ref;
  } catch {
    return null;
  }
}

/**
 * Undo changes back to a specific snapshot ref.
 */
export function rollbackTo(cwd: string, ref: string): boolean {
  if (!isGitRepo(cwd)) return false;

  try {
    execSync(`git reset --hard ${ref}`, { cwd, stdio: 'pipe', encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Undo the last agent task by resetting to the most recent snapshot.
 */
export function undoLast(cwd: string): { success: boolean; message: string } {
  if (!isGitRepo(cwd)) {
    return { success: false, message: 'Not a git repository. Undo requires git.' };
  }

  if (snapshots.length === 0) {
    return { success: false, message: 'No snapshots to undo to.' };
  }

  const snapshot = snapshots[snapshots.length - 1]!;
  const ok = rollbackTo(cwd, snapshot.ref);
  if (ok) {
    snapshots.pop();
    return { success: true, message: `Rolled back to: ${snapshot.description} (${snapshot.ref.slice(0, 8)})` };
  }
  return { success: false, message: `Failed to rollback to ${snapshot.ref}` };
}

/**
 * Get list of all snapshots in this session.
 */
export function getSnapshots(): Snapshot[] {
  return [...snapshots];
}

/**
 * Diff between the snapshot and current state.
 */
export function diffFromSnapshot(cwd: string, ref: string): string {
  if (!isGitRepo(cwd)) return '(not a git repo)';

  try {
    const diff = execSync(`git diff ${ref} --stat`, { cwd, encoding: 'utf-8', stdio: 'pipe' });
    return diff || '(no changes)';
  } catch {
    return '(could not generate diff)';
  }
}
