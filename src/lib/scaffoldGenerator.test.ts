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
  };

  it('does not generate docker-compose.yml', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['docker-compose.yml']).toBeUndefined();
  });

  it('does not include PostgreSQL or pgAdmin', () => {
    const files = generateFullStackScaffold(opts);
    const allContent = Object.values(files).join('\n');
    expect(allContent).not.toContain('postgres:17');
    expect(allContent).not.toContain('dpage/pgadmin4');
    expect(allContent).not.toContain('PGADMIN_DEFAULT_EMAIL');
    expect(allContent).not.toContain('pg_isready');
  });

  it('generates Prisma schema with SQLite provider', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['backend/prisma/schema.prisma']).toContain('provider = "sqlite"');
    expect(files['backend/prisma/schema.prisma']).toContain('DATABASE_URL');
  });

  it('generates backend .env with SQLite DATABASE_URL', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['backend/.env']).toContain('DATABASE_URL="file:./dev.db"');
  });

  it('generates backend .env.example with SQLite DATABASE_URL', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['backend/.env.example']).toContain('DATABASE_URL="file:./dev.db"');
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

  it('generates README with SQLite stack info and Prisma Studio', () => {
    const files = generateFullStackScaffold(opts);
    expect(files['README.md']).toContain('React');
    expect(files['README.md']).toContain('Express');
    expect(files['README.md']).toContain('SQLite');
    expect(files['README.md']).toContain('Prisma');
    expect(files['README.md']).toContain('Prisma Studio');
    expect(files['README.md']).not.toContain('docker compose');
    expect(files['README.md']).not.toContain('PostgreSQL');
    expect(files['README.md']).not.toContain('pgAdmin');
  });

  it('uses custom guiPort in README', () => {
    const files = generateFullStackScaffold({ ...opts, guiPort: 25555 });
    expect(files['README.md']).toContain('25555');
  });
});

describe('allocatePorts', () => {
  it('returns a port in the valid range', () => {
    const [db, gui] = allocatePorts('test-app-123');
    expect(db).toBeGreaterThanOrEqual(10000);
    expect(db).toBeLessThan(60000);
    expect(gui).toBe(db);
  });

  it('returns different ports for different app IDs', () => {
    const [p1] = allocatePorts('app-alpha');
    const [p2] = allocatePorts('app-beta');
    expect(p1).not.toBe(p2);
  });

  it('is deterministic for the same app ID', () => {
    const a = allocatePorts('stable-id');
    const b = allocatePorts('stable-id');
    expect(a).toEqual(b);
  });
});

describe('generateFullStackScaffold with custom guiPort', () => {
  it('uses provided guiPort in README', () => {
    const files = generateFullStackScaffold({
      appName: 'Custom',
      description: 'test',
      guiPort: 25555,
    });
    expect(files['README.md']).toContain('25555');
    expect(files['backend/.env']).toContain('file:./dev.db');
  });
});

describe('generateFrontendScaffold — completeness', () => {
  const files = generateFrontendScaffold({ appName: 'Test', description: 'desc' });

  it('generates all 8 expected file keys', () => {
    const expected = [
      'package.json', 'tsconfig.json', 'tsconfig.node.json',
      'vite.config.ts', 'index.html', 'src/main.tsx', 'src/index.css', 'src/App.tsx',
    ];
    for (const key of expected) {
      expect(files[key], `missing ${key}`).toBeDefined();
    }
  });

  it('generates no extra files', () => {
    expect(Object.keys(files)).toHaveLength(8);
  });

  it('package.json type is module', () => {
    expect(JSON.parse(files['package.json']).type).toBe('module');
  });

  it('tsconfig has strict true', () => {
    expect(JSON.parse(files['tsconfig.json']).compilerOptions.strict).toBe(true);
  });

  it('tsconfig.node.json references vite.config.ts', () => {
    expect(JSON.parse(files['tsconfig.node.json']).include).toContain('vite.config.ts');
  });

  it('html has charset and viewport meta tags', () => {
    expect(files['index.html']).toContain('charset="UTF-8"');
    expect(files['index.html']).toContain('viewport');
  });

  it('CSS has box-sizing reset', () => {
    expect(files['src/index.css']).toContain('box-sizing: border-box');
  });

  it('App.tsx exports a default component', () => {
    expect(files['src/App.tsx']).toContain('export default function App');
  });

  it('main.tsx imports App and renders to root', () => {
    expect(files['src/main.tsx']).toContain("import App from './App'");
    expect(files['src/main.tsx']).toContain("getElementById('root')");
  });
});

