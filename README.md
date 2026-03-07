# Deyad 🤖

**A local AI app builder powered exclusively by [Ollama](https://ollama.ai) models.**

Like [dyad.sh](https://dyad.sh) but without any cloud dependency — every AI call stays on your machine.

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

## License

MIT
