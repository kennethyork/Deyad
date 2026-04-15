/**
 * Interactive REPL loop and slash-command handlers.
 * Extracted from cli.ts to keep the entry point focused on setup and dispatch.
 */
import * as readline from 'node:readline';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { OllamaMessage } from './ollama.js';
import { streamChat, estimateTokens } from './ollama.js';
import { runAgentLoop, compactConversation } from './agent.js';
import { loadOrCreateSession, saveSession, pruneSessions, memoryList } from './session.js';
import { createSnapshot, undoLast, getSnapshots } from './undo.js';
import { enterSandbox, exitSandbox, isSandboxed } from './sandbox.js';
import { buildIndex, getIndexStats } from './rag.js';
import { getConfigPath } from './config.js';
import { VERSION } from './cli-args.js';
import { createCallbacks } from './cli.js';
import {
  c, divider, Spinner,
  printBanner,
  formatConfirm, formatStatus, formatHelp, formatError,
  formatSuccess, formatTokenBadge, getPrompt,
} from './tui.js';

/** Shared REPL configuration passed from main(). */
export interface ReplConfig {
  model: string;
  models: string[];
  cwd: string;
  autoApprove: boolean;
  noThink: boolean;
  temperature: number;
  ollamaHost: string;
  contextSize: number;
  maxIterations: number;
  gitAutoCommit: boolean;
  allowedTools: string[];
  restrictedTools: string[];
  resume: boolean;
}

/** Tab-completion for REPL commands and file paths. */
function buildCompleter(cwd: string): (line: string) => [string[], string] {
  const REPL_COMMANDS = [
    '/help', '/clear', '/status', '/models', '/compact', '/model ',
    '/diff', '/git', '/tokens', '/index', '/init', '/undo',
    '/snapshots', '/sandbox ', '/sessions', '/memory',
    'exit', 'quit', 'git',
  ];
  return (line: string): [string[], string] => {
    if (line.startsWith('/') || line === 'g' || line === 'gi' || line === 'git' || line === 'e' || line === 'ex' || line === 'exi' || line === 'q' || line === 'qu' || line === 'qui') {
      const hits = REPL_COMMANDS.filter(c => c.startsWith(line));
      return [hits.length ? hits : REPL_COMMANDS, line];
    }
    const words = line.split(/\s+/);
    const lastWord = words[words.length - 1] || '';
    if (lastWord.includes('/') || lastWord.includes('.')) {
      try {
        const dir = path.dirname(path.resolve(cwd, lastWord));
        const prefix = path.basename(lastWord);
        const entries = fs.readdirSync(dir).filter(e => e.startsWith(prefix));
        const completions = entries.map(e => {
          const full = path.join(path.dirname(lastWord), e);
          const stat = fs.statSync(path.resolve(cwd, full));
          return stat.isDirectory() ? full + '/' : full;
        });
        return [completions, lastWord];
      } catch { /* ignore */ }
    }
    return [[], line];
  };
}

/** Handle a single slash command. Returns true if handled, false if it's a user prompt. */
async function handleSlashCommand(
  input: string,
  state: ReplState,
): Promise<boolean> {
  const { cfg, rl } = state;

  if (input === 'exit' || input === 'quit') {
    saveReplSession(state);
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
    } catch {
      console.log(formatError('Not a git repository or git not available.'));
    }
    return true;
  }
  if (input === '/git' || input === 'git') {
    await runGitCommitPush(state);
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

/** Run git add + AI-generated commit + push. */
async function runGitCommitPush(state: ReplState): Promise<void> {
  const { cfg } = state;
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['add', '-A'], { cwd: cfg.cwd, timeout: 10000 });
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: cfg.cwd, encoding: 'utf-8', timeout: 10000 }).trim();
    if (!status) {
      console.log(c.dim('  Nothing to commit. Working tree clean.'));
      return;
    }
    const commitMsg = await generateCommitMessage(cfg, cfg.cwd);
    console.log(`  ${c.cyan('commit')} ${commitMsg}`);
    execFileSync('git', ['commit', '-m', commitMsg], { cwd: cfg.cwd, timeout: 10000 });

    const pushSpinner = new Spinner('Pushing...');
    pushSpinner.start();
    try {
      execFileSync('git', ['push'], { cwd: cfg.cwd, timeout: 30000 });
      pushSpinner.stop();
      console.log(formatSuccess('Staged, committed, and pushed.'));
    } catch {
      pushSpinner.stop();
      console.log(formatSuccess('Committed locally.'));
      console.log(c.dim('  Push failed — no remote configured or network error. Run git push manually.'));
    }
  } catch (e) {
    console.log(formatError(`Git error: ${(e as Error).message}`));
  }
}