describe('generateFrontendScaffold — name sanitisation edge cases', () => {
  it('removes special characters', () => {
    const pkg = JSON.parse(
      generateFrontendScaffold({ appName: 'Hello World! @#$', description: '' })['package.json'],
    );
    expect(pkg.name).toMatch(/^[a-z0-9._-]+$/);
    expect(pkg.name).not.toContain(' ');
  });

  it('collapses consecutive hyphens', () => {
    const pkg = JSON.parse(
      generateFrontendScaffold({ appName: 'a---b', description: '' })['package.json'],
    );
    expect(pkg.name).toBe('a-b');
  });

  it('trims leading and trailing hyphens', () => {
    const pkg = JSON.parse(
      generateFrontendScaffold({ appName: '-trimmed-', description: '' })['package.json'],
    );
    expect(pkg.name).not.toMatch(/^-|-$/);
  });

  it('lowercases uppercase names', () => {
    const pkg = JSON.parse(
      generateFrontendScaffold({ appName: 'MYAPP', description: '' })['package.json'],
    );
    expect(pkg.name).toBe('myapp');
  });

  it('preserves dots and underscores', () => {
    const pkg = JSON.parse(
      generateFrontendScaffold({ appName: 'my_app.v2', description: '' })['package.json'],
    );
    expect(pkg.name).toBe('my_app.v2');
  });
});

