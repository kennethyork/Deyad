import { describe, it, expect } from 'vitest';
import { generateFrontendScaffold, generateFullStackScaffold, allocatePorts } from '../lib/scaffoldGenerator';

describe('generateFrontendScaffold', () => {
  const opts = { appName: 'My App', description: 'A test app' };

  it('generates package.json with React and Vite', () => {
    const files = generateFrontendScaffold(opts);
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.dependencies.react).toBeDefined();
    expect(pkg.dependencies['react-dom']).toBeDefined();
    expect(pkg.devDependencies['@vitejs/plugin-react']).toBeDefined();
    expect(pkg.devDependencies.vite).toBeDefined();
    expect(pkg.scripts.dev).toBe('vite');
    expect(pkg.scripts.build).toBeDefined();
  });

  it('generates vite.config.ts with React plugin', () => {
    const files = generateFrontendScaffold(opts);
    expect(files['vite.config.ts']).toContain('@vitejs/plugin-react');
  });

  it('generates tsconfig files', () => {
    const files = generateFrontendScaffold(opts);
    const ts = JSON.parse(files['tsconfig.json']);
    expect(ts.compilerOptions.jsx).toBe('react-jsx');
    expect(files['tsconfig.node.json']).toBeDefined();
  });

  it('generates index.html with app name in title', () => {
    const files = generateFrontendScaffold(opts);
    expect(files['index.html']).toContain('<title>My App</title>');
    expect(files['index.html']).toContain('src/main.tsx');
  });

  it('generates src/main.tsx with ReactDOM.createRoot', () => {
    const files = generateFrontendScaffold(opts);
    expect(files['src/main.tsx']).toContain('ReactDOM.createRoot');
  });

  it('generates src/App.tsx with app name and description', () => {
    const files = generateFrontendScaffold(opts);
    expect(files['src/App.tsx']).toContain('My App');
    expect(files['src/App.tsx']).toContain('A test app');
  });

  it('generates src/index.css', () => {
    const files = generateFrontendScaffold(opts);
    expect(files['src/index.css']).toBeDefined();
    expect(files['src/index.css'].length).toBeGreaterThan(0);
  });

  it('sanitizes app name into a valid npm package name', () => {
    const files = generateFrontendScaffold({ appName: 'Hello World!', description: '' });
    const pkg = JSON.parse(files['package.json']);
    // spaces and special chars become hyphens; trailing hyphens are trimmed
    expect(pkg.name).toBe('hello-world');
  });
});

describe('generateFullStackScaffold', () => {
  const opts = {
    appName: 'My App',
    description: 'Test app',
    dbName: 'myapp_db',
    dbUser: 'myapp_user',
    dbPassword: 'pass123',
  };

  it('does not generate docker-compose.yml', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['docker-compose.yml']).toBeUndefined();
  });

  it('generates Prisma schema with SQLite provider', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['backend/prisma/schema.prisma']).toContain('provider = "sqlite"');
    expect(files['backend/prisma/schema.prisma']).toContain('DATABASE_URL');
  });

  it('generates backend .env with SQLite file URL', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['backend/.env']).toContain('file:./dev.db');
  });

  it('generates backend package.json with Express and Prisma', () => {
    const files = generateFullStackScaffold(opts);
    const pkg = JSON.parse(files['backend/package.json']);
    expect(pkg.dependencies.express).toBeDefined();
    expect(pkg.dependencies['@prisma/client']).toBeDefined();
    expect(pkg.dependencies.cors).toBeDefined();
    expect(pkg.devDependencies.prisma).toBeDefined();
  });

  it('generates frontend with React + Vite', () => {
    const files = generateFullStackScaffold(opts);
    const pkg = JSON.parse(files['frontend/package.json']);
    expect(pkg.dependencies.react).toBeDefined();
    expect(pkg.devDependencies['@vitejs/plugin-react']).toBeDefined();
    expect(files['frontend/vite.config.ts']).toContain("target: process.env.VITE_BACKEND_URL || 'http://localhost:3001'");
  });

  it('generates frontend app entry point', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['frontend/src/main.tsx']).toContain('ReactDOM.createRoot');
    expect(files['frontend/src/App.tsx']).toContain('My App');
  });

  it('generates README with SQLite stack info', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['README.md']).toContain('React');
    expect(files['README.md']).toContain('Express');
    expect(files['README.md']).toContain('SQLite');
    expect(files['README.md']).toContain('Prisma');
    expect(files['README.md']).not.toContain('docker');
  });
});

describe('allocatePorts', () => {
  it('returns two different ports in the valid range', () => {
    const [db, gui] = allocatePorts('test-app-123');
    expect(db).toBeGreaterThanOrEqual(10000);
    expect(db).toBeLessThan(60000);
    expect(gui).toBe(db + 1);
  });

  it('returns different ports for different app IDs', () => {
    const [db1] = allocatePorts('app-alpha');
    const [db2] = allocatePorts('app-beta');
    expect(db1).not.toBe(db2);
  });

  it('is deterministic for the same app ID', () => {
    const a = allocatePorts('stable-id');
    const b = allocatePorts('stable-id');
    expect(a).toEqual(b);
  });
});

