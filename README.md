# Deyad

**A local-first AI app builder — use [Ollama](https://ollama.ai), generate apps from chat.**

Competes with [dyad.sh](https://dyad.sh) and [Base44](https://base44.com) with full privacy, and zero lock-in.

---

## Why Deyad?

### Privacy First — Local Only

- **Ollama** runs 100% on your machine — no cloud, no API keys, works offline
- Your code never leaves your machine unless you choose to deploy it

### Powered by Ollama

| Provider | Models | Auth |
|----------|--------|------|
| 🦙 **Ollama** (local) | Any model you pull (llama3.2, codellama, etc.) | None needed |

### Full Feature Set

| Feature | Deyad | dyad.sh | Base44 |
|---------|-------|---------|--------|
| Local AI (Ollama) | Yes | Yes | No |
| Open source | Yes | Yes | No |
| Desktop app | Yes | Yes | No |
| Full-stack (React + Express + PostgreSQL/MySQL) | Yes | Supabase | Managed |
| Git version control | Auto (yes) | Manual | No |
| Project import | Yes | Yes | No |
| Template library | Yes | Yes | Yes |
| Export as ZIP | Yes | Yes | No |
| Works offline | Yes | Partial | No |
| $0 with local models | Yes | Yes | No |

---

## Features

- **Ollama-powered AI** — runs locally, no API keys needed
- **Frontend apps** — React + Vite scaffolded instantly
- **Full-stack apps** — React + Express + PostgreSQL or MySQL (Docker) + Prisma, one click
- **Chat to build** — describe your app, get working code with streaming
- **File editor** — view, edit, search generated files in-app
- **Live preview** — built-in dev server with iframe preview
- **DB management** — Start/Stop your PostgreSQL or MySQL container from inside the app
- **Export as ZIP** — download your project as an archive
- **Undo / Revert** — revert to before the last AI generation
- **Git auto-commit** — every AI generation is versioned automatically
- **Import projects** — bring existing codebases into Deyad
- **Templates** — start from Todo, Dashboard, Landing Page, Chat UI, Blog, E-commerce
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

1. Click **+ New App** (or Import to import an existing project)
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

## Packaging & CI/CD

Automated GitHub Actions build Linux and Windows on every tag or manual dispatch. The workflow:

1. `npm ci` installs dependencies
2. `npm run make` creates platform-specific installers and archives
3. Artifacts are uploaded to the workflow run
4. On tag pushes the job also runs `npx electron-forge publish --platform=all --target=github` which creates a GitHub Release and attaches the binaries.

You can manually package locally:

```bash
npm run make
```

Artifacts land under `out/make/<platform>` (zip/exe) and, on Linux, you’ll also get an AppImage generated separately.

On a Linux machine you can also generate an AppImage by running:

```bash
npm run build:appimage
```

The script will invoke Forge’s make step which now creates `.deb` and `.rpm` packages in addition to the raw directory; after that it runs `appimagetool` to convert the directory into an AppImage. The tool must be installed (via your distro, or grab it from https://github.com/AppImage/AppImageKit) or you’ll see a message reminding you to install it.

To publish a release, tag and push:

```bash
git tag v1.0.0
git push origin v1.0.0
```

(This requires the `GITHUB_TOKEN` secret; Actions handles it automatically.)

Once the workflow completes a release page will contain the installers for Windows and Linux.

Automatic versioning is supported: pushing to `main` will bump the patch version, tag the commit, and trigger the build workflow (see CI section below).

## License

## License

MIT
