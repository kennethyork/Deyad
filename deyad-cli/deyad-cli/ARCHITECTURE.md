# Architecture

## Module Overview

```text
src/
├── cli.ts        # Entry point — argument parsing, REPL, mode dispatch
├── tui.ts        # Terminal UI — readline interface, colors, spinners
├── agent.ts      # Agent loop — orchestrates LLM ↔ tool execution cycle
├── ollama.ts     # Ollama API client — streaming chat, FIM, health checks
├── tools.ts      # Tool registry + 20 built-in tools (file I/O, git, shell, web)
├── rag.ts        # RAG indexer — BM25 scoring on codebase chunks
├── lint.ts       # Auto-lint — detects linters, runs them on changed files
├── session.ts    # Session persistence — save/restore history + encrypted memory
├── sandbox.ts    # Sandbox mode — temporary git branch isolation
└── undo.ts       # Undo/rollback — git snapshots for reverting agent changes
```

## Data Flow

```text
User input
    │
    ▼
cli.ts (parse args, select mode)
    │
    ▼
agent.ts::runAgentLoop()
    ├── buildContext() — read project files, key configs
    ├── rag.ts::queryIndex() — BM25 retrieve relevant code chunks
    │
    ▼ ── streaming loop ──
    │
    ├── ollama.ts::streamChat() — stream LLM response
    ├── parseToolCallsFromTurn() — parse native or XML tool calls
    ├── dispatchTools() — execute tools (parallel read / sequential write)
    │     └── tools.ts::executeTool() — route to tool handler
    ├── runAutoLint() — lint changed files, feedback errors
    ├── formatToolResultMessages() — format results for conversation
    └── compactConversation() — trim history when >128k chars
    │
    ▼
session.ts::saveSession() — persist conversation for --resume
```

## Key Design Decisions

### Tool Registry Pattern

Tools are registered in a `Map<string, ToolHandler>` (`toolRegistry`). Built-in tools auto-register on import. Custom tools can be added via `toolRegistry.set('name', handler)` without modifying core code.

### Security Model

Every file operation resolves the path and validates it starts with the project `cwd`. Shell commands are parsed with `shell-quote` to detect operators — simple commands use `execFileSync` (no shell), complex ones fall back to `execSync`. SSRF protection blocks all private/link-local IPs and non-HTTP schemes.

### Conversation Compaction

When conversation exceeds 128k chars (~32k tokens), older messages are summarized into a compact system message, keeping only the 10 most recent messages intact.

### RAG Strategy

Uses BM25 (Okapi variant) on code chunks (~40 lines each). Index is cached for 60 seconds and invalidated when the agent writes files. Stop words and camelCase splitting improve relevance.

### Constants

| Constant | Value | Rationale |
| --- | --- | --- |
| `MAX_CONVERSATION_CHARS` | 128,000 | ~32k tokens at 4 chars/token, fits most Ollama context windows |
| `MAX_ITERATIONS` | 50 | Prevent infinite agent loops |
| `COMPACT_KEEP_RECENT` | 10 | Keep enough recent context for coherent multi-turn |
| `BM25_K1` (rag.ts) | 1.5 | Standard BM25 term frequency saturation |
| `BM25_B` (rag.ts) | 0.75 | Standard BM25 document length normalization |
| `CHUNK_SIZE` (rag.ts) | 40 | Lines per chunk — balances granularity vs. context |
| `CACHE_TTL` (rag.ts) | 60,000ms | Avoid re-indexing on every query during a session |
