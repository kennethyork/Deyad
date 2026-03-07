# Deyad 🤖

**A local-first AI app builder — use [Ollama](https://ollama.ai), generate apps from chat.**

Competes with [dyad.sh](https://dyad.sh) and [Base44](https://base44.com) with full privacy, and zero lock-in.

---

## Why Deyad?

### 🔒 Privacy First — Local Only

- **Ollama** runs 100% on your machine — no cloud, no API keys, works offline
- Your code never leaves your machine unless you choose to deploy it

### 🦙 Powered by Ollama

| Provider | Models | Auth |
|----------|--------|------|
| 🦙 **Ollama** (local) | Any model you pull (llama3.2, codellama, etc.) | None needed |

### ⚡ Full Feature Set

| Feature | Deyad | dyad.sh | Base44 |
|---------|-------|---------|--------|
| Local AI (Ollama) | ✅ | ✅ | ❌ |
| Open source | ✅ | ✅ | ❌ |
| Desktop app | ✅ | ✅ | ❌ |
| Full-stack (React + Express + PostgreSQL/MySQL) | ✅ | Supabase | Managed |
| Git version control | ✅ Auto | Manual | ❌ |
| Project import | ✅ | ✅ | ❌ |
| Template library | ✅ | ✅ | ✅ |
| Export as ZIP | ✅ | ✅ | ❌ |
| Works offline | ✅ | Partial | ❌ |
| $0 with local models | ✅ | ✅ | ❌ |

---

## Features

- 🦙 **Ollama-powered AI** — runs locally, no API keys needed
- ⚡ **Frontend apps** — React + Vite scaffolded instantly
- 🗄️ **Full-stack apps** — React + Express + PostgreSQL or MySQL (Docker) + Prisma, one click
- 💬 **Chat to build** — describe your app, get working code with streaming
- 📁 **File editor** — view, edit, search generated files in-app
- 👁 **Live preview** — built-in dev server with iframe preview
- 🐳 **DB management** — Start/Stop your PostgreSQL or MySQL container from inside the app
- 📦 **Export as ZIP** — download your project as an archive
- ↩️ **Undo / Revert** — revert to before the last AI generation
- 🔀 **Git auto-commit** — every AI generation is versioned automatically
- 📂 **Import projects** — bring existing codebases into Deyad
- 🎨 **Templates** — start from Todo, Dashboard, Landing Page, Chat UI, Blog, E-commerce
- ⚙️ **Configurable** — Ollama host and default model in Settings

## Stack (full-stack mode)

| Layer    | Technology                            |
|----------|---------------------------------------|
| Frontend | React 18 + Vite + TypeScript          |
| Backend  | Node.js + Express + TypeScript        |
| Database | **PostgreSQL 16** or **MySQL 8** via Docker Compose |
| ORM      | **Prisma** (schema → type-safe client) |

## Requirements

| Requirement | Why |
|-------------|-----|
| [Node.js ≥ 18](https://nodejs.org) | Run the app |
| [Ollama](https://ollama.ai) | Powers AI chat |
| [Docker](https://docker.com) *(optional)* | Full-stack PostgreSQL/MySQL support |
| [Git](https://git-scm.com) *(optional)* | Auto version control |

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Start Deyad
npm start

# 3. Make sure Ollama is running:
#    ollama pull llama3.2
```

## Usage

1. Click **+ New App** (or 📂 to import an existing project)
2. Pick a **template** or start blank
3. Choose **Frontend Only** (React + Vite) or **Full Stack** (adds PostgreSQL/MySQL + Express + Prisma)
4. Chat with your chosen AI model to describe what you want to build
5. Deyad generates the files, writes them to disk, and auto-commits via Git
6. For full-stack apps, click **▶ Start DB** to spin up your database via Docker Compose

### Full-stack workflow

```bash
# After Deyad generates the scaffold:

# Start your database (or click "Start DB" in-app)
docker compose up -d

# Set up backend
cd backend && npm install
npx prisma db push   # applies Prisma schema to your database
npm run dev          # http://localhost:3001

# Start frontend
cd ../frontend && npm install
npm run dev          # http://localhost:5173
```

## Development

```bash
npm start      # start Electron app
npm test       # run unit tests (vitest)
npm run lint   # lint TypeScript files
```

## License

MIT
