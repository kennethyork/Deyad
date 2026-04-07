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
