# Deyad Architecture

Local-first AI app builder powered by Ollama. Ships as a cross-platform Electron desktop app.

## High-Level Diagram

```text
┌─────────────────────────────────────────────────────┐
│                    Renderer (React)                  │
│  App.tsx → Sidebar + Panels (Chat, Editor, Preview…) │
│         IPC via contextBridge (preload.ts)            │
└────────────────────────┬────────────────────────────┘
                         │  ipcRenderer ↔ ipcMain
┌────────────────────────▼────────────────────────────┐
│                  Main Process (Electron)              │
│  main.ts → registers IPC handler modules              │
│  src/main/ipc*.ts  (Apps, Docker, Git, Ollama, …)    │
│  src/lib/          (agent loop, tools, indexer, …)    │
└────────────────────────┬────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   File System      Ollama API      SQLite / DB
   (deyad-apps/)   (localhost:11434)  (Prisma)
```

## Process Model

| Process | Entry | Role |
| --------- | ------- | ------ |
| **Main** | `src/main.ts` | Electron main process — window management, IPC hub, file I/O, child processes |
| **Preload** | `src/preload.ts` | Secure bridge — exposes `window.deyad` API via `contextBridge` |
| **Renderer** | `src/renderer.tsx` | React SPA — all UI components, agent chat, editor |

## Directory Structure

```text
src/
├── main.ts              # Main process entry (lean hub — delegates to modules)
├── preload.ts           # contextBridge API surface
├── renderer.tsx         # React DOM mount
├── App.tsx              # Root component — routing, layout, state
├── components/          # 22 React components (each with co-located .test.tsx)
│   ├── ChatPanel.tsx        # AI chat + agent mode
│   ├── EditorPanel.tsx      # Monaco code editor
│   ├── PreviewPanel.tsx     # Live app preview (webview)
│   ├── TerminalPanel.tsx    # Embedded terminal (xterm.js)
│   ├── DatabasePanel.tsx    # Prisma Studio / DB management
│   ├── Sidebar.tsx          # App list & navigation
│   ├── GitPanel.tsx         # Git operations
│   ├── DeployModal.tsx      # VPS deploy via SSH + rsync
│   └── …                   # Settings, Import, WelcomeWizard, etc.
├── main/                # IPC handler modules (8 files, each with .test.ts)
│   ├── ipcApps.ts           # App CRUD, snapshots, file read/write
│   ├── ipcDocker.ts         # SQLite + Prisma Studio lifecycle
│   ├── ipcGit.ts            # Git operations (commit, push, pull, etc.)
│   ├── ipcOllama.ts         # Ollama model listing + streaming chat
│   ├── ipcSettings.ts       # Settings, npm, env vars, plugins
│   ├── ipcTerminal.ts       # PTY terminal management
│   ├── ipcCapacitor.ts      # Capacitor mobile builds
│   └── ipcDeploy.ts         # VPS deployment (SSH + rsync + nginx + SSL)
├── lib/                 # Shared utilities (12 modules, each with .test.ts)
│   ├── agentLoop.ts         # Autonomous agent loop (Ollama ↔ tools, 30 iter cap)
│   ├── agentTools.ts        # Tool call parsing + execution
│   ├── contextBuilder.ts    # Smart context assembly for LLM prompts
│   ├── codebaseIndexer.ts   # Embedding-based RAG indexer
│   ├── codeParser.ts        # AST parsing for code intelligence
│   ├── scaffoldGenerator.ts # Project scaffolding templates
│   ├── taskQueue.ts         # Background task queue management
│   ├── errorDetector.ts     # Runtime error pattern detection
│   ├── crc32.ts             # CRC-32 checksum
│   ├── crypto.ts            # Cryptographic password generation
│   ├── electronCheck.ts     # Environment detection
│   └── mainUtils.ts         # Settings I/O, path validation
└── types/
    └── deyad.d.ts       # Shared TypeScript interfaces
```

## Security Model

- **Context isolation**: `contextIsolation: true` — renderer cannot access Node.js
- **No node integration**: `nodeIntegration: false`
- **Sandbox**: `sandbox: true` — renderer runs in Chromium sandbox
- **Preload bridge**: All IPC goes through a typed `contextBridge` API (`window.deyad`)
- **Path validation**: All app file paths are validated against `APPS_DIR` to prevent traversal
- **No shell injection**: Zero `shell: true` usage — all commands use array-form spawn
- **CSP scoped**: Content-Security-Policy header stripping restricted to `localhost` origins only
- **Code signing**: macOS notarization + Windows SHA-256 signing configured in electron-builder

## Agent Loop

The agent (`src/lib/agentLoop.ts`) runs an autonomous multi-turn conversation:

1. Builds context from project files (with optional RAG embeddings)
2. Streams a response from Ollama
3. Parses XML `<tool_call>` blocks → executes tools (file I/O, shell commands, git)
4. Feeds tool results back and iterates
5. **Hard cap at 30 iterations** — fires `onError` with continuation message
6. Abortable via returned cleanup function
7. Conversation compaction when context exceeds ~32k tokens

## Testing

- **Framework**: Vitest + React Testing Library + jsdom
- **305 tests** across 43 test files
- **Coverage**: Components 22/22, IPC 8/8, Lib 12/12
- **Coverage thresholds**: Statements 50%, branches 40%, functions 45%, lines 50% (v8)

## Build & Release

- **Bundler**: Vite (renderer + main + preload configs)
- **Packager**: electron-builder → AppImage, deb, rpm (Linux) + exe (Windows) + dmg (macOS)
- **Auto-updater**: `update-electron-app` with GitHub releases
- **Publish**: GitHub Releases via `gh release create`
