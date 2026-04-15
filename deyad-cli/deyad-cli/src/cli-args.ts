/**
 * CLI argument parsing, usage, and shell completions.
 *
 * Extracted from cli.ts for modularity.
 */

import { c } from './tui.js';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };
export const VERSION = pkg.version;

export function printUsage(): void {
  console.log(`
  ${c.brandBold('Deyad CLI')} ${c.dim('v' + VERSION)} — local AI coding agent powered by Ollama

  ${c.bold('Usage')}
    ${c.cyan('$ deyad')}                          Interactive chat mode
    ${c.cyan('$ deyad "add a login page"')}       One-shot task mode
    ${c.cyan('$ deyad --model codestral')}        Specify model
    ${c.cyan('$ deyad --print "explain this"')}   Print response and exit
    ${c.cyan('$ deyad --auto "refactor utils"')}  Full-auto sandbox mode
    ${c.cyan('$ deyad --auto-approve "fix bug"')} Auto-approve changes (no confirmations)
    ${c.cyan('$ deyad --no-resume')}              Start a fresh session

  ${c.bold('Options')}
    ${c.yellow('-h, --help')}             Show this help
    ${c.yellow('-m, --model <model>')}    Ollama model (default: DEYAD_MODEL env or first available)
    ${c.yellow('-p, --print <prompt>')}   Run prompt non-interactively and print result
    ${c.yellow('-a, --auto')}             Full-auto mode (sandbox + no confirmations)
    ${c.yellow('--auto-approve')}         Auto-approve all changes (no confirmations)
    ${c.yellow('--no-think')}             Disable reasoning (faster but less accurate)
    ${c.yellow('--no-resume')}            Start a fresh session (default: resumes last session)
    ${c.yellow('--completions <shell>')}  Output shell completion script (bash, zsh, fish)
    ${c.yellow('-v, --version')}          Show version
    ${c.yellow('--config')}               Show config path (~/.deyad/config.json)
`);
}

export function generateCompletions(shell: string): string {
  switch (shell) {
    case 'bash':
      return `# deyad bash completions — add to ~/.bashrc
_deyad_completions() {
  local cur opts
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  opts="-h --help -v --version -m --model -p --print -a --auto --auto-approve --no-think --resume --no-resume --completions"
  COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") )
}
complete -F _deyad_completions deyad`;
    case 'zsh':
      return `# deyad zsh completions — add to ~/.zshrc
_deyad() {
  _arguments \\
    '-h[Show help]' '--help[Show help]' \\
    '-v[Show version]' '--version[Show version]' \\
    '-m[Specify model]:model:' '--model[Specify model]:model:' \\
    '-p[Print mode]:prompt:' '--print[Print mode]:prompt:' \\
    '-a[Full-auto mode]' '--auto[Full-auto mode]' \\
    '--auto-approve[Auto-approve all changes]' \\
    '--resume[Resume last session]' \\
    '--no-resume[Start fresh session]' \\
    '--completions[Output completions]:shell:(bash zsh fish)' \\
    '*:prompt:'
}
compdef _deyad deyad`;
    case 'fish':
      return `# deyad fish completions — save to ~/.config/fish/completions/deyad.fish
complete -c deyad -s h -l help -d 'Show help'
complete -c deyad -s v -l version -d 'Show version'
complete -c deyad -s m -l model -r -d 'Specify model'
complete -c deyad -s p -l print -r -d 'Print mode'
complete -c deyad -s a -l auto -d 'Full-auto mode'
complete -c deyad -l auto-approve -d 'Auto-approve all changes'
complete -c deyad -l resume -d 'Resume last session'
complete -c deyad -l no-resume -d 'Start fresh session'
complete -c deyad -l completions -r -a 'bash zsh fish' -d 'Output completions'`;
    default:
      return `Unknown shell: ${shell}. Supported: bash, zsh, fish`;
  }
}

export interface ParsedArgs {
  help: boolean;
  version: boolean;
  completions: string | undefined;
  model: string | undefined;
  print: string | undefined;
  prompt: string | undefined;
  auto: boolean;
  autoApprove: boolean | undefined;
  resume: boolean;
  noThink: boolean;
  showConfig: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    help: false,
    version: false,
    completions: undefined,
    model: undefined,
    print: undefined,
    prompt: undefined,
    auto: false,
    autoApprove: undefined,
    resume: true,
    noThink: false,
    showConfig: false,
  };
  const positional: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === '-h' || arg === '--help') {
      args.help = true;
    } else if (arg === '-v' || arg === '--version') {
      args.version = true;
    } else if (arg === '--completions') {
      i++;
      if (i >= argv.length) { process.stderr.write('Error: --completions requires a value (bash|zsh|fish)\n'); process.exit(1); }
      args.completions = argv[i];
    } else if (arg === '-m' || arg === '--model') {
      i++;
      if (i >= argv.length) { process.stderr.write('Error: --model requires a value\n'); process.exit(1); }
      args.model = argv[i];
    } else if (arg === '-p' || arg === '--print') {
      i++;
      if (i >= argv.length) { process.stderr.write('Error: --print requires a value\n'); process.exit(1); }
      args.print = argv[i];
    } else if (arg === '-a' || arg === '--auto') {
      args.auto = true;
    } else if (arg === '--auto-approve') {
      args.autoApprove = true;
    } else if (arg === '--config') {
      args.showConfig = true;
    } else if (arg === '--resume') {
      args.resume = true;
    } else if (arg === '--no-resume') {
      args.resume = false;
    } else if (arg === '--no-think') {
      args.noThink = true;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
    i++;
  }
  if (positional.length > 0) {
    args.prompt = positional.join(' ');
  }
  return args;
}
