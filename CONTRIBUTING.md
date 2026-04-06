# Contributing to Deyad

Thanks for your interest in contributing to Deyad! This guide will help you get started.

## Getting Started

```bash
git clone https://github.com/kennethyork/Deyad.git
cd Deyad
npm install
npm start
```

**Prerequisites:** Node.js >= 18, Ollama, Git.

## Development Commands

| Command | Description |
|---|---|
| `npm start` | Run in dev mode (Electron + Vite) |
| `npm test` | Run tests (Vitest) |
| `npm run lint` | Lint with ESLint |
| `npm run typecheck` | TypeScript strict check |
| `npm run dist:linux` | Build Linux binaries |
| `npm run dist:win` | Build Windows binaries |

## Project Structure

```
src/
  main.ts              # Electron main process
  preload.ts           # Context bridge (IPC)
  renderer.tsx         # React entry point
  App.tsx              # Root React component
  components/          # React UI components
  lib/                 # Shared libraries (agent, tools, indexer, parser)
  main/                # IPC handler modules (ipcApps, ipcGit, ipcDeploy, etc.)
  types/               # TypeScript type definitions
cli/                   # Standalone CLI agent (no Electron)
```

## Writing Tests

- Tests live next to their source files: `Foo.tsx` → `Foo.test.tsx`
- Use Vitest + @testing-library/react for components
- Use Vitest + happy-dom for DOM tests
- Mock `window.deyad` and `electron` in test files
- Run a single test file: `npx vitest run src/path/to/file.test.ts`
- Run with coverage: `npx vitest run --coverage`

## Pull Request Guidelines

1. **Fork** the repo and create a branch from `main`
2. **Write tests** for new functionality
3. **Run `npm test`** — all tests must pass
4. **Run `npm run lint`** — no new lint errors
5. **Keep PRs focused** — one feature or fix per PR
6. **Describe your changes** in the PR description

## Code Style

- TypeScript strict mode
- ESLint with `@typescript-eslint` rules
- Prefer `const` over `let`
- Use async/await over raw promises
- Keep functions small and focused
- No `any` unless unavoidable (and document why)

## Security

If you find a security vulnerability, please report it privately via [GitHub Security Advisories](https://github.com/kennethyork/Deyad/security/advisories/new) instead of opening a public issue.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
