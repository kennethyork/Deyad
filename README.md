# Deyad

<div align="center">

## The open-source, local-first AI app builder

Describe what you want. Get a working app. No cloud. No API keys. No subscriptions.

![Electron](https://img.shields.io/badge/Electron-40-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama-Local%20AI-000000)
![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

[Download](https://github.com/kennethyork/Deyad/releases/latest) · [CLI](#deyad-cli) · [Comparison](COMPARISON.md) · [Architecture](ARCHITECTURE.md)

</div>

---

Deyad is a desktop app that turns natural language into working software. It runs [Ollama](https://ollama.ai) on your machine for AI, scaffolds production stacks (React + Express + SQLite + Prisma), and gives you a full IDE — editor, terminal, live preview, database admin, version control, and deployment — all in one window.

Your code never leaves your machine. There are no tokens to buy, no accounts to create, and no internet required.

---

## Quick Start

### Download a binary

Grab the latest release for your platform from [GitHub Releases](https://github.com/kennethyork/Deyad/releases/latest):

| Platform | File |
| --- | --- |
| Ubuntu / Debian | `Deyad-amd64.deb` |
| Fedora / RHEL | `Deyad-x86_64.rpm` |
| Any Linux | `Deyad-x86_64.AppImage` |
| Windows | `Deyad-x64.exe` |

### Or run from source

```bash
git clone https://github.com/kennethyork/Deyad.git
cd Deyad && npm install && npm start
```

### Prerequisites

| Dependency | Install |
| --- | --- |
| **Node.js >= 18** | [nodejs.org](https://nodejs.org) |
| **Ollama** | [ollama.ai](https://ollama.ai) |
| **Git** | [git-scm.com](https://git-scm.com) |

Pull a model and start building:

```bash
ollama pull llama3.2
```

On first launch the Welcome Wizard connects to Ollama and lets you pick a model.

---

## What It Does

```text
You describe your app in chat
  → Agent reads your codebase
  → Plans the approach
  → Writes and edits files
  → Runs commands to verify
  → Auto-fixes errors from dev server logs
  → Auto-commits every change to Git
  → Repeats until done (no iteration cap — Ollama is local)
```

---

## Features

### AI Agent — 21 Tools

The autonomous agent reads code, writes files, runs commands, detects errors, and self-corrects in a loop.

| Tool | Purpose |
| --- | --- |
| `list_files` | List directory contents |
| `read_file` | Read file content |
| `write_files` | Create or overwrite files |
| `edit_file` | Surgical find-and-replace edits |
| `multi_edit` | Batch edits across multiple files |
| `delete_file` | Remove files |
| `run_command` | Execute shell commands |
| `search_files` | Regex search across the project |
| `fetch_url` | Download content from a URL |
| `install_package` | Install npm packages |
| `db_schema` | Read live database schema |
| `git_status` | Check working tree status |
| `git_commit` | Commit staged changes |
| `git_push` | Push to remote |
| `git_pull` | Pull from remote |
| `git_remote_get` | Get remote URL |
| `git_remote_set` | Set remote URL |
| `git_branch` | List branches |
| `git_branch_create` | Create a branch |
| `git_branch_switch` | Switch branches |
| `git_log` | View commit history |

Additional AI capabilities:

- **Planning mode** — generates a plan for your approval before executing
- **Error auto-detection** — watches Vite dev server logs, sends up to 3 auto-fix attempts
- **RAG retrieval** — semantic search with local Ollama embeddings + TF-IDF fallback
- **Code completion** — fill-in-the-middle completions with any FIM-capable model
- **Vision** — paste a screenshot or mockup, get working UI code
- **Context compaction** — auto-summarizes older turns to stay within token limits

### Editor & IDE

- **Monaco editor** — VS Code engine, syntax highlighting for 15+ languages
- **File tree** with search (Ctrl/Cmd+P)
- **Live preview** — embedded Vite dev server with run/stop/refresh
- **Integrated terminal** — xterm.js PTY with copy/paste
- **Package manager** — install/uninstall npm packages from the UI
- **Environment variables** — `.env` file editor
- **Diff preview** — review AI changes before accepting, snapshot-based undo
- **Dark / Light theme**

### Database

- **SQLite** — file-based, zero-config, no Docker required
- **Prisma ORM** — type-safe schema and migrations
- **Prisma Studio** — visual database admin embedded in the app
- **Schema introspection** — the AI agent queries live table structure while coding

### Version Control

- **Auto-commit** — every AI generation is committed automatically
- **GitHub integration** — push, pull, branches, connect to any remote
- **AI git commands** — say "push to github" or "create a feature branch" in chat
- **Version history** — timeline of all commits with one-click restore
- **File diff** — view per-file changes at any commit
- **Snapshot undo** — revert to the state before the last AI generation

### Deployment — 7 Targets

| Target | Type |
| --- | --- |
| **Vercel** | Frontend & full-stack |
| **Netlify** | Frontend & full-stack |
| **Surge** | Static sites |
| **Railway** | Full-stack with database |
| **Fly.io** | Container-based |
| **VPS (SSH + rsync)** | Any Linux server |
| **Electron Desktop** | Standalone app (Linux/Win/Mac) |

VPS deploys include optional custom domain with auto-generated nginx config and free SSL via Let's Encrypt.

Desktop packaging ships a standalone Electron app with a built-in `window.ollama` AI bridge.

Also: **ZIP export**, **PWA export**, and **Capacitor mobile preview** (Android/iOS).

### Templates

Todo App · Dashboard · Landing Page · Chat UI · Blog · E-commerce — or start blank.

### Plugins

Drop custom templates into `plugins/` with a `plugin.json` manifest. Auto-discovered on startup.

---

## How It Compares

| | **Deyad** | Dyad | Bolt.new | Lovable | Cursor | Windsurf | Replit | v0 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Price** | Free forever | $20–79/mo | $20+/mo | $20+/mo | $20/mo | $15/mo | $25+/mo | $20+/mo |
| **100% local** | ✅ | Partial (cloud API) | ❌ | ❌ | Partial | Partial | ❌ | ❌ |
| **Offline** | ✅ | ❌ | ❌ | ❌ | Partial | Partial | ❌ | ❌ |
| **Full-stack scaffold** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| **Database GUI** | ✅ Prisma Studio | Supabase | ❌ | Supabase | ❌ | ❌ | ✅ | ❌ |
| **Agent loop** | ✅ unlimited | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **CLI agent** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Editor** | ✅ Monaco | ✅ visual | Basic | Basic | ✅ VS Code | ✅ VS Code | ✅ | ❌ |
| **Terminal** | ✅ PTY | ❌ | ✅ WebContainer | ❌ | ✅ | ✅ | ✅ | ❌ |
| **Deploy targets** | 7 | 2 | 2 | 2 | ❌ | ❌ | 1 | 1 |
| **Desktop export** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Mobile export** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Open source** | ✅ MIT | Source-available | ❌ | ❌ | ❌ | ❌ | Partial | ❌ |

> Deyad is the only tool that is free, fully local, fully offline, open source MIT, has a CLI agent, exports to desktop/mobile, and deploys to 7 targets. No competitor checks all those boxes.

[Full comparison →](COMPARISON.md)

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop | Electron 40 + Vite |
| UI | React 18 + TypeScript 6 |
| Editor | Monaco |
| Terminal | xterm.js + node-pty |
| AI | Ollama (any local model) |
| CLI | Node.js + TypeScript (no Electron) |
| Frontend scaffold | React + Vite + TypeScript |
| Backend scaffold | Express + TypeScript |
| Database | SQLite + Prisma |
| DB Admin | Prisma Studio |
| Version control | Git |
| Packaging | Electron Builder |
| Tests | Vitest (427 passing) |

---

## Deyad CLI

A terminal-based AI coding agent — like Claude Code, but 100% local via Ollama. No API keys, no cloud, no cost.

### Install

```bash
git clone https://github.com/kennethyork/Deyad.git
cd Deyad/cli
npm install && npm run build
npm link   # makes 'deyad' available globally
```

**Requirements:** Node.js >= 18, Ollama running with at least one model pulled.

### Usage

```bash
deyad                              # Interactive REPL
deyad "add a login page"           # One-shot mode
deyad -m codestral "fix bugs"      # Specify model
deyad --print "explain this repo"  # Headless/CI mode (no REPL, exits after)
deyad --resume                     # Resume last saved conversation
deyad init                         # Create DEYAD.md memory file
```

### Options

| Flag | Description |
| --- | --- |
| `-m, --model <name>` | Ollama model to use |
| `-d, --dir <path>` | Project directory (default: cwd) |
| `-y, --yes` | Auto-confirm all tool actions |
| `-p, --print <prompt>` | Headless mode — run prompt, print result, exit |
| `--resume` | Resume last saved conversation |
| `-h, --help` | Show help |

### Slash Commands

| Command | Description |
| --- | --- |
| `/help` | Show help |
| `/model` | Switch Ollama model |
| `/clear` | Clear conversation history |
| `/compact` | Show token/message stats |
| `/diff` | Show git diff of all changes |
| `/undo` | Revert last agent changes (git checkout) |
| `/add <file>` | Add a file to conversation context |
| `/drop <file>` | Remove a file from context |
| `/run <cmd>` | Run a shell command directly |
| `/init` | Create a DEYAD.md memory file |
| `/save` | Save conversation to disk |
| `/resume` | Resume last saved conversation |
| `/image <path>` | Attach an image for multimodal models |
| `/mcp` | Show connected MCP servers and tools |
| `/quit` | Exit |

### CLI Tools (15 built-in + MCP)

The agent has autonomous access to:

| Tool | Purpose |
| --- | --- |
| `list_files` | List project files (respects .gitignore) |
| `read_file` | Read file contents |
| `write_files` | Create or overwrite files |
| `edit_file` | Surgical find-and-replace |
| `delete_file` | Remove a file |
| `run_command` | Execute shell commands |
| `search_files` | Regex search across files with glob filtering |
| `glob_files` | Find files by glob pattern |
| `fetch_url` | Fetch content from a URL |
| `memory_read` | Read project DEYAD.md memory |
| `memory_write` | Update project DEYAD.md memory |
| `git_status` | Check working tree status |
| `git_commit` | Stage all and commit |
| `git_log` | View recent commits |
| `git_diff` | Show uncommitted changes |
| `mcp_*` | Any tool from connected MCP servers (auto-discovered) |

### Highlights

- **Parallel tool execution** — read-only tools run concurrently via Promise.all
- **Markdown rendering** — agent responses rendered with ANSI (headers, bold, code blocks, lists)
- **Token tracking** — real Ollama eval counts with chars/3.5 fallback (matches desktop app)
- **Session persistence** — auto-saves to `.deyad-session.json`, resume anytime
- **DEYAD.md memory** — persistent project context file (like CLAUDE.md)
- **.gitignore-aware** — file listing respects .gitignore via minimatch
- **Image/multimodal** — attach images for vision-capable models
- **Headless/CI mode** — `--print` flag for non-interactive pipelines
- **Streaming + thinking** — live token streaming with dimmed `<think>` blocks
- **MCP servers** — connect external tools via `.deyad.json` (GitHub, Slack, databases, etc.)
- **Double Ctrl+C** — first cancels current operation, second exits
- **Diff display** — colored unified diffs for every file change
- **Auto-confirm** — `-y` flag skips all confirmation prompts

### CLI vs Other AI Coding CLIs

| Feature | **Deyad CLI** | **Claude Code** | **Aider** | **Copilot CLI** | **Cline** | **OpenHands** |
| --- | --- | --- | --- | --- | --- | --- |
| **Price** | Free forever | $20/mo (Pro) | Free (BYO key) | $10–19/mo | Free (BYO key) | Free (BYO key) |
| **100% local** | ✅ Ollama | ❌ Anthropic API | ❌ needs API key | ❌ GitHub API | ❌ needs API key | ❌ needs API key |
| **Offline** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Interactive REPL** | ✅ | ✅ | ✅ | ❌ | ✅ (VS Code) | ✅ (web UI) |
| **One-shot mode** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Headless/CI mode** | ✅ `--print` | ✅ `--print` | ❌ | ✅ | ❌ | ❌ |
| **File read/write/edit** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| **Shell commands** | ✅ | ✅ | ✅ (limited) | ✅ | ✅ | ✅ |
| **Regex/glob search** | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| **Web fetch** | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| **Image/multimodal** | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| **Memory file** | ✅ DEYAD.md | ✅ CLAUDE.md | ✅ .aider.conf | ❌ | ❌ | ❌ |
| **Markdown rendering** | ✅ | ✅ | ✅ | ✅ | N/A (GUI) | N/A (GUI) |
| **Session resume** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| **Parallel tools** | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| **.gitignore aware** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| **Token tracking** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| **Diff display + undo** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| **Git integration** | ✅ | ✅ | ✅ (auto-commit) | ❌ | ✅ | ✅ |
| **MCP servers** | ✅ `.deyad.json` | ✅ | ❌ | ❌ | ✅ | ❌ |
| **Model choice** | Any Ollama model | Claude only | Any (BYO key) | GPT-4/Copilot | Any (BYO key) | Any (BYO key) |
| **Open source** | ✅ MIT | ❌ | ✅ Apache 2.0 | ❌ | ✅ Apache 2.0 | ✅ MIT |

### MCP Server Configuration

Add external tools by creating `.deyad.json` in your project (or `~/.config/deyad/mcp.json` globally):

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_..." }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    }
  }
}
```

Servers are auto-connected on startup. Tools are namespaced as `mcp_<server>_<tool>` and injected into the agent's system prompt.

### Environment Variables

| Variable | Description |
| --- | --- |
| `OLLAMA_HOST` | Ollama API URL (default: `http://127.0.0.1:11434`) |
| `DEYAD_MODEL` | Default model name |

---

## Platform Install Guides

<details>
<summary><b>Ubuntu / Debian</b></summary>

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Git
sudo apt install -y git

# Ollama
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2

# Deyad — install the .deb
sudo dpkg -i Deyad-amd64.deb
```

</details>

<details>
<summary><b>Fedora / RHEL</b></summary>

```bash
# Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs

# Git
sudo dnf install -y git

# Ollama
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2

# Deyad — install the .rpm
sudo rpm -i Deyad-x86_64.rpm
```

</details>

<details>
<summary><b>Arch Linux / Manjaro</b></summary>

```bash
# Node.js + Git
sudo pacman -S nodejs npm git

# Ollama
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2

# Deyad — run the AppImage
chmod +x Deyad-x86_64.AppImage && ./Deyad-x86_64.AppImage
```

</details>

<details>
<summary><b>Windows 10/11</b></summary>

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install Ollama.Ollama
ollama pull llama3.2

# Download and run Deyad-x64.exe from GitHub Releases
```

</details>

---

## Development

```bash
npm start             # Run in dev mode
npm test              # Run tests (Vitest)
npm run lint          # Lint
npm run dist:linux    # Package for Linux (deb, rpm, AppImage)
npm run dist:win      # Package for Windows (exe)
npm run dist:all      # Package for Linux + Windows
```

---

## Security

Deyad is designed to be safe by default. The agent operates inside project sandboxes with multiple layers of protection:

| Layer | Protection |
| --- | --- |
| **Command blocklist** | `rm -rf /`, `sudo`, `mkfs`, `dd of=/dev/`, `shutdown`, `reboot`, `curl\|bash`, `wget\|bash` are blocked |
| **Package validation** | npm package names are validated against `^[@a-zA-Z0-9._\-/]+$` — no shell injection |
| **SSRF protection** | `fetch_url` blocks private IPs (127.x, 10.x, 192.168.x, 172.16-31.x), localhost, `::1`, cloud metadata endpoints |
| **Path traversal** | `write_files` blocks `..`, leading `/`, and leading `\` — all writes scoped to the project |
| **Git hash validation** | Git tool inputs are validated against `^[a-f0-9]+$` to prevent command injection |
| **Audit trail** | Every tool execution is logged to an in-memory audit ring buffer |

All security checks are covered by automated tests.

---

## License

MIT