describe('generateFullStackScaffold — completeness', () => {
  const files = generateFullStackScaffold({ appName: 'FS', description: 'test' });

  it('contains all backend files', () => {
    expect(files['backend/package.json']).toBeDefined();
    expect(files['backend/tsconfig.json']).toBeDefined();
    expect(files['backend/.env']).toBeDefined();
    expect(files['backend/.env.example']).toBeDefined();
    expect(files['backend/prisma/schema.prisma']).toBeDefined();
    expect(files['backend/src/index.ts']).toBeDefined();
  });

  it('contains all frontend files', () => {
    expect(files['frontend/package.json']).toBeDefined();
    expect(files['frontend/tsconfig.json']).toBeDefined();
    expect(files['frontend/tsconfig.node.json']).toBeDefined();
    expect(files['frontend/vite.config.ts']).toBeDefined();
    expect(files['frontend/index.html']).toBeDefined();
    expect(files['frontend/src/main.tsx']).toBeDefined();
    expect(files['frontend/src/index.css']).toBeDefined();
    expect(files['frontend/src/App.tsx']).toBeDefined();
  });

  it('contains README.md', () => {
    expect(files['README.md']).toBeDefined();
  });

  it('backend package.json has all expected scripts', () => {
    const pkg = JSON.parse(files['backend/package.json']);
    for (const s of ['dev', 'build', 'start', 'db:generate', 'db:push', 'db:migrate', 'db:studio']) {
      expect(pkg.scripts[s], `missing script ${s}`).toBeDefined();
    }
  });

  it('backend uses commonjs module type', () => {
    const pkg = JSON.parse(files['backend/package.json']);
    expect(pkg.type).toBe('commonjs');
  });

  it('frontend uses ESModule type', () => {
    const pkg = JSON.parse(files['frontend/package.json']);
    expect(pkg.type).toBe('module');
  });

  it('backend .env and .env.example have matching content', () => {
    expect(files['backend/.env']).toBe(files['backend/.env.example']);
  });

  it('backend index.ts defines health endpoint', () => {
    expect(files['backend/src/index.ts']).toContain("'/health'");
  });

  it('backend index.ts defines items CRUD', () => {
    const src = files['backend/src/index.ts'];
    expect(src).toContain("'/api/items'");
    expect(src).toContain("'/api/items/:id'");
    expect(src).toContain('findMany');
    expect(src).toContain('create');
    expect(src).toContain('delete');
  });

  it('frontend vite.config.ts proxies /api and /health', () => {
    const cfg = files['frontend/vite.config.ts'];
    expect(cfg).toContain("'/api'");
    expect(cfg).toContain("'/health'");
  });

  it('frontend tsconfig has react-jsx', () => {
    const ts = JSON.parse(files['frontend/tsconfig.json']);
    expect(ts.compilerOptions.jsx).toBe('react-jsx');
  });

  it('frontend App.tsx fetches items from API', () => {
    expect(files['frontend/src/App.tsx']).toContain('/api');
    expect(files['frontend/src/App.tsx']).toContain('fetchItems');
  });

  it('README mentions backend and frontend setup steps', () => {
    const readme = files['README.md'];
    expect(readme).toContain('cd backend');
    expect(readme).toContain('cd frontend');
    expect(readme).toContain('npm install');
    expect(readme).toContain('npm run dev');
  });

  it('README displays correct stack table', () => {
    const readme = files['README.md'];
    expect(readme).toContain('Express');
    expect(readme).toContain('SQLite');
    expect(readme).toContain('Prisma');
    expect(readme).toContain('React');
    expect(readme).toContain('Vite');
  });

  it('defaults guiPort to 5555 in README', () => {
    expect(files['README.md']).toContain('5555');
  });

  it('backend prisma schema has Item model', () => {
    const schema = files['backend/prisma/schema.prisma'];
    expect(schema).toContain('model Item');
    expect(schema).toContain('@id');
    expect(schema).toContain('@default(autoincrement())');
  });

  it('backend uses PORT 3001', () => {
    expect(files['backend/.env']).toContain('PORT=3001');
    expect(files['backend/src/index.ts']).toContain('3001');
  });

  it('frontend index.html title matches appName', () => {
    expect(files['frontend/index.html']).toContain('<title>FS</title>');
  });

  it('backend CORS allows frontend origin', () => {
    expect(files['backend/src/index.ts']).toContain('localhost:5173');
  });
});

describe('generateFullStackScaffold — name in outputs', () => {
  it('embeds appName in frontend App component', () => {
    const files = generateFullStackScaffold({ appName: 'Notes', description: 'note taking' });
    expect(files['frontend/src/App.tsx']).toContain('Notes');
  });

  it('embeds description in README', () => {
    const files = generateFullStackScaffold({ appName: 'X', description: 'some desc' });
    expect(files['README.md']).toContain('some desc');
  });

  it('embeds appName in backend package name', () => {
    const files = generateFullStackScaffold({ appName: 'My App', description: '' });
    const pkg = JSON.parse(files['backend/package.json']);
    expect(pkg.name).toContain('my-app');
  });

  it('embeds appName in frontend package name', () => {
    const files = generateFullStackScaffold({ appName: 'My App', description: '' });
    const pkg = JSON.parse(files['frontend/package.json']);
    expect(pkg.name).toContain('my-app');
  });
});