/** Generate a commit message from the staged diff using the model. */
async function generateCommitMessage(cfg: ReplConfig, cwd: string): Promise<string> {
  const { execFileSync } = await import('node:child_process');
  const diffStat = execFileSync('git', ['diff', '--cached', '--stat'], { cwd, encoding: 'utf-8', timeout: 10000 }).trim();
  const diffContent = execFileSync('git', ['diff', '--cached'], { cwd, encoding: 'utf-8', timeout: 60000 });
  const diffForPrompt = diffContent.length > 4000 ? diffContent.slice(0, 4000) + '\n...(truncated)' : diffContent;

  const commitSpinner = new Spinner('Generating commit message...');
  commitSpinner.start();
  let commitMsg = '';
  try {
    const result = await streamChat(
      cfg.model,
      [
        { role: 'system', content: 'You are a git commit message generator. Output ONLY the commit message — no explanation, no quotes, no markdown. Use conventional commit format (feat:, fix:, chore:, refactor:, docs:, etc). Keep it under 72 chars. If multiple changes, summarize the most important one.' },
        { role: 'user', content: `Generate a commit message for:\n\n${diffStat}\n\n${diffForPrompt}` },
      ],
      (token) => { commitMsg += token; },
      { temperature: 0.1 },
      undefined, undefined, undefined, false, cfg.ollamaHost,
    );
    commitMsg = (commitMsg || result.content).trim().replace(/^["'`]+|["'`]+$/g, '').split('\n')[0]!.trim();
  } catch {
    const lines = diffStat.split('\n');
    commitMsg = `chore: update ${lines.length > 1 ? lines.length - 1 + ' files' : lines[0]?.trim() || 'files'}`;
  }
  commitSpinner.stop();
  return commitMsg || 'chore: update files';
}

/** Persist current REPL state to session storage. */
function saveReplSession(state: ReplState): void {
  state.session.history = state.history;
  state.session.totalTokens = state.totalTokens;
  state.session.taskCount = state.taskCount;
  state.session.model = state.cfg.model;
  saveSession(state.session);
}

/** Auto-commit changed files after a task if gitAutoCommit is enabled. */
async function autoCommitIfNeeded(state: ReplState, changedFiles: string[]): Promise<void> {
  const { cfg } = state;
  if (!cfg.gitAutoCommit || changedFiles.length === 0) return;
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['add', '-A'], { cwd: cfg.cwd, timeout: 10000 });
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: cfg.cwd, encoding: 'utf-8', timeout: 10000 }).trim();
    if (status) {
      const commitMsg = await generateCommitMessage(cfg, cfg.cwd);
      execFileSync('git', ['commit', '-m', commitMsg], { cwd: cfg.cwd, timeout: 10000 });
      console.log(c.dim(`  auto-commit: ${commitMsg}`));
    }
  } catch { /* not a git repo or git error — skip silently */ }
}

/** Mutable REPL state passed between handlers. */
interface ReplState {
  cfg: ReplConfig;
  session: ReturnType<typeof loadOrCreateSession>;
  history: OllamaMessage[];
  totalTokens: number;
  taskCount: number;
  rl: readline.Interface;
}

/** Start the interactive REPL loop. */
export function startRepl(cfg: ReplConfig): void {
  let session = loadOrCreateSession(cfg.cwd, cfg.model);
  if (cfg.resume && session.history.length > 0) {
    const before = session.history.length;
    compactConversation(session.history, cfg.contextSize);
    if (session.history.length < before) {
      console.log(c.dim(`  Resuming session ${session.id} (compacted ${before}→${session.history.length} messages, ${session.taskCount} tasks)`));
    } else {
      console.log(c.dim(`  Resuming session ${session.id} (${session.taskCount} tasks, ${session.history.length} messages)`));
    }
  }
  pruneSessions();

  if (cfg.autoApprove) {
    console.log(c.dim(`  Config: ${getConfigPath()}`));
    console.log(formatSuccess(`  Auto-approve enabled`));
    console.log('');
  }

  printBanner(VERSION, cfg.model, cfg.cwd, isSandboxed());
  console.log(c.dim(`  Context: ${(cfg.contextSize / 1024).toFixed(0)}K tokens${cfg.contextSize ? '' : ' (auto-detected)'}`));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: buildCompleter(cfg.cwd),
    history: [] as string[],
    historySize: 100,
  } as readline.ReadLineOptions);

  const state: ReplState = {
    cfg,
    session,
    history: cfg.resume ? session.history : [],
    totalTokens: cfg.resume ? session.totalTokens : 0,
    taskCount: cfg.resume ? session.taskCount : 0,
    rl,
  };

  rl.on('close', () => {
    saveReplSession(state);
    console.log('');
    console.log(c.dim(`  Session saved: ${state.session.id}`));
    console.log(c.dim('  Goodbye!'));
    console.log('');
    process.exit(0);
  });

  const ask = (): void => {
    rl.question(getPrompt(isSandboxed()), async (line) => {
      const input = line.trim();
      if (!input) { ask(); return; }

      const handled = await handleSlashCommand(input, state);
      if (handled) { ask(); return; }

      // ── User prompt → run agent ──
      createSnapshot(cfg.cwd, `before task: ${input.slice(0, 50)}`);

      const replCallbacks = createCallbacks({
        silent: false,
        showDiffs: true,
        autoApprove: cfg.autoApprove,
        askConfirm: (question) => new Promise((resolve) => {
          rl.question(formatConfirm(question), (answer) => {
            resolve(answer.trim().toLowerCase().startsWith('y'));
          });
        }),
      });

      try {
        const result = await runAgentLoop(cfg.model, input, cfg.cwd, replCallbacks, state.history, undefined, cfg.noThink ? false : undefined, {
          temperature: cfg.temperature, contextSize: cfg.contextSize, ollamaHost: cfg.ollamaHost,
          maxIterations: cfg.maxIterations, allowedTools: cfg.allowedTools, restrictedTools: cfg.restrictedTools,
        });
        state.history = result.history;
        state.totalTokens += result.stats.totalTokens;
        state.taskCount++;

        const historyChars = state.history.reduce((s, m) => s + m.content.length, 0);
        const contextTokens = estimateTokens(historyChars);
        const contextPct = Math.min(100, Math.round((contextTokens / cfg.contextSize) * 100));
        console.log(formatTokenBadge(result.stats.totalTokens, contextPct));

        await autoCommitIfNeeded(state, result.changedFiles);
        saveReplSession(state);
      } catch (err) {
        console.error(formatError(String(err)));
      }
      ask();
    });
  };

  ask();
}
