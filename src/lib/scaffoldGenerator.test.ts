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
    appName: 'My PG App',
    description: 'Test pg app',
    dbName: 'mypgapp_db',
    dbUser: 'mypgapp_user',
    dbPassword: 'PgP@ss!456',
  };

  it('generates docker-compose.yml with PostgreSQL', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['docker-compose.yml']).toContain('postgres:17');
    expect(files['docker-compose.yml']).toContain('mypgapp_db');
    expect(files['docker-compose.yml']).toContain('mypgapp_user');
    expect(files['docker-compose.yml']).toContain('PgP@ss!456');
    expect(files['docker-compose.yml']).toContain("'5433:5432'");
  });

  it('includes pgAdmin service in docker-compose', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['docker-compose.yml']).toContain('dpage/pgadmin4');
    expect(files['docker-compose.yml']).toContain("'5050:80'");
    expect(files['docker-compose.yml']).toContain('PGADMIN_DEFAULT_EMAIL');
    expect(files['docker-compose.yml']).toContain('condition: service_healthy');
  });

  it('uses pg_isready for healthcheck', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['docker-compose.yml']).toContain('pg_isready');
    expect(files['docker-compose.yml']).toContain('-U mypgapp_user');
  });

  it('does not include MySQL-specific config', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['docker-compose.yml']).not.toContain('mysql');
    expect(files['docker-compose.yml']).not.toContain('MYSQL_');
    expect(files['docker-compose.yml']).not.toContain('3306');
  });

  it('generates Prisma schema with PostgreSQL provider', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['backend/prisma/schema.prisma']).toContain('provider = "postgresql"');
    expect(files['backend/prisma/schema.prisma']).toContain('DATABASE_URL');
  });

  it('generates backend .env with correct PostgreSQL DATABASE_URL', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['backend/.env']).toContain(
      'postgresql://mypgapp_user:PgP@ss!456@localhost:5433/mypgapp_db',
    );
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
    expect(files['frontend/src/App.tsx']).toContain('My PG App');
  });

  it('generates README with PostgreSQL stack info', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['README.md']).toContain('React');
    expect(files['README.md']).toContain('Express');
    expect(files['README.md']).toContain('PostgreSQL');
    expect(files['README.md']).toContain('Prisma');
    expect(files['README.md']).toContain('docker compose up');
  });

  it('uses postgres_data volume name', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['docker-compose.yml']).toContain('postgres_data');
  });

  it('sanitizes special characters in db name and user', () => {
    const files = generateFullStackScaffold({
      ...opts,
      dbName: 'my-app db!',
      dbUser: 'user-name',
    });
    expect(files['docker-compose.yml']).toContain('my_app_db_');
    expect(files['docker-compose.yml']).toContain('user_name');
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

describe('generateFullStackScaffold with custom ports', () => {
  it('uses provided dbPort and guiPort in compose', () => {
    const files = generateFullStackScaffold({
      appName: 'Custom',
      description: 'test',
      dbName: 'db',
      dbUser: 'usr',
      dbPassword: 'pw',
      dbPort: 25432,
      guiPort: 25050,
    });
    expect(files['docker-compose.yml']).toContain("'25432:5432'");
    expect(files['docker-compose.yml']).toContain("'25050:80'");
    expect(files['backend/.env']).toContain('localhost:25432');
  });
});

