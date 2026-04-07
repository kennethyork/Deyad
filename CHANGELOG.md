# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.36] — 2026-04-06

### Added

- **CLI**: Web search tool (`web_search`) — DuckDuckGo HTML scraping, no API key needed
- **CLI**: Image analysis tool (`analyze_image`) — Ollama vision model integration with auto-detection
- **CLI**: Multi-language auto-lint for 12 languages (TypeScript, JavaScript, Python, Rust, Go, Java, Kotlin, C/C++, Ruby, PHP, Dart, Swift)
- **CLI**: Multi-language auto-review (off-by-one, TODO/FIXME, mutable defaults, bare except, .unwrap())
- **CLI**: Full tool parity with desktop — 26 built-in tools
- **CLI**: `multi_edit` tool for batch file edits (up to 20 per call)
- **CLI**: `install_package` tool (npm, pip, go)
- **CLI**: Full git tool suite: push, pull, branch, branch_create, branch_switch, remote_get, remote_set
- **CLI**: SSRF protection on `fetch_url` (blocks private/internal IPs)
- **CLI**: Dangerous command blocking in `run_command` (rm -rf, sudo, mkfs, curl|sh, etc.)
- **Desktop**: 476 tests across 45 files (64% statement coverage)
- CONTRIBUTING.md with project structure, test guidelines, and code style

### Changed

- **CLI**: Agent loop aligned with desktop — unlimited iterations, context refresh after writes
- **CLI**: Tool result XML format changed to `<status>success|error</status>` matching desktop
- **CLI**: System prompt updated with constraint-following rules, self-review checklist, output rules
- **CLI**: Streaming output shown in all modes (print, headless, interactive)
- TypeScript upgraded to 6.0.2

### Fixed

- **CLI**: Model auto-select in headless mode (no longer hangs on model picker)
- **CLI**: `<done/>` tag no longer printed to terminal output
- Restored accidentally deleted CONTRIBUTING.md
- `.gitignore` updated to exclude `.deyad-audit.jsonl` and `.deyad-session.json`

## [1.4.35] — 2026-04-05

### Added

- **CLI**: MCP (Model Context Protocol) server support
- Security hardening across desktop and CLI
- Test coverage boost to 427 tests
- GitHub Actions workflow for multi-platform builds

### Changed

- Removed agent iteration limits (desktop and CLI)
- Quality fixes from grade report (6 items)

### Fixed

- TypeScript 5.7 → 6.0 deprecation warnings
- Monaco 0.55 typescript type bindings
- Duplicate README heading (MD024)

## [1.4.34] — 2026-04-04

### Added

- **CLI**: Standalone CLI agent (`deyad-cli`) — Node.js, no Electron
- 15 built-in tools: file I/O, shell, search, git, fetch, memory
- Interactive REPL with slash commands
- Print mode (`--print`) for scripting
- MCP server connections via `--mcp` flag

### Changed

- README expanded with full CLI documentation and comparison tables

## [1.4.33] — 2026-04-03

### Added

- Initial desktop release
- Electron 40 + React 18 + Vite + Ollama + SQLite + Prisma
- Full IDE: editor (Monaco), terminal, live preview, database admin
- Version control panel with diff viewer
- Chat-driven AI code generation
- App scaffolding (React + Express + SQLite + Prisma)
- Package manager panel
- Environment variables panel
- Deploy modal (Vercel, Netlify, Docker)
- Import from GitHub/ZIP
- Welcome wizard for first-time setup