describe('allocatePorts — edge cases', () => {
  it('produces valid port for empty string', () => {
    const [port] = allocatePorts('');
    expect(port).toBeGreaterThanOrEqual(10000);
    expect(port).toBeLessThan(60000);
  });

  it('produces valid port for single character', () => {
    const [port] = allocatePorts('a');
    expect(port).toBeGreaterThanOrEqual(10000);
    expect(port).toBeLessThan(60000);
  });

  it('both tuple elements are always equal', () => {
    for (const id of ['foo', 'bar', '123', '', 'very-long-app-id-string-here']) {
      const [a, b] = allocatePorts(id);
      expect(a).toBe(b);
    }
  });

  it('stays in range for 100 random-ish IDs', () => {
    for (let i = 0; i < 100; i++) {
      const [p] = allocatePorts(`app-${i}-${String.fromCharCode(65 + (i % 26))}`);
      expect(p).toBeGreaterThanOrEqual(10000);
      expect(p).toBeLessThan(60000);
    }
  });

  it('has low collision rate across many IDs', () => {
    const ports = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const [p] = allocatePorts(`unique-app-${i}`);
      ports.add(p);
    }
    // At least 30 distinct ports out of 50 (allows some hash collisions)
    expect(ports.size).toBeGreaterThan(30);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NEW TESTS — appended after original 170 lines
// ═══════════════════════════════════════════════════════════════════════════

describe('Frontend scaffold file completeness', () => {
  const files = generateFrontendScaffold({ appName: 'CompleteApp', description: 'check all keys' });

  const expectedKeys = [
    'package.json',
    'tsconfig.json',
    'tsconfig.node.json',
    'vite.config.ts',
    'index.html',
    'src/main.tsx',
    'src/index.css',
    'src/App.tsx',
  ];

  it('contains exactly 8 file keys', () => {
    expect(Object.keys(files)).toHaveLength(8);
  });

  it.each(expectedKeys)('contains key "%s"', (key) => {
    expect(files[key]).toBeDefined();
    expect(typeof files[key]).toBe('string');
    expect(files[key].length).toBeGreaterThan(0);
  });

  it('does not contain unexpected keys', () => {
    for (const key of Object.keys(files)) {
      expect(expectedKeys).toContain(key);
    }
  });
});

describe('Frontend scaffold special chars in name', () => {
  it('sanitizes "Hello World! @#$" to a valid npm name', () => {
    const files = generateFrontendScaffold({ appName: 'Hello World! @#$', description: '' });
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.name).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
    expect(pkg.name).not.toContain(' ');
    expect(pkg.name).not.toContain('!');
    expect(pkg.name).not.toContain('@');
    expect(pkg.name).not.toContain('#');
    expect(pkg.name).not.toContain('$');
  });

  it('sanitizes names with consecutive special characters', () => {
    const files = generateFrontendScaffold({ appName: 'a!!!b', description: '' });
    const pkg = JSON.parse(files['package.json']);
    // multiple consecutive invalid chars should collapse to a single hyphen
    expect(pkg.name).not.toContain('--');
  });

  it('sanitizes names with leading/trailing special chars', () => {
    const files = generateFrontendScaffold({ appName: '---Test---', description: '' });
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.name).not.toMatch(/^-/);
    expect(pkg.name).not.toMatch(/-$/);
  });

  it('handles all-uppercase names', () => {
    const files = generateFrontendScaffold({ appName: 'MY APP', description: '' });
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.name).toBe('my-app');
  });

  it('handles single character name', () => {
    const files = generateFrontendScaffold({ appName: 'a', description: '' });
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.name).toBe('a');
  });
});

describe('Frontend scaffold package.json type is module', () => {
  it('has type "module"', () => {
    const files = generateFrontendScaffold({ appName: 'ModApp', description: '' });
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.type).toBe('module');
  });

  it('has version field', () => {
    const files = generateFrontendScaffold({ appName: 'ModApp', description: '' });
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.version).toBeDefined();
    expect(typeof pkg.version).toBe('string');
  });
});

