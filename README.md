# Deyad 🤖

**A local AI app builder powered exclusively by [Ollama](https://ollama.ai) models.**

Like [dyad.sh](https://dyad.sh) but without any cloud dependency — every AI call stays on your machine.

---

## Why Deyad for Ollama-Only Users?

If you're committed to running AI locally with Ollama, Deyad offers several advantages over dyad.sh:

### 🔒 Privacy First

| | Deyad | dyad.sh |
|---|---|---|
| **Cloud API calls** | ❌ None — 100% local | Uses cloud providers by default |
| **API keys required** | ❌ Never | Often required for full functionality |
| **Data leaves machine** | ❌ Never | Depends on provider selection |
| **Works offline** | ✅ Fully offline-capable | Requires internet for cloud models |

### ⚡ Ollama-Optimized

- **Native Ollama streaming** — Direct integration with Ollama's streaming API for real-time token display
- **Model auto-discovery** — Automatically detects and lists all models available in your local Ollama instance
- **Zero configuration** — No API keys, no environment variables, no account setup
- **Fast local inference** — No network latency to cloud endpoints

### 💰 Cost Savings

- **$0 per token** — No cloud API fees, ever
- **No usage limits** — Generate as much code as your hardware allows
- **No rate limiting** — Full speed ahead, limited only by your GPU/CPU

### 🛠️ Built for Local Development

- **Electron desktop app** — Native performance, no browser required
- **Integrated file management** — View and edit generated files directly in the app
- **Docker Compose integration** — One-click database setup for full-stack apps
- **Persistent project storage** — All apps saved locally in your user data directory

---

## Features

- 🦙 **Ollama-only** — no cloud APIs, no keys, complete privacy
- ⚡ **Frontend apps** — React + Vite scaffolded instantly
- 🗄️ **Full-stack apps** — React + Express + **MySQL** (Docker) + Prisma, one click
- 💬 **Chat to build** — describe your app, get working code
- 📁 **File editor** — view and browse generated files in-app
- 🐳 **DB management** — Start/Stop your MySQL container from inside the app

## Stack (full-stack mode)

| Layer    | Technology                            |
|----------|---------------------------------------|
| Frontend | React 18 + Vite + TypeScript          |
| Backend  | Node.js + Express + TypeScript        |
| Database | **MySQL 8** via Docker Compose         |
| ORM      | **Prisma** (schema → type-safe client) |

## Requirements

| Requirement | Why |
|-------------|-----|
| [Ollama](https://ollama.ai) running locally | Powers all AI chat |
| [Node.js ≥ 18](https://nodejs.org) | Run the app |
| [Docker](https://docker.com) *(optional)* | Full-stack MySQL support |

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Make sure Ollama is running with at least one model
ollama pull llama3.2

# 3. Start Deyad
npm start
```

## Usage

1. Click **+ New App**
2. Choose **Frontend Only** (React + Vite) or **Full Stack** (adds MySQL + Express + Prisma)
3. Chat with your chosen Ollama model to describe what you want to build
4. Deyad generates the files and writes them to disk
5. For full-stack apps, click **▶ Start DB** to spin up MySQL via Docker Compose

### Full-stack workflow

```bash
# After Deyad generates the scaffold:

# Start MySQL (or click "Start DB" in-app)
docker compose up -d

# Set up backend
cd backend && npm install
npx prisma db push   # applies Prisma schema to MySQL
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

## When to Use Deyad vs dyad.sh

| Use Case | Recommendation |
|----------|----------------|
| Privacy-critical projects | ✅ **Deyad** — data never leaves your machine |
| Offline development | ✅ **Deyad** — works without internet |
| Ollama-exclusive workflow | ✅ **Deyad** — purpose-built for Ollama |
| Cost-conscious teams | ✅ **Deyad** — zero cloud API costs |
| Need cloud provider options | Consider dyad.sh for cloud model variety |
| Enterprise/team features | Consider dyad.sh if cloud features are needed |

**Bottom line:** If you're an Ollama user who values privacy, cost savings, and offline capability, Deyad is the better choice. It's designed from the ground up for local-first AI development.

## License

MIT
