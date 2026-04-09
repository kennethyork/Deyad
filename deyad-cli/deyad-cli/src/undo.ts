/**
 * Undo/rollback via git snapshots.
 * Before each agent task, we create a lightweight git stash or commit marker
 * so the user can roll back any changes the agent made.
 */

import { git, isGitRepo, hasChanges } from './git-utils.js';

export interface Snapshot {
  type: 'stash' | 'commit';
  ref: string;
  description: string;
  timestamp: string;
}

const snapshots: Snapshot[] = [];

/**
 * Take a snapshot of the current state before the agent makes changes.
 * Saves the current HEAD so we can reset back to it after the agent acts.
 * If there are uncommitted changes, stashes them as a named stash entry.
 */
export function createSnapshot(cwd: string, description: string): Snapshot | null {
  if (!isGitRepo(cwd)) return null;

  try {
    const head = git(['rev-parse', 'HEAD'], cwd);
    let type: Snapshot['type'] = 'commit';

    // If there are uncommitted changes, create a stash entry to preserve them
    if (hasChanges(cwd)) {
      const safeDesc = description.replace(/["\\`$]/g, '_');
      try {
        git(['stash', 'push', '-u', '-m', `deyad-snapshot: ${safeDesc}`], cwd);
        type = 'stash';
        // Pop it back so working directory is unchanged
        git(['stash', 'pop'], cwd);
      } catch (err) {
        // If stash fails, fall back to HEAD ref
        if (process.env['DEYAD_DEBUG']) console.error('[undo] stash failed:', err);
        type = 'commit';
      }
    }

    const snapshot: Snapshot = {
      type,
      ref: head, // Always use HEAD as the rollback target
      description,
      timestamp: new Date().toISOString(),
    };
    snapshots.push(snapshot);
    return snapshot;
  } catch (err) {
    if (process.env['DEYAD_DEBUG']) console.error('[undo] createSnapshot:', err);
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
      return git(['rev-parse', 'HEAD'], cwd);
    }

    // Stage all and create checkpoint
    git(['add', '-A'], cwd);
    const safeMsg = message.replace(/["\\`$]/g, '_');
    git(['commit', '--allow-empty', '-m', `deyad-checkpoint: ${safeMsg}`], cwd);
    const ref = git(['rev-parse', 'HEAD'], cwd);

    const snapshot: Snapshot = {
      type: 'commit',
      ref,
      description: message,
      timestamp: new Date().toISOString(),
    };
    snapshots.push(snapshot);
    return ref;
  } catch (err) {
    if (process.env['DEYAD_DEBUG']) console.error('[undo] createCheckpoint:', err);
    return null;
  }
}

/**
 * Undo changes back to a specific snapshot ref.
 */
export function rollbackTo(cwd: string, ref: string): boolean {
  if (!isGitRepo(cwd)) return false;
  // Validate ref is a valid git hash (prevent command injection)
  if (!/^[0-9a-f]{7,40}$/.test(ref)) return false;

  try {
    git(['reset', '--hard', ref], cwd);
    return true;
  } catch (err) {
    if (process.env['DEYAD_DEBUG']) console.error('[undo] rollbackTo:', err);
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
    const diff = git(['diff', ref, '--stat'], cwd);
    return diff || '(no changes)';
  } catch (err) {
    if (process.env['DEYAD_DEBUG']) console.error('[undo] diffFromSnapshot:', err);
    return '(could not generate diff)';
  }
}