describe('Frontend scaffold tsconfig has strict:true', () => {
  it('enables strict mode', () => {
    const files = generateFrontendScaffold({ appName: 'StrictApp', description: '' });
    const tsconfig = JSON.parse(files['tsconfig.json']);
    expect(tsconfig.compilerOptions.strict).toBe(true);
  });

  it('uses react-jsx for JSX', () => {
    const files = generateFrontendScaffold({ appName: 'StrictApp', description: '' });
    const tsconfig = JSON.parse(files['tsconfig.json']);
    expect(tsconfig.compilerOptions.jsx).toBe('react-jsx');
  });

  it('includes src directory', () => {
    const files = generateFrontendScaffold({ appName: 'StrictApp', description: '' });
    const tsconfig = JSON.parse(files['tsconfig.json']);
    expect(tsconfig.include).toContain('src');
  });

  it('has references to tsconfig.node.json', () => {
    const files = generateFrontendScaffold({ appName: 'StrictApp', description: '' });
    const tsconfig = JSON.parse(files['tsconfig.json']);
    expect(tsconfig.references).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: './tsconfig.node.json' })]),
    );
  });
});

describe('Frontend scaffold html has correct meta tags', () => {
  const files = generateFrontendScaffold({ appName: 'MetaApp', description: '' });
  const html = files['index.html'];

  it('has charset UTF-8 meta', () => {
    expect(html).toContain('charset="UTF-8"');
  });

  it('has viewport meta', () => {
    expect(html).toContain('name="viewport"');
    expect(html).toContain('width=device-width');
    expect(html).toContain('initial-scale=1.0');
  });

  it('has doctype html', () => {
    expect(html).toMatch(/<!doctype html>/i);
  });

  it('has lang="en"', () => {
    expect(html).toContain('lang="en"');
  });

  it('has div#root', () => {
    expect(html).toContain('id="root"');
  });

  it('has module script tag pointing to src/main.tsx', () => {
    expect(html).toContain('type="module"');
    expect(html).toContain('src="/src/main.tsx"');
  });
});

describe('Frontend scaffold CSS has box-sizing reset', () => {
  const files = generateFrontendScaffold({ appName: 'CSSApp', description: '' });
  const css = files['src/index.css'];

  it('sets box-sizing: border-box on universal selector', () => {
    expect(css).toContain('box-sizing: border-box');
  });

  it('resets margin to 0', () => {
    expect(css).toContain('margin: 0');
  });

  it('resets padding to 0', () => {
    expect(css).toContain('padding: 0');
  });

  it('covers ::before and ::after pseudo-elements', () => {
    expect(css).toContain('*::before');
    expect(css).toContain('*::after');
  });

  it('sets a body font-family', () => {
    expect(css).toContain('font-family');
  });

  it('sets min-height: 100vh on body', () => {
    expect(css).toContain('min-height: 100vh');
  });
});

describe('Frontend scaffold App.tsx is a valid component export', () => {
  const files = generateFrontendScaffold({ appName: 'CompApp', description: 'valid component' });
  const app = files['src/App.tsx'];

  it('has a default export function', () => {
    expect(app).toContain('export default function App()');
  });

  it('returns JSX', () => {
    expect(app).toContain('<div');
    expect(app).toContain('</div>');
  });

  it('includes app name in rendered output', () => {
    expect(app).toContain('CompApp');
  });

  it('includes description in rendered output', () => {
    expect(app).toContain('valid component');
  });
});

describe('Full-stack scaffold file completeness', () => {
  const files = generateFullStackScaffold({ appName: 'FullApp', description: 'complete' });
  const keys = Object.keys(files);

  const expectedBackendKeys = [
    'backend/package.json',
    'backend/tsconfig.json',
    'backend/.env',
    'backend/.env.example',
    'backend/prisma/schema.prisma',
    'backend/src/index.ts',
  ];

  const expectedFrontendKeys = [
    'frontend/package.json',
    'frontend/tsconfig.json',
    'frontend/tsconfig.node.json',
    'frontend/vite.config.ts',
    'frontend/index.html',
    'frontend/src/main.tsx',
    'frontend/src/index.css',
    'frontend/src/App.tsx',
  ];

  it.each(expectedBackendKeys)('contains backend key "%s"', (key) => {
    expect(keys).toContain(key);
    expect(files[key].length).toBeGreaterThan(0);
  });

  it.each(expectedFrontendKeys)('contains frontend key "%s"', (key) => {
    expect(keys).toContain(key);
    expect(files[key].length).toBeGreaterThan(0);
  });

  it('contains README.md', () => {
    expect(keys).toContain('README.md');
    expect(files['README.md'].length).toBeGreaterThan(0);
  });

  it('has all expected keys and no extras', () => {
    const allExpected = [...expectedBackendKeys, ...expectedFrontendKeys, 'README.md'];
    expect(keys.sort()).toEqual(allExpected.sort());
  });
});

