# Deyad

![Electron](https://img.shields.io/badge/Electron-40-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama-Local%20AI-000000)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![MIT](https://img.shields.io/badge/License-MIT-green)

**The open-source, local-first AI app builder.** Describe what you want, get a working app — frontend or full-stack — without sending a single byte to the cloud.

Deyad runs [Ollama](https://ollama.ai) on your machine for AI inference, scaffolds real production stacks (React + Express + PostgreSQL + Prisma), and gives you a complete IDE with live preview, terminal, database admin, version history, and one-click deployment.

**Your data stays on your machine. No API keys. No subscriptions. No token limits.**

---

## How It Works

```text
You describe your app in chat
    → Deyad's autonomous agent reads your codebase
    → Plans the approach
    → Writes/edits files across your project
    → Runs shell commands to verify
    → Auto-fixes errors from dev server logs
    → Auto-commits every change to Git
    → Repeats until done (up to 30 iterations)
```

---

## Feature Comparison

| Feature | **Deyad** | **Bolt.new** | **Lovable** | **Cursor** | **Base44** | **v0** |
| --- | --- | --- | --- | --- | --- | --- |
| **AI Platform** | **Ollama (local)** | Cloud LLM | Cloud LLM | Cloud LLM | Cloud LLM | Cloud LLM |
| 100% offline / local AI | **Yes** | No | No | No | No | No |
| Free forever (no token limits) | **Yes** | No | No | No | No | No |
| Your data stays on your machine | **Yes** | No | No | No | No | No |
| No API key / account required | **Yes** | No | No | No | No | No |
| Open source | **Yes** | No | No | No | No | No |
| Full-stack with real database | **Yes** | No | Partial | No | Partial | No |
| Autonomous agent (multi-step) | **Yes** | Partial | Partial | Yes | Partial | No |
| Error auto-detect & self-fix | **Yes** | No | No | No | No | No |
| Built-in database admin (pgAdmin) | **Yes** | No | No | No | No | No |
| Git auto-commit every generation | **Yes** | No | No | No | No | No |
| GitHub push/pull/branches | **Yes** | No | No | Yes | No | No |
| AI handles git commands in chat | **Yes** | No | No | No | No | No |
| AI code completion (FIM) | **Yes** | No | No | Yes | No | No |
| RAG with local embeddings | **Yes** | No | No | Yes | No | No |
| Plan → Approve → Execute mode | **Yes** | No | No | No | No | No |
| Diff preview before applying | **Yes** | No | No | Yes | No | No |
| Image → Code (vision models) | **Yes** | Yes | Yes | Yes | No | Yes |
| Live preview | **Yes** | Yes | Yes | No | Yes | Yes |
| Integrated terminal | **Yes** | Partial | No | Yes | No | No |
| Deploy (7 targets incl. VPS) | **Yes** | Yes | Yes | No | Yes | Vercel only |
| Desktop app packaging (Electron) | **Yes** | No | No | No | No | No |
| Built-in Ollama in packaged apps | **Yes** | No | No | No | No | No |
| Mobile preview (Capacitor) | **Yes** | No | No | No | No | No |
| Plugin system | **Yes** | No | No | Yes | No | No |
| Works without internet | **Yes** | No | No | No | No | No |

> **Why Ollama-only matters:** Every other AI app builder sends your code and prompts to a cloud API — you pay per token, you need an account, and your proprietary code leaves your machine. Deyad runs inference entirely on your hardware via Ollama. **Zero cloud dependency. Zero cost. Zero data leakage.**

---

## Features

### Autonomous AI Agent

- **Multi-step agent loop** — reads code, writes files, runs commands, fixes errors, iterates up to 30 times
- **18 agent tools**: `list_files`, `read_file`, `write_files`, `edit_file`, `multi_edit`, `run_command`, `search_files`, `db_schema`, `git_status`, `git_commit`, `git_push`, `git_pull`, `git_remote_get`, `git_remote_set`, `git_branch`, `git_branch_create`, `git_branch_switch`, `git_log`
- **Error auto-detection** — watches Vite dev server logs, auto-sends up to 3 fix attempts
- **Planning mode** — agent generates a plan for your approval before executing
- **Context-aware** — injects live database schema, file summaries, and conversation history
- **RAG retrieval** — semantic search with local Ollama embeddings + TF-IDF fallback
- **AI code completion** — fill-in-the-middle completions using any FIM-capable model
- **Vision support** — paste a screenshot or mockup, get working UI code
- **Context compaction** — auto-summarizes older turns to stay within token limits (~32k)

### Built-in IDE

- **Monaco editor** — same engine as VS Code, syntax highlighting for 15+ languages
- **File tree** — nested directory view with search (Ctrl/Cmd+P)
- **Live preview** — embedded Vite dev server with run/stop/refresh controls
- **Integrated terminal** — full xterm.js PTY with copy/paste and context menu
- **Package manager** — install/uninstall npm packages from the UI
- **Environment variables** — multi-file `.env` editor
- **Diff preview** — review AI changes before accepting, with snapshot-based undo
- **Dark / Light theme** — user-selectable theme toggle in Settings, persisted across sessions

### Database

- **PostgreSQL 17** — containerized via Docker/Podman, auto-configured
- **Prisma ORM** — type-safe schema management
- **pgAdmin** — embedded database admin UI inside the app
- **One-click start/stop** — manage containers from the UI
- **Schema introspection** — AI agent can query live table structure while coding

### Version Control & GitHub

- **Auto-commit** — every AI generation is committed to Git automatically
- **GitHub integration** — connect any project to a GitHub (or GitLab) repo
- **Push / Pull** — sync with remote from the Git panel or just ask the AI
- **Branching** — create, switch, and list branches from the UI
- **AI git commands** — type "push to github", "create a feature branch", or "commit my changes" in chat and the agent handles it
- **Version history** — browse all commits in a timeline
- **One-click restore** — revert to any previous version
- **File diff** — view changes per file at any commit
- **Snapshot undo** — revert to the state before the last AI generation

### Deployment

Deploy to 7 targets directly from the app:

| Provider | Type | Pricing |
| --- | --- | --- |
| **Vercel** | Frontend & full-stack | Free tier |
| **Netlify** | Frontend & full-stack | Free tier |
| **Surge** | Static sites | Free |
| **Railway** | Full-stack with database | Usage-based |
| **Fly.io** | Container-based | Free tier |
| **VPS (SSH + rsync)** | Any Linux server via SSH | Your own server |
| **Electron Desktop** | Standalone desktop app (Linux/Win/Mac) | Free |

- **VPS deploy** — build your frontend and rsync the dist to any Linux server over SSH
  - Configure user, host, remote path, and SSH port from the UI
  - Optional **custom domain** — auto-generates nginx config with SPA routing
  - **Free SSL** — auto-runs Let’s Encrypt certbot for HTTPS + HTTP→HTTPS redirect
  - Input validation prevents shell injection
- **Desktop packaging** — build a standalone Electron app with built-in Ollama AI bridge
  - Generated apps ship with `window.ollama` API for chat, generate, model listing
  - Targets: AppImage (Linux), exe/NSIS (Windows), DMG (macOS)
- **Mobile preview** — test your app on a connected Android/iOS device via Capacitor
- CLI auto-detection — shows which deploy tools are installed and ready
- Streaming deploy logs in real-time
- **ZIP export** — download your project as an archive
- **PWA export** — mobile-ready with Web App Manifest

### Templates

Start from a template or go blank:

- Todo App · Dashboard · Landing Page · Chat UI · Blog · E-commerce

### Plugins

Drop custom templates into the `plugins/` directory with a `plugin.json` manifest. Auto-discovered on startup.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop | Electron 40 + Vite |
| Renderer | React 18 + TypeScript |
| Editor | Monaco (VS Code engine) |
| Terminal | xterm.js + node-pty |
| AI | Ollama (any local model) |
| Frontend scaffold | React + Vite + TypeScript |
| Backend scaffold | Node.js + Express + TypeScript |
| Database | PostgreSQL 17 (Docker/Podman) |
| ORM | Prisma |
| DB Admin | pgAdmin (latest) |
| Version control | Git (auto-commit + GitHub push/pull/branches) |
| Desktop deploy | Electron Builder (AppImage/exe/DMG) |
| Testing | Vitest |

---

## Requirements

| Requirement | Why | Required? |
| --- | --- | --- |
| [Node.js >= 18](https://nodejs.org) | Run the app | Yes |
| [Ollama](https://ollama.ai) | Local AI inference | Yes |
| [Docker](https://docker.com) or [Podman](https://podman.io) | Database containers | For full-stack apps |
| [Git](https://git-scm.com) | Auto version control | Recommended |

---

## Getting Started

```bash
# Clone and install
git clone https://github.com/theKennethy/Deyad.git
cd Deyad
npm install

# Make sure Ollama is running with a model
ollama pull llama3.2

# Start Deyad
npm start
```

On first launch, the **Welcome Wizard** walks you through connecting to Ollama and selecting a model.

---

## Usage

1. **Create an app** — click **+ New App**, pick a template or start blank, choose Frontend or Full-Stack
2. **Chat** — describe what you want in natural language. The agent reads your code, writes files, runs commands, and iterates autonomously.
3. **Edit** — use the built-in Monaco editor to make manual changes
4. **Preview** — click Run to start the Vite dev server and see your app live
5. **Database** — toggle the DB on to start PostgreSQL + pgAdmin containers
6. **Deploy** — click Publish, select a provider, and deploy

### Full-Stack Project Structure

```text
your-app/
├── frontend/           # React + Vite + TypeScript
│   ├── src/
│   ├── package.json
│   └── vite.config.ts
├── backend/            # Express + Prisma + TypeScript
│   ├── src/
│   ├── prisma/
│   └── package.json
├── docker-compose.yml  # PostgreSQL + pgAdmin
└── .git/               # Auto-initialized
```

---

## Development

```bash
npm start       # Start Electron app in dev mode
npm test        # Run unit tests (Vitest)
npm run lint    # Lint TypeScript files
```

## Packaging

```bash
npm run dist          # Build for current platform
npm run dist:linux    # Linux (deb, rpm, AppImage)
npm run dist:win      # Windows (exe/NSIS)
npm run dist:all      # Linux + Windows
```

Produces `.deb`, `.rpm`, and AppImage on Linux, `.exe` on Windows.

---

## License

MIT
