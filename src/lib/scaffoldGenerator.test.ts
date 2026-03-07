import { describe, it, expect } from 'vitest';
import { generateFullStackScaffold } from '../lib/scaffoldGenerator';

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

describe('generateFullStackScaffold', () => {
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
