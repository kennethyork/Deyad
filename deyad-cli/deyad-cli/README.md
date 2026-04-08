# deyad-cli

Local AI coding agent for the terminal — powered by Ollama. No cloud APIs, no telemetry, runs entirely on your machine.

## Features

- **20 built-in tools** — file I/O, shell execution, git, search, web fetch, memory
- **RAG-powered context** — BM25 codebase indexing for relevant code retrieval
- **Auto-lint feedback** — lints changed files, feeds errors back for self-correction
- **Sandbox mode** — temporary git branch isolation for safe experimentation
- **Undo/rollback** — git-based snapshots to revert agent changes
- **Session persistence** — encrypted conversation history across restarts
- **Persistent memory** — key-value store with AES-256-CBC encryption
- **Multiple modes** — interactive REPL, one-shot (`--print`), full-auto (`--auto`)
- **Native tool calling** — supports models with function-calling (Qwen 3.5+)
- **Thinking tokens** — displays model reasoning when supported

## Prerequisites

- [Node.js](https://nodejs.org/) ≥ 22
- [Ollama](https://ollama.com/) running locally with at least one model pulled
- Git (for undo/rollback/sandbox features)

## Install

```bash
npm install -g deyad-cli
```

## Quick Start

```bash
# Interactive mode — multi-turn conversation
deyad

# One-shot — answer a question and exit
deyad "explain the auth flow in this project" --print

# Full-auto — agent acts without confirmation prompts
deyad "add login page with JWT auth" --auto

# Resume last session
deyad --resume

# Sandbox mode — isolated git branch
deyad --sandbox
```

## Configuration

| Environment Variable | Description | Default |
|---|---|---|
| `OLLAMA_HOST` | Ollama API endpoint | `http://127.0.0.1:11434` |
| `DEYAD_MODEL` | Default model name | (prompted on first run) |
| `DEYAD_DEBUG` | Enable verbose debug logging | unset |
| `DEYAD_NUM_CTX` | Context window size | model default |

## Security

- **Path traversal guards** — all file operations validate resolved paths stay within project root
- **Shell injection prevention** — commands parsed via `shell-quote`; simple forms use `execFileSync` (no shell)
- **SSRF protection** — blocks `localhost`, private IPs (`10.x`, `192.168.x`, `169.254.x`), `.local` domains
- **Atomic file writes** — writes to temp file then renames to prevent corruption
- **Audit logging** — all tool calls logged to `~/.deyad/audit.log`

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for module overview and data flow.

## Dependencies

Only **2 production dependencies**: `minimatch` (glob matching) and `shell-quote` (command parsing). Everything else uses Node.js built-in APIs.

## Development

```bash
npm install
npm run typecheck   # type-check
npm run lint        # ESLint
npm test            # run tests (Vitest)
npm run build       # bundle with esbuild
```

## License

Apache-2.0
