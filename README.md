<div align="center">

# Deyad

**The open-source, local-first AI app builder.**

Describe what you want. Get a working app. No cloud. No API keys. No limits.

![Electron](https://img.shields.io/badge/Electron-40-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama-Local%20AI-000000)
![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)
![Version](https://img.shields.io/badge/Version-1.4.35-blue)

[Download](https://github.com/theKennethy/Deyad/releases/latest) · [Report Bug](https://github.com/theKennethy/Deyad/issues) · [Request Feature](https://github.com/theKennethy/Deyad/issues)

</div>

---

Deyad is a desktop application that turns natural language into working software. It runs [Ollama](https://ollama.ai) locally for AI inference, scaffolds five production stacks, and gives you a full IDE — editor, terminal, live preview, database browser, version history, deploy, and a plugin marketplace — in a single window.

Your code never leaves your machine. There are no API keys, no subscriptions, and no token limits.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Features](#features)
- [Comparison](#comparison)
- [Stacks & Templates](#stacks--templates)
- [Tech Stack](#tech-stack)
- [Requirements](#requirements)
- [Installation](#installation)
- [Getting Started](#getting-started)
- [Usage](#usage)
- [Development](#development)
- [License](#license)

---

## How It Works

```
You describe your app in chat
  → The agent reads your codebase
  → Plans the approach
  → Writes and edits files
  → Runs shell commands to verify
  → Auto-fixes errors from dev server logs
  → Auto-commits every change to Git
  → Repeats until done (up to 30 iterations)
```

---

## Features

### AI Agent

Deyad's autonomous agent reads your codebase, writes files, runs commands, detects errors, and self-corrects — up to 30 iterations per request.

| Capability | Details |
| --- | --- |
| **18 tools** | `list_files` `read_file` `write_files` `edit_file` `multi_edit` `run_command` `search_files` `db_schema` `git_status` `git_commit` `git_push` `git_pull` `git_remote_get` `git_remote_set` `git_branch` `git_branch_create` `git_branch_switch` `git_log` |
| **Error recovery** | Watches dev server logs, auto-sends up to 3 fix attempts |
| **Planning mode** | Agent generates a plan for your approval before executing |
| **Context budget** | ~32k tokens with automatic compaction of older turns |
| **RAG retrieval** | Semantic search via Ollama embeddings + TF-IDF fallback |
| **Code completion** | Fill-in-the-middle autocomplete with any FIM-capable model |
| **Vision** | Paste a screenshot or mockup, get working UI code |
| **Task queue** | Queue multiple prompts for background batch processing |

### IDE

| Panel | What it does |
| --- | --- |
| **Editor** | Monaco (VS Code engine), syntax highlighting for 15+ languages |
| **File tree** | Nested directory view with quick-open search (Ctrl+P) |
| **Live preview** | Embedded Vite dev server with run / stop / refresh |
| **Terminal** | Full xterm.js PTY with copy/paste |
| **Package manager** | Install and uninstall npm packages from the UI |
| **Environment variables** | Multi-file `.env` editor |
| **Search** | Full-text search across all project files (Ctrl+Shift+F) |
| **Command palette** | Quick access to every action (Ctrl+K) |

### Database

- **SQLite** — zero-config, file-based, no Docker required
- **Prisma ORM** — type-safe schema management for JS/TS stacks
- **Built-in table browser** — browse tables, view rows, inspect schema
- **Schema introspection** — agent queries live structure while coding

### Version Control

- **Auto-commit** — every AI generation is committed automatically
- **GitHub / GitLab** — push, pull, and manage remotes
- **Branching** — create, switch, and list branches from UI or chat
- **Version history** — browse all commits in a timeline with one-click restore
- **Diff preview** — review changes before accepting, with snapshot-based undo
- **Natural language git** — say "push to github" or "create a feature branch" in chat

### Deploy

Ship to 7 targets from one modal:

| Provider | Auth | Notes |
| --- | --- | --- |
| **Vercel** | OAuth token or CLI | One-click deploy, free tier |
| **Netlify** | OAuth token or CLI | One-click deploy, free tier |
| **Surge** | CLI | Static sites, free |
| **Railway** | CLI | Full-stack with database |
| **Fly.io** | CLI | Container-based, free tier |
| **VPS** | SSH + rsync | Any Linux server; optional nginx + Let's Encrypt SSL |
| **Electron** | — | Package as desktop app (AppImage / exe / DMG) |

Also: **Mobile preview** via Capacitor (Android & iOS), **ZIP export**, and **PWA export**.

### Plugin Marketplace

Browse, install, and uninstall community plugins directly from the app. Plugins can provide:

- **Custom tools** — new agent tools the AI can call
- **Custom agents** — specialized personas with their own system prompts
- **Custom themes** — CSS themes loaded on startup

Plugins are auto-discovered from `{userData}/plugins/` and the online registry.

### Settings

- **Theme** — dark or light, persisted across sessions
- **Ollama host** — configurable endpoint (default `http://localhost:11434`)
- **Model selection** — choose from any installed Ollama model
- **Code completion model** — separate model for FIM autocomplete
- **Embedding model** — for RAG (or TF-IDF-only mode)
- **Temperature / Top P / Repeat Penalty** — fine-tune generation behavior

---

## Comparison

| Feature | **Deyad** | Bolt.new | Lovable | Cursor | Base44 | v0 |
| --- | --- | --- | --- | --- | --- | --- |
| 100% local AI (Ollama) | **Yes** | No | No | No | No | No |
| Free forever, no token limits | **Yes** | No | No | No | No | No |
| Data stays on your machine | **Yes** | No | No | No | No | No |
| No API key / account needed | **Yes** | No | No | No | No | No |
| Open source | **Yes** | No | No | No | No | No |
| 5 production stacks | **Yes** | No | No | No | No | No |
| Full-stack with real database | **Yes** | No | Partial | No | Partial | No |
| Autonomous agent (30 iterations) | **Yes** | Partial | Partial | Yes | Partial | No |
| Error auto-detect & self-fix | **Yes** | No | No | No | No | No |
| Built-in database browser | **Yes** | No | No | No | No | No |
| Git auto-commit | **Yes** | No | No | No | No | No |
| GitHub push/pull/branches | **Yes** | No | No | Yes | No | No |
| AI code completion (FIM) | **Yes** | No | No | Yes | No | No |
| RAG with local embeddings | **Yes** | No | No | Yes | No | No |
| Image to Code | **Yes** | Yes | Yes | Yes | No | Yes |
| Live preview | **Yes** | Yes | Yes | No | Yes | Yes |
| Integrated terminal | **Yes** | Partial | No | Yes | No | No |
| Deploy (7 targets + OAuth) | **Yes** | Yes | Yes | No | Yes | Vercel |
| Desktop packaging | **Yes** | No | No | No | No | No |
| Mobile preview (Capacitor) | **Yes** | No | No | No | No | No |
| Plugin system | **Yes** | No | No | Yes | No | No |
| Works fully offline | **Yes** | No | No | No | No | No |

[Detailed comparison](COMPARISON.md)

---

## Stacks & Templates

### Scaffolds

| Stack | What you get |
| --- | --- |
| **Frontend** | React 18 + Vite + TypeScript |
| **Full Stack** | React + Express + SQLite + Prisma |
| **Next.js** | Next.js 14 App Router + API routes + TypeScript |
| **Python** | FastAPI + SQLModel + uvicorn + SQLite |
| **Go** | Go + Chi v5 + modernc.org/sqlite |

### Templates

Start from a template or go blank:

> Todo App · Dashboard · Landing Page · Chat UI · Blog · E-commerce

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop | Electron 40 + Vite |
| Renderer | React 18 + TypeScript 5 |
| Editor | Monaco (VS Code engine) |
| Terminal | xterm.js + node-pty |
| AI | Ollama (any local model) |
| Database | SQLite (zero-config) |
| ORM | Prisma (JS/TS) · SQLModel (Python) · modernc (Go) |
| Version control | Git (auto-commit + GitHub integration) |
| Deploy | OAuth tokens + CLI + SSH/rsync + Electron Builder |
| Plugins | Custom tools, agents, themes via plugin.json |
| Testing | Vitest (329 tests) |

---

## Requirements

### Required

| Dependency | Why |
| --- | --- |
| [Node.js >= 18](https://nodejs.org) | Runs generated apps, Vite dev server, npm |
| [Ollama](https://ollama.ai) | Local AI inference |
| [Git](https://git-scm.com) | Auto-commit, version history, GitHub sync |

### Optional

| Feature | Dependency |
| --- | --- |
| Deploy to Vercel | Vercel CLI (`npm i -g vercel`) or OAuth token |
| Deploy to Netlify | Netlify CLI (`npm i -g netlify-cli`) or OAuth token |
| Deploy to Surge | `npm i -g surge` |
| Deploy to Railway | `npm i -g @railway/cli` |
| Deploy to Fly.io | [flyctl](https://fly.io/docs/getting-started/installing-flyctl/) |
| VPS deploy | rsync + SSH (pre-installed on most systems) |
| Mobile (Android) | Android SDK via [Android Studio](https://developer.android.com/studio) |
| Mobile (iOS) | Xcode (macOS only) |

---

## Installation

### Download

Grab the latest binary from [GitHub Releases](https://github.com/theKennethy/Deyad/releases/latest):

| Platform | File |
| --- | --- |
| Ubuntu / Debian | `Deyad-amd64.deb` |
| Fedora / RHEL | `Deyad-x86_64.rpm` |
| Arch / AppImage | `Deyad-x86_64.AppImage` |
| Windows | `Deyad-x64.exe` |

### Ubuntu / Debian

```bash
# Install dependencies
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2

# Install Deyad
sudo dpkg -i Deyad-amd64.deb
```

### Fedora / RHEL

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs git

curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2

sudo rpm -i Deyad-x86_64.rpm
```

### Arch Linux

```bash
sudo pacman -S nodejs npm git

curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2

chmod +x Deyad-x86_64.AppImage && ./Deyad-x86_64.AppImage
```

### Windows

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install Ollama.Ollama
ollama pull llama3.2

# Run the Deyad-x64.exe installer
```

### From Source

```bash
git clone https://github.com/theKennethy/Deyad.git
cd Deyad
npm install
npm start
```

---

## Getting Started

1. Make sure **Ollama** is running with at least one model:
   ```bash
   ollama pull llama3.2
   ```
2. Launch Deyad. The **Welcome Wizard** will verify your Ollama connection and let you select a model.
3. Click **+ New App**, pick a stack and template, and start chatting.

---

## Usage

1. **Create** — click **+ New App**, choose a stack (Frontend, Full-Stack, Next.js, Python, Go) and optionally a template
2. **Chat** — describe what you want. The agent reads code, writes files, runs commands, and iterates autonomously.
3. **Edit** — make manual changes in the Monaco editor
4. **Preview** — click Run to start the dev server and see your app live
5. **Database** — browse SQLite tables and schema in the database panel
6. **Deploy** — open the Deploy modal, pick a provider, and ship

### Full-Stack Project Structure

```
your-app/
├── frontend/           # React + Vite + TypeScript
│   ├── src/
│   ├── package.json
│   └── vite.config.ts
├── backend/            # Express + Prisma + TypeScript
│   ├── src/
│   ├── prisma/
│   └── package.json
└── .git/               # Auto-initialized
```

---

## Development

```bash
npm start          # Run in dev mode
npm test           # Run tests (Vitest)
npm run lint       # Lint TypeScript
npm run typecheck  # Type-check without emitting
```

### Build Binaries

```bash
npm run dist          # Current platform
npm run dist:linux    # Linux (deb + rpm + AppImage)
npm run dist:win      # Windows (exe)
npm run dist:all      # Linux + Windows
```

---

## License

[MIT](LICENSE)
