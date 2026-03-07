import { describe, it, expect } from 'vitest';
import { generateFrontendScaffold, generateFullStackScaffold } from '../lib/scaffoldGenerator';

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

  it('generates vite.config.ts pointing at port 5173', () => {
    const files = generateFrontendScaffold(opts);
    expect(files['vite.config.ts']).toContain('5173');
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
    dbPassword: 'Rand0mP@ss!XYZ',
    dbRootPassword: 'RootR@nd0m!123',
  };

  it('generates docker-compose.yml with MySQL', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['docker-compose.yml']).toContain('mysql:8.0');
    expect(files['docker-compose.yml']).toContain('myapp_db');
    expect(files['docker-compose.yml']).toContain('myapp_user');
    expect(files['docker-compose.yml']).toContain('Rand0mP@ss!XYZ');
    expect(files['docker-compose.yml']).toContain("'3306:3306'");
  });

  it('does not expose password in healthcheck command args', () => {
    const files = generateFullStackScaffold(opts);
    // Password must NOT appear as a -p flag in healthcheck
    expect(files['docker-compose.yml']).not.toContain('-pRand0mP@ss!XYZ');
    // Uses MYSQL_PWD env var approach instead
    expect(files['docker-compose.yml']).toContain('MYSQL_PWD');
  });

  it('uses provided root password in docker-compose', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['docker-compose.yml']).toContain('RootR@nd0m!123');
  });

  it('generates backend package.json with Express and Prisma', () => {
    const files = generateFullStackScaffold(opts);
    const pkg = JSON.parse(files['backend/package.json']);
    expect(pkg.dependencies.express).toBeDefined();
    expect(pkg.dependencies['@prisma/client']).toBeDefined();
    expect(pkg.dependencies.cors).toBeDefined();
    expect(pkg.devDependencies.prisma).toBeDefined();
  });

  it('generates Prisma schema with MySQL provider', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['backend/prisma/schema.prisma']).toContain('provider = "mysql"');
    expect(files['backend/prisma/schema.prisma']).toContain('DATABASE_URL');
  });

  it('generates backend .env with correct DATABASE_URL', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['backend/.env']).toContain(
      'mysql://myapp_user:Rand0mP@ss!XYZ@localhost:3306/myapp_db',
    );
  });

  it('generates frontend with React + Vite', () => {
    const files = generateFullStackScaffold(opts);
    const pkg = JSON.parse(files['frontend/package.json']);
    expect(pkg.dependencies.react).toBeDefined();
    expect(pkg.devDependencies['@vitejs/plugin-react']).toBeDefined();
    expect(files['frontend/vite.config.ts']).toContain("target: 'http://localhost:3001'");
  });

  it('generates frontend app entry point', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['frontend/src/main.tsx']).toContain('ReactDOM.createRoot');
    expect(files['frontend/src/App.tsx']).toContain('My App');
  });

  it('generates README with stack info', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['README.md']).toContain('React');
    expect(files['README.md']).toContain('Express');
    expect(files['README.md']).toContain('MySQL');
    expect(files['README.md']).toContain('Prisma');
    expect(files['README.md']).toContain('docker compose up');
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

describe('generateFullStackScaffold (MySQL — simple password)', () => {
  const opts = {
    appName: 'My App',
    description: 'Test app',
    dbName: 'myapp_db',
    dbUser: 'myapp_user',
    dbPassword: 'secret123',
  };

  it('generates docker-compose.yml with MySQL', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['docker-compose.yml']).toContain('mysql:8.0');
    expect(files['docker-compose.yml']).toContain('myapp_db');
    expect(files['docker-compose.yml']).toContain('myapp_user');
    expect(files['docker-compose.yml']).toContain('secret123');
    expect(files['docker-compose.yml']).toContain("'3306:3306'");
  });

  it('generates backend package.json with Express and Prisma', () => {
    const files = generateFullStackScaffold(opts);
    const pkg = JSON.parse(files['backend/package.json']);
    expect(pkg.dependencies.express).toBeDefined();
    expect(pkg.dependencies['@prisma/client']).toBeDefined();
    expect(pkg.dependencies.cors).toBeDefined();
    expect(pkg.devDependencies.prisma).toBeDefined();
  });

  it('generates Prisma schema with MySQL provider', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['backend/prisma/schema.prisma']).toContain('provider = "mysql"');
    expect(files['backend/prisma/schema.prisma']).toContain('DATABASE_URL');
  });

  it('generates backend .env with correct DATABASE_URL', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['backend/.env']).toContain('mysql://myapp_user:secret123@localhost:3306/myapp_db');
  });

  it('generates frontend with React + Vite', () => {
    const files = generateFullStackScaffold(opts);
    const pkg = JSON.parse(files['frontend/package.json']);
    expect(pkg.dependencies.react).toBeDefined();
    expect(pkg.devDependencies['@vitejs/plugin-react']).toBeDefined();
    expect(files['frontend/vite.config.ts']).toContain("target: 'http://localhost:3001'");
  });

  it('generates frontend app entry point', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['frontend/src/main.tsx']).toContain('ReactDOM.createRoot');
    expect(files['frontend/src/App.tsx']).toContain('My App');
  });

  it('generates README with stack info', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['README.md']).toContain('React');
    expect(files['README.md']).toContain('Express');
    expect(files['README.md']).toContain('MySQL');
    expect(files['README.md']).toContain('Prisma');
    expect(files['README.md']).toContain('docker compose up');
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

describe('generateFullStackScaffold (PostgreSQL)', () => {
  const opts = {
    appName: 'My PG App',
    description: 'Test pg app',
    dbName: 'mypgapp_db',
    dbUser: 'mypgapp_user',
    dbPassword: 'PgP@ss!456',
    dbProvider: 'postgresql' as const,
  };

  it('generates docker-compose.yml with PostgreSQL', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['docker-compose.yml']).toContain('postgres:16');
    expect(files['docker-compose.yml']).toContain('mypgapp_db');
    expect(files['docker-compose.yml']).toContain('mypgapp_user');
    expect(files['docker-compose.yml']).toContain('PgP@ss!456');
    expect(files['docker-compose.yml']).toContain("'5432:5432'");
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
      'postgresql://mypgapp_user:PgP@ss!456@localhost:5432/mypgapp_db',
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
    expect(files['frontend/vite.config.ts']).toContain("target: 'http://localhost:3001'");
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

  it('defaults to MySQL when dbProvider is omitted', () => {
    const defaultOpts = {
      appName: opts.appName,
      description: opts.description,
      dbName: opts.dbName,
      dbUser: opts.dbUser,
      dbPassword: opts.dbPassword,
    };
    const files = generateFullStackScaffold(defaultOpts);
    expect(files['docker-compose.yml']).toContain('mysql:8.0');
    expect(files['backend/prisma/schema.prisma']).toContain('provider = "mysql"');
    expect(files['backend/.env']).toContain('mysql://');
  });
});

