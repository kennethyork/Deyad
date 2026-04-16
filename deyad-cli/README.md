# Deyad CLI

Local AI coding agent for the terminal — powered by Ollama. No cloud APIs, no telemetry, runs entirely on your machine.

<p align="center"><code>npm i -g deyad-cli</code></p>

---

## Quickstart

```bash
npm install -g deyad-cli
```

Make sure [Ollama](https://ollama.com/) is running with at least one model pulled:

```bash
ollama pull qwen3.5:latest
```

Then run:

```bash
deyad                              # Interactive REPL
deyad "add a login page"           # One-shot mode
deyad --print "explain this repo"  # Print response and exit
deyad --auto "refactor utils"      # Full-auto sandbox mode
```

## Features

- **26 built-in tools** + MCP server support
- **RAG-powered context** — BM25 codebase indexing
- **Auto-lint feedback** — lints changed files, self-corrects
- **Sandbox mode** — temporary git branch isolation
- **Undo/rollback** — git-based snapshots
- **Session persistence** — resume conversations across restarts
- **Native tool calling** — Qwen 3.5+, Llama 3.2+
- **Multiple modes** — REPL, one-shot, `--print`, `--auto`
- **Multimodal** — attach images for vision models
- **MCP servers** — extend with external tools via `.deyad.json`

## Performance Tuning (GPU / Fast Startup)

See the full guide in [deyad-cli/README.md Performance Tuning](deyad-cli/README.md#performance-tuning-gpu--fast-startup).

Quick summary:

1. Set `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_KEEP_ALIVE=-1` in the Ollama systemd service
2. (Optional) Create an `ollama-warmup.service` to auto-load your model on boot
3. (Optional) Set `numThread` / `numGpu` in `~/.deyad/config.json`

Result: `deyad --print "hello"` in **~0.9s** with a warm model.

## Documentation

Full documentation, tool reference, slash commands, and CLI comparison tables are in:

- [deyad-cli/README.md](deyad-cli/README.md) — complete CLI reference
- [deyad-cli/ARCHITECTURE.md](deyad-cli/ARCHITECTURE.md) — module overview and data flow

## Security Model & Permissions

Deyad lets you choose how much autonomy the agent receives via the `--approval-mode` flag:

| Mode                      | Agent may do without asking                     | Still requires approval                                         |
| ------------------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| **Suggest** (default)     | Read any file in the repo                       | **All** file writes/patches, **all** shell commands             |
| **Auto Edit**             | Read **and** write files                        | **All** shell commands                                          |
| **Full Auto**             | Read/write files, execute shell commands         | -                                                               |

In **Full Auto** every command is run **network-disabled** and confined to the current working directory for defense-in-depth. Deyad will warn if you start in auto-edit or full-auto while the directory is not tracked by Git.

## Development

```bash
cd deyad-cli
npm install
npm run build
npm test
npm link    # makes 'deyad' available globally
```

### Running tests

```bash
npm test                # full suite
npm run test:watch      # watch mode
npm run typecheck       # type-check without emitting
npm run lint:fix        # auto-fix lint + prettier
```

## Contributing

We welcome contributions. Create a topic branch from `main`, keep changes focused, and run the full test/type/lint suite before pushing:

```bash
npm test && npm run lint && npm run typecheck
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) for full guidelines.

## License

[Apache-2.0](LICENSE)