describe('Full-stack backend package.json has correct scripts', () => {
  const files = generateFullStackScaffold({ appName: 'ScriptsApp', description: '' });
  const pkg = JSON.parse(files['backend/package.json']);

  const requiredScripts = ['dev', 'build', 'start', 'db:generate', 'db:push', 'db:migrate', 'db:studio'];

  it.each(requiredScripts)('has script "%s"', (script) => {
    expect(pkg.scripts[script]).toBeDefined();
    expect(typeof pkg.scripts[script]).toBe('string');
    expect(pkg.scripts[script].length).toBeGreaterThan(0);
  });

  it('dev script uses ts-node-dev', () => {
    expect(pkg.scripts.dev).toContain('ts-node-dev');
  });

  it('db:studio script uses prisma studio', () => {
    expect(pkg.scripts['db:studio']).toContain('prisma studio');
  });

  it('db:migrate uses prisma migrate dev', () => {
    expect(pkg.scripts['db:migrate']).toContain('prisma migrate dev');
  });
});

describe('Full-stack backend .env and .env.example match', () => {
  const files = generateFullStackScaffold({ appName: 'EnvApp', description: '' });
  const env = files['backend/.env'];
  const envExample = files['backend/.env.example'];

  it('.env and .env.example have identical content', () => {
    expect(env).toBe(envExample);
  });

  it('both contain DATABASE_URL', () => {
    expect(env).toContain('DATABASE_URL=');
    expect(envExample).toContain('DATABASE_URL=');
  });

  it('both contain PORT', () => {
    expect(env).toContain('PORT=');
    expect(envExample).toContain('PORT=');
  });

  it('DATABASE_URL points to SQLite file', () => {
    expect(env).toContain('file:./dev.db');
  });
});

describe('Full-stack backend index.ts has health endpoint', () => {
  const files = generateFullStackScaffold({ appName: 'HealthApp', description: '' });
  const index = files['backend/src/index.ts'];

  it('defines GET /health route', () => {
    expect(index).toContain("'/health'");
    expect(index).toContain('app.get');
  });

  it('returns status ok', () => {
    expect(index).toContain("status: 'ok'");
  });

  it('returns a timestamp', () => {
    expect(index).toContain('timestamp');
    expect(index).toContain('toISOString');
  });
});

describe('Full-stack backend index.ts has items CRUD endpoints', () => {
  const files = generateFullStackScaffold({ appName: 'CrudApp', description: '' });
  const index = files['backend/src/index.ts'];

  it('has GET /api/items', () => {
    expect(index).toContain("'/api/items'");
    expect(index).toContain('findMany');
  });

  it('has POST /api/items', () => {
    expect(index).toContain('app.post');
    expect(index).toContain('create');
  });

  it('has DELETE /api/items/:id', () => {
    expect(index).toContain("'/api/items/:id'");
    expect(index).toContain('app.delete');
  });

  it('uses PrismaClient', () => {
    expect(index).toContain('PrismaClient');
    expect(index).toContain('new PrismaClient');
  });

  it('uses express.json() middleware', () => {
    expect(index).toContain('express.json()');
  });

  it('uses cors middleware', () => {
    expect(index).toContain('cors');
  });
});

