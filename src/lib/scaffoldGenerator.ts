/**
 * Scaffold generators for Dyad.
 *
 * generateFrontendScaffold — a minimal runnable React + Vite + TypeScript project
 *   for frontend-only apps (enables in-app preview via `npm run dev`).
 *
 * generateFullStackScaffold — a project with:
 *   - React + Vite  (frontend, port 5173)
 *   - Express       (backend API, port 3001)
 *   - SQLite        (via Prisma ORM, no Docker required)
 *   - Prisma ORM    (schema + client)
 *   - README with startup instructions
 */

export interface FrontendScaffoldOptions {
  appName: string;
  description: string;
}

/**
 * Generates a minimal but complete React + Vite + TypeScript project.
 * The AI subsequently overwrites files as the user chats, so the scaffold
 * only needs to be runnable — not feature-complete.
 */
export function generateFrontendScaffold(opts: FrontendScaffoldOptions): Record<string, string> {
  const { appName, description } = opts;

  return {
    'package.json': JSON.stringify(
      {
        name: appName.toLowerCase().replace(/[^a-z0-9-_.]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''),
        version: '0.0.1',
        description,
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'tsc && vite build',
          preview: 'vite preview',
        },
        dependencies: {
          react: '^18.3.1',
          'react-dom': '^18.3.1',
        },
        devDependencies: {
          '@vitejs/plugin-react': '^4.3.1',
          '@types/react': '^18.3.11',
          '@types/react-dom': '^18.3.1',
          typescript: '^5.4.5',
          vite: '^5.4.0',
        },
      },
      null,
      2,
    ),

    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          useDefineForClassFields: true,
          lib: ['ES2020', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'bundler',
          allowImportingTsExtensions: true,
          resolveJsonModule: true,
          isolatedModules: true,
          noEmit: true,
          jsx: 'react-jsx',
          strict: true,
        },
        include: ['src'],
        references: [{ path: './tsconfig.node.json' }],
      },
      null,
      2,
    ),

    'tsconfig.node.json': JSON.stringify(
      {
        compilerOptions: {
          composite: true,
          skipLibCheck: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          allowSyntheticDefaultImports: true,
        },
        include: ['vite.config.ts'],
      },
      null,
      2,
    ),

    'vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`,

    'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${appName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,

    'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`,

    'src/index.css': `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #0f172a;
  color: #e2e8f0;
  min-height: 100vh;
}

h1 { font-size: 2rem; font-weight: 700; margin-bottom: 1rem; }
h2 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.75rem; }

button {
  cursor: pointer;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  transition: background 0.15s;
}

input {
  padding: 0.5rem 0.75rem;
  border: 1px solid #334155;
  border-radius: 0.375rem;
  background: #1e293b;
  color: #e2e8f0;
  font-size: 0.875rem;
  outline: none;
  width: 100%;
}

input:focus { border-color: #6366f1; }
`,

    'src/App.tsx': `export default function App() {
  return (
    <div style={{ maxWidth: 640, margin: '4rem auto', padding: '0 1rem', textAlign: 'center' }}>
      <h1>✨ ${appName}</h1>
      <p style={{ color: '#94a3b8', marginTop: '0.5rem' }}>${description}</p>
      <p style={{ color: '#64748b', marginTop: '2rem', fontSize: '0.875rem' }}>
        Chat with the AI to build your app →
      </p>
    </div>
  );
}
`,
  };
}

export type DbProvider = 'sqlite';

export interface ScaffoldOptions {
  appName: string;
  description: string;
  /** Host port for Prisma Studio (the DB viewer GUI). Auto-assigned if omitted. */
  guiPort?: number;
}

/**
 * Derive a unique, deterministic host port from an app ID so that
 * multiple fullstack apps can run their Prisma Studio side-by-side without conflicts.
 *
 * Returns [guiPort, guiPort] — both elements are the same port, kept as a
 * two-element tuple for backward compatibility with callers that destructure
 * two values.
 */
export function allocatePorts(appId: string): [number, number] {
  let h = 0;
  for (let i = 0; i < appId.length; i++) {
    h = ((h << 5) - h + appId.charCodeAt(i)) | 0;
  }
  const guiPort = ((h >>> 0) % 50000) + 10000; // 10000–59999
  return [guiPort, guiPort];
}


