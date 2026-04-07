# Deyad CLI

A terminal-based AI coding agent — like Claude Code, but 100% local via Ollama. No API keys, no cloud, no cost.

## Install

```bash
npm install -g deyad-cli
```

**Requirements:** Node.js >= 18, [Ollama](https://ollama.ai) running with at least one model pulled.

## Usage

```bash
deyad                              # Interactive REPL
deyad "add a login page"           # One-shot mode
deyad -m codestral "fix bugs"      # Specify model
deyad --print "explain this repo"  # Headless/CI mode
deyad --resume                     # Resume last conversation
```

## CLI Reference

```text
Deyad CLI — Local AI coding agent powered by Ollama

Usage:
  deyad                              Interactive mode
  deyad "add a login page"           One-shot mode
  deyad -m codestral "fix bugs"      Specify model
  deyad --print "fix the bug"        Headless/CI mode (no REPL, exits after)
  deyad --resume                     Resume last saved conversation
  deyad init                         Create DEYAD.md memory file

Options:
  -m, --model <name>    Ollama model to use
  -d, --dir <path>      Project directory (default: cwd)
  -y, --yes             Auto-confirm all tool actions
  -p, --print <prompt>  Headless mode: execute prompt and exit
  --resume              Resume last saved conversation
  -h, --help            Show this help

Environment:
  OLLAMA_HOST           Ollama API URL (default: http://127.0.0.1:11434)
  DEYAD_MODEL           Default model name
```

## Features

- **26 built-in tools** — file I/O, shell, search, git, web search, image analysis
- **12-language auto-lint** — TypeScript, Python, Rust, Go, Java, C/C++, Ruby, PHP, and more
- **Auto-review** — detects off-by-one errors, mutable defaults, bare except, .unwrap()
- **MCP servers** — extend with external tools via `.deyad.json`
- **Parallel tool execution** — read-only tools run concurrently
- **Session persistence** — save and resume conversations
- **SSRF/command blocking** — security hardened for safe local operation
- **100% offline** — works without internet once models are downloaded

## Links

- [Full documentation](https://github.com/kennethyork/Deyad#deyad-cli)
- [Desktop app](https://github.com/kennethyork/Deyad/releases/latest)
- [Changelog](https://github.com/kennethyork/Deyad/blob/main/CHANGELOG.md)

## License

MIT
