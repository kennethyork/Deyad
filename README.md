# Dyad

<div align="center">

## The open-source, local-first AI app builder

Describe what you want. Get a working app. No cloud. No API keys. No subscriptions.

![Electron](https://img.shields.io/badge/Electron-40-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama-Local%20AI-000000)
![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

[Download](https://github.com/kennethyork/Dyad/releases/latest) · [Comparison](COMPARISON.md) · [Architecture](ARCHITECTURE.md)

</div>

---

Dyad is a desktop app that turns natural language into working software. It runs [Ollama](https://ollama.ai) on your machine for AI, scaffolds production stacks (React + Express + SQLite + Prisma), and gives you a full IDE — editor, terminal, live preview, database admin, version control, and deployment — all in one window.

Your code never leaves your machine. There are no tokens to buy, no accounts to create, and no internet required.

---

## Quick Start

### Download a binary

Grab the latest release for your platform from [GitHub Releases](https://github.com/kennethyork/Dyad/releases/latest):

| Platform | File |
| --- | --- |
| Ubuntu / Debian | `Dyad-amd64.deb` |
| Fedora / RHEL | `Dyad-x86_64.rpm` |
| Any Linux | `Dyad-x86_64.AppImage` |
| Windows | `Dyad-x64.exe` |

### Or run from source

```bash
git clone https://github.com/kennethyork/Dyad.git
cd Dyad && npm install && npm start
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
  → Repeats until done (up to 30 iterations)
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

| | **Dyad** | Bolt.new | Lovable | Cursor | Base44 | v0 |
| --- | --- | --- | --- | --- | --- | --- |
| Local AI (no cloud) | ✅ | — | — | — | — | — |
| Free forever | ✅ | — | — | — | — | — |
| Open source | ✅ | — | — | — | — | — |
| Works offline | ✅ | — | — | — | — | — |
| Full-stack + database | ✅ | — | Partial | — | Partial | — |
| Autonomous agent | ✅ | Partial | Partial | ✅ | Partial | — |
| Error self-fix | ✅ | — | — | — | — | — |
| Built-in DB admin | ✅ | — | — | — | — | — |
| Git auto-commit | ✅ | — | — | — | — | — |
| RAG + embeddings | ✅ | — | — | ✅ | — | — |
| Plan → approve → execute | ✅ | — | — | — | — | — |
| Deploy (7 targets) | ✅ | ✅ | ✅ | — | ✅ | Vercel |
| Desktop packaging | ✅ | — | — | — | — | — |
| Mobile preview | ✅ | — | — | — | — | — |
| Plugin system | ✅ | — | — | ✅ | — | — |

> Every other AI app builder sends your code to a cloud API. Dyad runs inference entirely on your hardware via Ollama. Zero cloud dependency. Zero cost. Zero data leakage.

[Full comparison →](COMPARISON.md)

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop | Electron 40 + Vite |
| UI | React 18 + TypeScript 5 |
| Editor | Monaco |
| Terminal | xterm.js + node-pty |
| AI | Ollama (any local model) |
| Frontend scaffold | React + Vite + TypeScript |
| Backend scaffold | Express + TypeScript |
| Database | SQLite + Prisma |
| DB Admin | Prisma Studio |
| Version control | Git |
| Packaging | Electron Builder |
| Tests | Vitest (308 passing) |

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

# Dyad — install the .deb
sudo dpkg -i Dyad-amd64.deb
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

# Dyad — install the .rpm
sudo rpm -i Dyad-x86_64.rpm
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

# Dyad — run the AppImage
chmod +x Dyad-x86_64.AppImage && ./Dyad-x86_64.AppImage
```

</details>

<details>
<summary><b>Windows 10/11</b></summary>

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install Ollama.Ollama
ollama pull llama3.2

# Download and run Dyad-x64.exe from GitHub Releases
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

## License

MIT
