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
| --- | --- | --- |
| `OLLAMA_HOST` | Ollama API endpoint | `http://127.0.0.1:11434` |
| `DEYAD_MODEL` | Default model name | (prompted on first run) |
| `DEYAD_DEBUG` | Enable verbose debug logging | unset |
| `DEYAD_NUM_CTX` | Context window size | model default |

## Performance Tuning (GPU / Fast Startup)

If you have a dedicated GPU, you can eliminate cold-start delays and maximize inference speed. These steps configure Ollama to keep the model permanently loaded in VRAM and auto-warm it on boot.

### 1. Configure Ollama Service

Edit the Ollama systemd service to enable flash attention, single-request mode (avoids VRAM fragmentation), and permanent model caching:

```bash
sudo systemctl edit ollama.service
```

Add under `[Service]`:

```ini
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_KEEP_ALIVE=-1"
```

Then reload and restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

| Variable | Effect |
| --- | --- |
| `OLLAMA_FLASH_ATTENTION=1` | Enables FlashAttention for faster inference and lower VRAM usage |
| `OLLAMA_NUM_PARALLEL=1` | Dedicates all VRAM to a single request (no splitting) |
| `OLLAMA_KEEP_ALIVE=-1` | Model stays loaded in RAM/VRAM forever (no idle unload) |

### 2. Auto-Warm Model on Boot (Optional)

Create a systemd service that pre-loads your model into VRAM whenever Ollama starts:

```bash
sudo tee /etc/systemd/system/ollama-warmup.service << 'EOF'
[Unit]
Description=Pre-warm Ollama model into RAM/VRAM
After=ollama.service
Requires=ollama.service

[Service]
Type=oneshot
ExecStartPre=/bin/bash -c 'for i in $(seq 1 30); do curl -sf http://127.0.0.1:11434/api/tags > /dev/null && exit 0; sleep 1; done; exit 1'
ExecStart=/usr/bin/curl -sf -X POST http://127.0.0.1:11434/api/generate -H "Content-Type: application/json" -d '{"model":"YOUR_MODEL_NAME","keep_alive":-1}'
TimeoutStartSec=600
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now ollama-warmup.service
```

Replace `YOUR_MODEL_NAME` with your model (e.g. `qwen3.5:27b`, `llama3.2`).

### 3. Verify

```bash
# Check model is loaded in VRAM
curl -s http://127.0.0.1:11434/api/ps | python3 -c "
import sys, json
models = json.load(sys.stdin).get('models', [])
for m in models:
    vram = m.get('size_vram', 0) // 1024 // 1024
    print(f\"{m['name']} — {vram}MB VRAM\")
if not models:
    print('No models loaded')
"

# Benchmark (should be <2s with warm model)
time deyad --print "hello"
```

### Hardware-Aware Defaults

The CLI automatically detects and uses all available CPU cores for inference threads. GPU layer count is left for Ollama to auto-decide (optimal split between VRAM and system RAM). Both can be overridden in `~/.deyad/config.json`:

```json
{
  "numThread": 12,
  "numGpu": 50
}
```

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