describe('Full-stack frontend has API proxy config in vite.config.ts', () => {
  const files = generateFullStackScaffold({ appName: 'ProxyApp', description: '' });
  const vite = files['frontend/vite.config.ts'];

  it('has proxy configuration', () => {
    expect(vite).toContain('proxy');
  });

  it('proxies /api to backend', () => {
    expect(vite).toContain("'/api'");
    expect(vite).toContain('http://localhost:3001');
  });

  it('proxies /health to backend', () => {
    expect(vite).toContain("'/health'");
  });

  it('enables changeOrigin', () => {
    expect(vite).toContain('changeOrigin: true');
  });

  it('supports VITE_BACKEND_URL override', () => {
    expect(vite).toContain('process.env.VITE_BACKEND_URL');
  });
});

describe('Full-stack frontend tsconfig has react-jsx', () => {
  const files = generateFullStackScaffold({ appName: 'JsxApp', description: '' });
  const tsconfig = JSON.parse(files['frontend/tsconfig.json']);

  it('has jsx set to react-jsx', () => {
    expect(tsconfig.compilerOptions.jsx).toBe('react-jsx');
  });

  it('has strict mode enabled', () => {
    expect(tsconfig.compilerOptions.strict).toBe(true);
  });

  it('targets ES2020', () => {
    expect(tsconfig.compilerOptions.target).toBe('ES2020');
  });

  it('uses bundler module resolution', () => {
    expect(tsconfig.compilerOptions.moduleResolution).toBe('bundler');
  });

  it('includes DOM lib', () => {
    expect(tsconfig.compilerOptions.lib).toContain('DOM');
  });
});

describe('Full-stack README mentions all setup steps', () => {
  const files = generateFullStackScaffold({ appName: 'ReadmeApp', description: 'A readme test' });
  const readme = files['README.md'];

  it('mentions npm install for backend', () => {
    expect(readme).toContain('npm install');
    expect(readme).toContain('cd backend');
  });

  it('mentions npm install for frontend', () => {
    expect(readme).toContain('cd frontend');
  });

  it('mentions prisma db push', () => {
    expect(readme).toContain('prisma db push');
  });

  it('mentions prisma generate', () => {
    expect(readme).toContain('prisma generate');
  });

  it('mentions npm run dev', () => {
    expect(readme).toContain('npm run dev');
  });

  it('mentions Prisma Studio', () => {
    expect(readme).toContain('Prisma Studio');
    expect(readme).toContain('prisma studio');
  });

  it('contains the app name as heading', () => {
    expect(readme).toContain('# ReadmeApp');
  });

  it('contains the description', () => {
    expect(readme).toContain('A readme test');
  });

  it('mentions backend port 3001', () => {
    expect(readme).toContain('3001');
  });

  it('mentions frontend port 5173', () => {
    expect(readme).toContain('5173');
  });
});

describe('Full-stack README uses provided guiPort', () => {
  it('uses the custom guiPort in Prisma Studio instructions', () => {
    const files = generateFullStackScaffold({ appName: 'PortApp', description: '', guiPort: 42000 });
    const readme = files['README.md'];
    expect(readme).toContain('42000');
    expect(readme).toContain('--port 42000');
  });

  it('uses default port 5555 when guiPort not specified', () => {
    const files = generateFullStackScaffold({ appName: 'DefaultPort', description: '' });
    const readme = files['README.md'];
    expect(readme).toContain('5555');
  });

  it('uses a different custom guiPort correctly', () => {
    const files = generateFullStackScaffold({ appName: 'OtherPort', description: '', guiPort: 19999 });
    const readme = files['README.md'];
    expect(readme).toContain('19999');
    expect(readme).not.toContain('5555');
  });
});

describe('Full-stack backend uses commonjs', () => {
  const files = generateFullStackScaffold({ appName: 'CjsApp', description: '' });

  it('backend package.json type is commonjs', () => {
    const pkg = JSON.parse(files['backend/package.json']);
    expect(pkg.type).toBe('commonjs');
  });

  it('backend tsconfig module is commonjs', () => {
    const tsconfig = JSON.parse(files['backend/tsconfig.json']);
    expect(tsconfig.compilerOptions.module).toBe('commonjs');
  });

  it('backend tsconfig has esModuleInterop', () => {
    const tsconfig = JSON.parse(files['backend/tsconfig.json']);
    expect(tsconfig.compilerOptions.esModuleInterop).toBe(true);
  });
});

