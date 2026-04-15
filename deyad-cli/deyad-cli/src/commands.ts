/**
 * Slash-command handlers for the interactive REPL.
 * Each handler receives the mutable ReplState and returns true if it handled the input.
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import { compactConversation } from './agent.js';
import { memoryList } from './session.js';
import { undoLast, getSnapshots } from './undo.js';
import { enterSandbox, exitSandbox, isSandboxed } from './sandbox.js';
import { buildIndex, getIndexStats } from './rag.js';
import {
  c, divider, Spinner,
  formatStatus, formatHelp, formatError,
  formatSuccess,
} from './tui.js';
import { debugLog } from './debug.js';
import type { ReplState } from './repl.js';

/** Handle a single slash command. Returns true if handled, false if it's a user prompt. */
export async function handleSlashCommand(
  input: string,
  state: ReplState,
): Promise<boolean> {
  const { cfg, rl } = state;

  if (input === 'exit' || input === 'quit') {
    state.saveSession();
    console.log('');
    console.log(divider());
    console.log(c.dim(`  Session saved: ${state.session.id}`));
    console.log(formatStatus(cfg.model, state.taskCount, state.totalTokens, isSandboxed()));
    console.log(c.dim('  Goodbye!'));
    console.log('');
    rl.close();
    process.exit(0);
  }
  if (input === '/help') { console.log(formatHelp()); return true; }
  if (input === '/clear') { state.history = []; console.log(formatSuccess('History cleared.')); return true; }
  if (input === '/status') {
    console.log('');
    console.log(formatStatus(cfg.model, state.taskCount, state.totalTokens, isSandboxed()));
    console.log(c.dim(`  history: ${state.history.length} messages · session: ${state.session.id}`));
    console.log('');
    return true;
  }
  if (input === '/models') {
    console.log('');
    console.log(`  ${c.bold('Models')}`);
    cfg.models.forEach((m) => {
      const marker = m === cfg.model ? c.green('● ') : c.dim('○ ');
      console.log(`  ${marker}${m === cfg.model ? c.yellow(m) : m}`);
    });
    console.log('');
    return true;
  }
  if (input === '/compact') {
    const before = state.history.length;
    compactConversation(state.history, cfg.contextSize);
    console.log(formatSuccess(`Compacted: ${before} → ${state.history.length} messages`));
    return true;
  }
  if (input.startsWith('/model ')) {
    const newModel = input.slice(7).trim();
    if (cfg.models.includes(newModel)) {
      cfg.model = newModel;
      console.log(formatSuccess(`Switched to model: ${c.yellow(cfg.model)}`));
    } else {
      console.log(formatError(`Model "${newModel}" not found. Available: ${cfg.models.join(', ')}`));
    }
    return true;
  }
  if (input === '/undo') {
    const result = undoLast(cfg.cwd);
    console.log(result.success ? formatSuccess(result.message) : formatError(result.message));
    return true;
  }
  if (input === '/snapshots') {
    const snaps = getSnapshots();
    if (snaps.length === 0) {
      console.log(c.dim('  No snapshots yet. Snapshots are created before each task.'));
    } else {
      console.log('');
      console.log(`  ${c.bold('Snapshots')}`);
      snaps.forEach((s, i) => {
        console.log(`  ${c.dim(String(i + 1) + '.')} ${c.cyan(s.ref.slice(0, 8))} ${c.dim('—')} ${s.description} ${c.dim(s.timestamp)}`);
      });
      console.log('');
    }
    return true;
  }
  if (input === '/sandbox start' || input === '/sandbox') {
    const result = enterSandbox(cfg.cwd);
    console.log(result.success ? formatSuccess(result.message) : formatError(result.message));
    return true;
  }
  if (input === '/sandbox merge') {
    const result = exitSandbox(cfg.cwd, true);
    if (result.diff) console.log(c.dim(result.diff));
    console.log(result.success ? formatSuccess(result.message) : formatError(result.message));
    return true;
  }
  if (input === '/sandbox discard') {
    const result = exitSandbox(cfg.cwd, false);
    if (result.diff) console.log(c.dim(result.diff));
    console.log(result.success ? formatSuccess(result.message) : formatError(result.message));
    return true;
  }
  if (input === '/sessions') {
    const { listSessions } = await import('./session.js');
    const sessions = listSessions();
    if (sessions.length === 0) {
      console.log(c.dim('  No saved sessions.'));
    } else {
      console.log('');
      console.log(`  ${c.bold('Sessions')}`);
      sessions.slice(0, 10).forEach((s) => {
        console.log(`  ${c.cyan(s.id)} ${c.dim('—')} ${s.cwd} ${c.dim(`(${s.taskCount} tasks, ${s.updatedAt})`)}`);
      });
      console.log('');
    }
    return true;
  }
  if (input === '/memory') {
    const entries = memoryList();
    if (entries.length === 0) {
      console.log(c.dim('  No memory entries. The agent can store notes with memory_write.'));
    } else {
      console.log('');
      console.log(`  ${c.bold('Memory')}`);
      entries.forEach((e) => {
        console.log(`  ${c.cyan(e.key)} ${c.dim('—')} ${e.value.slice(0, 80)}${e.value.length > 80 ? '…' : ''}`);
      });
      console.log('');
    }
    return true;
  }
  if (input === '/diff') {
    try {
      const { execFileSync } = await import('node:child_process');
      const diff = execFileSync('git', ['diff'], { cwd: cfg.cwd, encoding: 'utf-8', timeout: 10000 });
      if (diff.trim()) {
        console.log('');
        console.log(`  ${c.bold('Unstaged Changes')}`);
        console.log(c.dim(diff));
      } else {
        const staged = execFileSync('git', ['diff', '--cached'], { cwd: cfg.cwd, encoding: 'utf-8', timeout: 10000 });
        if (staged.trim()) {
          console.log('');
          console.log(`  ${c.bold('Staged Changes')}`);
          console.log(c.dim(staged));
        } else {
          console.log(c.dim('  No changes detected.'));
        }
      }
    } catch (e) {
      debugLog('git diff failed: %s', (e as Error).message);
      console.log(formatError('Not a git repository or git not available.'));
    }
    return true;
  }
  if (input === '/git' || input === 'git') {
    await state.runGitCommitPush();
    return true;
  }
  if (input === '/tokens') {
    console.log('');
    console.log(`  ${c.bold('Token Usage')}`);
    console.log(`  ${c.cyan('Total tokens:')}  ${c.yellow(String(state.totalTokens))}`);
    console.log(`  ${c.cyan('Tasks run:')}     ${c.yellow(String(state.taskCount))}`);
    if (state.taskCount > 0) {
      console.log(`  ${c.cyan('Avg per task:')}  ${c.yellow(String(Math.round(state.totalTokens / state.taskCount)))}`);
    }
    console.log(`  ${c.cyan('Messages:')}      ${c.yellow(String(state.history.length))}`);
    console.log('');
    return true;
  }
  if (input === '/index') {
    console.log('');
    const spinner = new Spinner('Indexing codebase...');
    spinner.start();
    buildIndex(cfg.cwd, true);
    spinner.stop();
    const stats = getIndexStats(cfg.cwd);
    if (stats) {
      console.log(formatSuccess(`Indexed ${stats.files} files → ${stats.chunks} chunks`));
    } else {
      console.log(formatError('Failed to build index.'));
    }
    console.log('');
    return true;
  }
  if (input === '/init') {
    const deyadMd = path.join(cfg.cwd, 'DEYAD.md');
    if (fs.existsSync(deyadMd)) {
      console.log(c.dim('  DEYAD.md already exists.'));
    } else {
      const template = `# Project Instructions for Deyad

<!-- Deyad reads this file before every task. Add project-specific instructions here. -->

## Project Overview
<!-- Describe what this project does -->

## Tech Stack
<!-- e.g., TypeScript, React, Node.js, Python, Rust -->

## Conventions
<!-- Coding conventions, naming patterns, file structure rules -->

## Build & Test
<!-- How to build, test, and run this project -->
\`\`\`bash
# npm run build
# npm test
\`\`\`

## Important Notes
<!-- Anything the agent should know: gotchas, restrictions, preferences -->
`;
      fs.writeFileSync(deyadMd, template, 'utf-8');
      console.log(formatSuccess('Created DEYAD.md — edit it to give the agent project-specific instructions.'));
    }
    return true;
  }

  // Not a slash command
  return false;
}
