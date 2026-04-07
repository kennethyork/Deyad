# Contributing to Deyad

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Getting Started

```bash
git clone https://github.com/kennethyork/Deyad.git
cd Deyad
npm install
npm start
```

**Prerequisites:** Node.js >= 18, Ollama running locally, Git.

## Development Commands

### Desktop (Electron)

| Command | Description |
| --- | --- |
| `npm start` | Run in dev mode (Electron + Vite) |
| `npm test` | Run all tests (Vitest) |
| `npm run lint` | Lint with ESLint |
| `npm run typecheck` | TypeScript strict check |
| `npm run dist:linux` | Build Linux binaries (.deb, .rpm, .AppImage) |
| `npm run dist:win` | Build Windows binary (.exe) |

### CLI

| Command | Description |
| --- | --- |
| `cd cli && npm install` | Install CLI dependencies |
| `cd cli && npm run build` | Build the CLI |
| `cd cli && npm test` | Run CLI tests |
| `node cli/dist/bin/deyad.js` | Run the CLI locally |

## Project Structure

```text
src/
  main.ts              # Electron main process
  preload.ts           # Context bridge (IPC)
  renderer.tsx         # React entry point
  App.tsx              # Root React component
  components/          # React UI components (ChatPanel, EditorPanel, etc.)
  lib/                 # Shared libraries (agent, tools, indexer, parser)
  main/                # IPC handler modules (ipcApps, ipcGit, ipcDeploy, etc.)
  types/               # TypeScript type definitions
cli/
  bin/deyad.ts         # CLI entry point, arg parsing, REPL
  src/agent.ts         # Agent loop (multi-turn, auto-lint, auto-review)
  src/tools.ts         # 26 built-in tools (file I/O, git, web, vision)
  src/ollama.ts        # Ollama API client (streaming + multimodal)
  src/mcp.ts           # MCP server connection
  src/ui.ts            # Terminal UI (colors, spinner, readline)
```

## Writing Tests

### Desktop Tests

- Tests live next to their source files: `Foo.tsx` → `Foo.test.tsx`
- Use Vitest + @testing-library/react for components
- Use Vitest + happy-dom for DOM tests
- Mock `window.deyad` and `electron` in test files
- Run a single test: `npx vitest run src/path/to/file.test.ts`
- Run with coverage: `npx vitest run --coverage`

### CLI Tests

- CLI tests live in `cli/src/__tests__/`
- Use Vitest with the Node environment
- Test tools, parsers, and utilities without Ollama running
- Run CLI tests: `cd cli && npx vitest run`

## Pull Request Guidelines

1. **Fork** the repo and create a branch from `main`
2. **Write tests** for new functionality
3. **Run `npm test`** in the root — all desktop tests must pass
4. **Run `cd cli && npm test`** — all CLI tests must pass
5. **Run `npm run lint`** — no new lint errors
6. **Keep PRs focused** — one feature or fix per PR
7. **Describe your changes** in the PR description

## Code Style

- TypeScript strict mode (both desktop and CLI)
- ESLint with `@typescript-eslint` rules
- Prettier for formatting (see `.prettierrc.json`)
- Prefer `const` over `let`
- Use async/await over raw promises
- Keep functions small and focused
- No `any` unless unavoidable (and document why)

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat(cli): add web search tool
fix(desktop): resolve preview panel crash
docs: update README with CLI comparison
chore: bump dependencies
```

## Security

If you find a security vulnerability, **do not open a public issue**. Please report it privately via [GitHub Security Advisories](https://github.com/kennethyork/Deyad/security/advisories/new). See [SECURITY.md](SECURITY.md) for our full security policy.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