describe('Full-stack frontend uses ESModule', () => {
  const files = generateFullStackScaffold({ appName: 'EsmApp', description: '' });

  it('frontend package.json type is module', () => {
    const pkg = JSON.parse(files['frontend/package.json']);
    expect(pkg.type).toBe('module');
  });

  it('frontend tsconfig module is ESNext', () => {
    const tsconfig = JSON.parse(files['frontend/tsconfig.json']);
    expect(tsconfig.compilerOptions.module).toBe('ESNext');
  });

  it('frontend vite.config.ts uses ESModule import syntax', () => {
    const vite = files['frontend/vite.config.ts'];
    expect(vite).toContain("import { defineConfig } from 'vite'");
    expect(vite).toContain("import react from '@vitejs/plugin-react'");
  });

  it('frontend main.tsx uses ESModule import syntax', () => {
    const main = files['frontend/src/main.tsx'];
    expect(main).toContain("import React from 'react'");
    expect(main).toContain("import ReactDOM from 'react-dom/client'");
  });
});

describe('allocatePorts for empty string', () => {
  it('returns a valid port pair for empty string', () => {
    const [p1, p2] = allocatePorts('');
    expect(typeof p1).toBe('number');
    expect(typeof p2).toBe('number');
    expect(p1).toBe(p2);
  });

  it('port is within range 10000–59999 for empty string', () => {
    const [port] = allocatePorts('');
    expect(port).toBeGreaterThanOrEqual(10000);
    expect(port).toBeLessThan(60000);
  });

  it('is deterministic for empty string', () => {
    const a = allocatePorts('');
    const b = allocatePorts('');
    expect(a).toEqual(b);
  });
});

describe('allocatePorts range validation (fuzz test)', () => {
  const testIds = [
    'a', 'b', 'c', 'test', 'hello', 'world', 'foo-bar', 'baz_qux',
    '1234', 'app-001', 'app-002', 'app-003',
    'very-long-app-name-that-goes-on-and-on-and-on-forever',
    'UPPERCASE', 'MiXeD-CaSe', '__underscores__',
    '日本語', '🎉🎊🎈', 'special!@#$%^&*()', 'spaces in name',
    'tab\there', 'newline\nhere', 'null\0byte',
    '.dotfile', '-leading-dash', 'trailing-dash-',
    'a'.repeat(100), 'z'.repeat(500),
    '0', '00000', String.fromCharCode(0), String.fromCharCode(65535),
    'port-test-alpha', 'port-test-beta', 'port-test-gamma',
    'uuid-like-4a3b2c1d', 'hash-like-abc123def456',
  ];

  it.each(testIds)('returns ports in valid range for id "%s"', (id) => {
    const [p1, p2] = allocatePorts(id);
    expect(p1).toBeGreaterThanOrEqual(10000);
    expect(p1).toBeLessThan(60000);
    expect(p2).toBeGreaterThanOrEqual(10000);
    expect(p2).toBeLessThan(60000);
    expect(p1).toBe(p2);
  });

  it('all ports are integers', () => {
    for (const id of testIds) {
      const [p1, p2] = allocatePorts(id);
      expect(Number.isInteger(p1)).toBe(true);
      expect(Number.isInteger(p2)).toBe(true);
    }
  });

  it('produces at least 5 distinct ports across all test IDs', () => {
    const uniquePorts = new Set(testIds.map((id) => allocatePorts(id)[0]));
    expect(uniquePorts.size).toBeGreaterThanOrEqual(5);
  });

  it('is deterministic for every test ID', () => {
    for (const id of testIds) {
      const a = allocatePorts(id);
      const b = allocatePorts(id);
      expect(a).toEqual(b);
    }
  });
});