export function generateFullStackScaffold(opts: ScaffoldOptions): Record<string, string> {
  const { appName, description } = opts;
  const hostGuiPort = opts.guiPort ?? 5555;

  const prismaProvider = 'sqlite';
  const dbLabel = 'SQLite';

  return {
    // ── Backend: Express + Prisma ───────────────────────────────────────
    'backend/package.json': JSON.stringify(
      {
        name: `${appName.toLowerCase().replace(/\s+/g, '-')}-backend`,
        version: '1.0.0',
        description: `${description} — backend`,
        type: 'commonjs',
        scripts: {
          dev: 'ts-node-dev --respawn src/index.ts',
          build: 'tsc',
          start: 'node dist/index.js',
          'db:generate': 'prisma generate',
          'db:push': 'prisma db push',
          'db:migrate': 'prisma migrate dev',
          'db:studio': 'prisma studio',
        },
        dependencies: {
          express: '^4.18.3',
          cors: '^2.8.5',
          '@prisma/client': '^5.14.0',
          dotenv: '^16.4.5',
        },
        devDependencies: {
          prisma: '^5.14.0',
          typescript: '^5.4.5',
          'ts-node-dev': '^2.0.0',
          '@types/express': '^4.17.21',
          '@types/cors': '^2.8.17',
          '@types/node': '^20.14.0',
        },
      },
      null,
      2,
    ),

    'backend/tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          lib: ['ES2020'],
          outDir: './dist',
          rootDir: './src',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          resolveJsonModule: true,
        },
        include: ['src/**/*'],
        exclude: ['node_modules', 'dist'],
      },
      null,
      2,
    ),

    'backend/.env': `DATABASE_URL="file:./dev.db"
PORT=3001
`,

    'backend/.env.example': `DATABASE_URL="file:./dev.db"
PORT=3001
`,

    'backend/prisma/schema.prisma': `// Prisma schema — edit this file to add your models
// Docs: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "${prismaProvider}"
  url      = env("DATABASE_URL")
}

// ─── Example model — replace with your own ───────────────────────────────
model Item {
  id        Int      @id @default(autoincrement())
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
`,

    'backend/src/index.ts': `import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json());

// ─── Health check ─────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Items CRUD (example — replace with your own routes) ──────────────────
app.get('/api/items', async (_req, res) => {
  try {
    const items = await prisma.item.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

app.post('/api/items', async (req, res) => {
  const { name } = req.body as { name: string };
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const item = await prisma.item.create({ data: { name } });
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create item' });
  }
});

app.delete('/api/items/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await prisma.item.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    res.status(404).json({ error: 'Item not found' });
  }
});

app.listen(PORT, () => {
  console.log(\`Backend running at http://localhost:\${PORT}\`);
});
`,

    // ── Frontend: React + Vite ──────────────────────────────────────────
    'frontend/package.json': JSON.stringify(
      {
        name: `${appName.toLowerCase().replace(/\s+/g, '-')}-frontend`,
        version: '1.0.0',
        description: `${description} — frontend`,
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'tsc && vite build',
          preview: 'vite preview',
        },
        dependencies: {
          react: '^18.3.1',
          'react-dom': '^18.3.1',
        },
        devDependencies: {
          '@vitejs/plugin-react': '^4.3.1',
          '@types/react': '^18.3.11',
          '@types/react-dom': '^18.3.1',
          typescript: '^5.4.5',
          vite: '^5.4.0',
        },
      },
      null,
      2,
    ),

    'frontend/tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          useDefineForClassFields: true,
          lib: ['ES2020', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'bundler',
          allowImportingTsExtensions: true,
          resolveJsonModule: true,
          isolatedModules: true,
          noEmit: true,
          jsx: 'react-jsx',
          strict: true,
        },
        include: ['src'],
        references: [{ path: './tsconfig.node.json' }],
      },
      null,
      2,
    ),

    'frontend/tsconfig.node.json': JSON.stringify(
      {
        compilerOptions: {
          composite: true,
          skipLibCheck: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          allowSyntheticDefaultImports: true,
        },
        include: ['vite.config.ts'],
      },
      null,
      2,
    ),

    'frontend/vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'http://localhost:3001',
        changeOrigin: true,
      },
      '/health': {
        target: process.env.VITE_BACKEND_URL || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
`,

    'frontend/index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${appName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,

    'frontend/src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`,

    'frontend/src/index.css': `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #0f172a;
  color: #e2e8f0;
  min-height: 100vh;
}

h1 { font-size: 2rem; font-weight: 700; margin-bottom: 1rem; }
h2 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.75rem; }

button {
  cursor: pointer;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  transition: background 0.15s;
}

input {
  padding: 0.5rem 0.75rem;
  border: 1px solid #334155;
  border-radius: 0.375rem;
  background: #1e293b;
  color: #e2e8f0;
  font-size: 0.875rem;
  outline: none;
  width: 100%;
}

input:focus { border-color: #6366f1; }
`,

    'frontend/src/App.tsx': `import { useState, useEffect } from 'react';

interface Item {
  id: number;
  name: string;
  createdAt: string;
}

const API = '/api';

export default function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchItems = async () => {
    try {
      const res = await fetch(\`\${API}/items\`);
      if (!res.ok) throw new Error('Backend not reachable');
      setItems(await res.json());
      setError('');
    } catch (e) {
      setError('Cannot reach backend — is it running? (npm run dev in backend/)');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchItems(); }, []);

  const addItem = async () => {
    if (!newName.trim()) return;
    await fetch(\`\${API}/items\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    setNewName('');
    fetchItems();
  };

  const deleteItem = async (id: number) => {
    await fetch(\`\${API}/items/\${id}\`, { method: 'DELETE' });
    fetchItems();
  };

  return (
    <div style={{ maxWidth: 640, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>✨ ${appName}</h1>
      <p style={{ color: '#94a3b8', marginBottom: '2rem' }}>${description}</p>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addItem()}
          placeholder="New item name…"
        />
        <button
          onClick={addItem}
          style={{ background: '#6366f1', color: '#fff', whiteSpace: 'nowrap' }}
        >
          Add item
        </button>
      </div>

      {error && (
        <div style={{ background: '#450a0a', border: '1px solid #dc2626', borderRadius: '0.375rem', padding: '0.75rem', marginBottom: '1rem', fontSize: '0.875rem', color: '#fca5a5' }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: '#64748b' }}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ color: '#64748b' }}>No items yet — add one above!</p>
      ) : (
        <ul style={{ listStyle: 'none' }}>
          {items.map((item) => (
            <li
              key={item.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.75rem 1rem',
                marginBottom: '0.5rem',
                background: '#1e293b',
                borderRadius: '0.375rem',
                border: '1px solid #334155',
              }}
            >
              <span>{item.name}</span>
              <button
                onClick={() => deleteItem(item.id)}
                style={{ background: '#7f1d1d', color: '#fca5a5', padding: '0.25rem 0.5rem' }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
`,

    // ── Root README ─────────────────────────────────────────────────────
    'README.md': `# ${appName}

${description}

## Stack

| Layer    | Technology                  |
|----------|-----------------------------|
| Frontend | React 18 + Vite + TypeScript |
| Backend  | Node.js + Express + TypeScript |
| Database | ${dbLabel}                      |
| ORM      | Prisma                       |

## Getting Started

### 1. Set up the backend

\`\`\`bash
cd backend
npm install
# Push schema to SQLite database (creates dev.db)
npx prisma db push
npx prisma generate
# Start dev server
npm run dev
\`\`\`

Backend runs at **http://localhost:3001**

### 2. Set up the frontend

\`\`\`bash
cd frontend
npm install
npm run dev
\`\`\`

Frontend runs at **http://localhost:5173**

### 3. Open the database viewer (Prisma Studio)

Click **▶ Start DB Viewer** inside Dyad, or run manually:

\`\`\`bash
cd backend
npx prisma studio --port ${hostGuiPort}
\`\`\`

Prisma Studio is available at **http://localhost:${hostGuiPort}**

## Database

SQLite database file is stored at \`backend/dev.db\` (auto-created on first \`prisma db push\`).

Edit \`backend/.env\` to change the database path:

\`\`\`
DATABASE_URL="file:./dev.db"
\`\`\`

## Prisma

\`\`\`bash
# Generate client after schema changes
npx prisma generate

# Push schema to database (dev)
npx prisma db push

# Open Prisma Studio (GUI viewer)
npx prisma studio
\`\`\`
`,
  };
}
