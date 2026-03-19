/**
 * Scaffold generators for Deyad.
 *
 * generateFrontendScaffold — a minimal runnable React + Vite + TypeScript project
 *   for frontend-only apps (enables in-app preview via `npm run dev`).
 *
 * generateFullStackScaffold — a project with:
 *   - React + Vite  (frontend, port 5173)
 *   - Express       (backend API, port 3001)
 *   - SQLite        (file-based database via Prisma)
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
  dbName: string;
  dbUser: string;
  /** If omitted a cryptographically random password is generated at scaffold time. */
  dbPassword: string;
}

/**
 * Derive two unique, deterministic host ports from an app ID so that
 * multiple fullstack apps can run side-by-side without conflicts.
 *
 * Returns [dbPort, guiPort] where both are in the 10000–59999 range.
 * The two ports are guaranteed to differ from each other.
 */
export function allocatePorts(appId: string): [number, number] {
  let h = 0;
  for (let i = 0; i < appId.length; i++) {
    h = ((h << 5) - h + appId.charCodeAt(i)) | 0;
  }
  const dbPort = ((h >>> 0) % 50000) + 10000; // 10000–59999
  const guiPort = dbPort + 1;
  return [dbPort, guiPort];
}

/**
 * Sanitises a string so it is safe to use as a database identifier or
 * Docker Compose container/volume name. Replaces all non-alphanumeric/underscore
 * characters and ensures the result does not start with a digit.
 */
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[0-9]/, '_$&');
}

export function generateFullStackScaffold(opts: ScaffoldOptions): Record<string, string> {
  const { appName, description } = opts;

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
  provider = "sqlite"
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
| Database | SQLite (file-based)          |
| ORM      | Prisma                       |

## Getting Started

### 1. Set up the backend

\`\`\`bash
cd backend
npm install
# Create the database and generate Prisma client
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

## Database

The database is a SQLite file at \`backend/prisma/dev.db\`. You can browse it in
the **Database** tab inside Deyad, or open it with any SQLite client.

## Prisma

\`\`\`bash
# Generate client after schema changes
npx prisma generate

# Push schema to database (dev)
npx prisma db push

# Open Prisma Studio (GUI)
npx prisma studio
\`\`\`
`,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Next.js scaffold
// ═══════════════════════════════════════════════════════════════════════

export function generateNextJsScaffold(opts: FrontendScaffoldOptions): Record<string, string> {
  const { appName, description } = opts;
  const safeName = appName.toLowerCase().replace(/[^a-z0-9-_.]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  return {
    'package.json': JSON.stringify(
      {
        name: safeName,
        version: '0.0.1',
        description,
        private: true,
        scripts: {
          dev: 'next dev',
          build: 'next build',
          start: 'next start',
          lint: 'next lint',
        },
        dependencies: {
          next: '^14.2.0',
          react: '^18.3.1',
          'react-dom': '^18.3.1',
        },
        devDependencies: {
          '@types/node': '^20.14.0',
          '@types/react': '^18.3.11',
          '@types/react-dom': '^18.3.1',
          typescript: '^5.4.5',
        },
      },
      null,
      2,
    ),

    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2017',
          lib: ['dom', 'dom.iterable', 'esnext'],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: 'esnext',
          moduleResolution: 'bundler',
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: 'preserve',
          incremental: true,
          plugins: [{ name: 'next' }],
          paths: { '@/*': ['./src/*'] },
        },
        include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
        exclude: ['node_modules'],
      },
      null,
      2,
    ),

    'next.config.mjs': `/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
`,

    'src/app/layout.tsx': `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '${appName}',
  description: '${description}',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,

    'src/app/globals.css': `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #0f172a;
  color: #e2e8f0;
  min-height: 100vh;
}
`,

    'src/app/page.tsx': `export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: '4rem auto', padding: '0 1rem', textAlign: 'center' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 700 }}>✨ ${appName}</h1>
      <p style={{ color: '#94a3b8', marginTop: '0.5rem' }}>${description}</p>
      <p style={{ color: '#64748b', marginTop: '2rem', fontSize: '0.875rem' }}>
        Chat with the AI to build your app →
      </p>
    </main>
  );
}
`,

    'src/app/api/hello/route.ts': `import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ message: 'Hello from ${appName}!' });
}
`,

    'README.md': `# ${appName}

${description}

## Stack

| Layer    | Technology            |
|----------|-----------------------|
| Framework | Next.js 14 (App Router) |
| Language  | TypeScript            |
| UI        | React 18              |

## Getting Started

\\\`\\\`\\\`bash
npm install
npm run dev
\\\`\\\`\\\`

Open [http://localhost:3000](http://localhost:3000) in your browser.
`,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Python / FastAPI scaffold
// ═══════════════════════════════════════════════════════════════════════

export function generatePythonScaffold(opts: FrontendScaffoldOptions): Record<string, string> {
  const { appName, description } = opts;
  const safeName = appName.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

  return {
    'requirements.txt': `fastapi>=0.111.0
uvicorn[standard]>=0.30.0
sqlmodel>=0.0.19
`,

    'main.py': `"""${appName} — ${description}"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Field, Session, SQLModel, create_engine, select

# ── Database ────────────────────────────────────────────────────────────
DATABASE_URL = "sqlite:///./data.db"
engine = create_engine(DATABASE_URL, echo=False)


class Item(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    done: bool = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    SQLModel.metadata.create_all(engine)
    yield


# ── App ─────────────────────────────────────────────────────────────────
app = FastAPI(title="${appName}", description="${description}", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"message": "Hello from ${appName}!"}


@app.get("/items")
def list_items():
    with Session(engine) as session:
        return session.exec(select(Item)).all()


@app.post("/items", status_code=201)
def create_item(item: Item):
    with Session(engine) as session:
        session.add(item)
        session.commit()
        session.refresh(item)
        return item


@app.delete("/items/{item_id}")
def delete_item(item_id: int):
    with Session(engine) as session:
        item = session.get(Item, item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Item not found")
        session.delete(item)
        session.commit()
        return {"deleted": True}
`,

    '.gitignore': `__pycache__/
*.py[cod]
*.egg-info/
dist/
.venv/
data.db
`,

    'README.md': `# ${appName}

${description}

## Stack

| Layer     | Technology          |
|-----------|---------------------|
| Framework | FastAPI             |
| Language  | Python 3.11+        |
| Database  | SQLite (via SQLModel)|
| Server    | Uvicorn             |

## Getting Started

\\\`\\\`\\\`bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\\\Scripts\\\\activate
pip install -r requirements.txt
uvicorn main:app --reload
\\\`\\\`\\\`

API docs at [http://localhost:8000/docs](http://localhost:8000/docs)
`,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Go scaffold
// ═══════════════════════════════════════════════════════════════════════

export function generateGoScaffold(opts: FrontendScaffoldOptions): Record<string, string> {
  const { appName, description } = opts;
  const safeName = appName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  return {
    'go.mod': `module ${safeName}

go 1.22

require github.com/go-chi/chi/v5 v5.0.12
`,

    'main.go': `package main

import (
\t"database/sql"
\t"encoding/json"
\t"log"
\t"net/http"
\t"strconv"

\t"github.com/go-chi/chi/v5"
\t"github.com/go-chi/chi/v5/middleware"
\t_ "modernc.org/sqlite"
)

// ${appName} — ${description}

var db *sql.DB

type Item struct {
\tID   int64  \`json:"id"\`
\tName string \`json:"name"\`
\tDone bool   \`json:"done"\`
}

func main() {
\tvar err error
\tdb, err = sql.Open("sqlite", "./data.db")
\tif err != nil {
\t\tlog.Fatal(err)
\t}
\tdefer db.Close()

\t_, err = db.Exec(\`CREATE TABLE IF NOT EXISTS items (
\t\tid INTEGER PRIMARY KEY AUTOINCREMENT,
\t\tname TEXT NOT NULL,
\t\tdone BOOLEAN DEFAULT FALSE
\t)\`)
\tif err != nil {
\t\tlog.Fatal(err)
\t}

\tr := chi.NewRouter()
\tr.Use(middleware.Logger)
\tr.Use(middleware.Recoverer)

\tr.Get("/", func(w http.ResponseWriter, r *http.Request) {
\t\tjson.NewEncoder(w).Encode(map[string]string{"message": "Hello from ${appName}!"})
\t})

\tr.Get("/items", listItems)
\tr.Post("/items", createItem)
\tr.Delete("/items/{id}", deleteItem)

\tlog.Println("Listening on :8080")
\tlog.Fatal(http.ListenAndServe(":8080", r))
}

func listItems(w http.ResponseWriter, r *http.Request) {
\trows, err := db.Query("SELECT id, name, done FROM items")
\tif err != nil {
\t\thttp.Error(w, err.Error(), 500)
\t\treturn
\t}
\tdefer rows.Close()

\titems := []Item{}
\tfor rows.Next() {
\t\tvar it Item
\t\tif err := rows.Scan(&it.ID, &it.Name, &it.Done); err != nil {
\t\t\thttp.Error(w, err.Error(), 500)
\t\t\treturn
\t\t}
\t\titems = append(items, it)
\t}
\tjson.NewEncoder(w).Encode(items)
}

func createItem(w http.ResponseWriter, r *http.Request) {
\tvar it Item
\tif err := json.NewDecoder(r.Body).Decode(&it); err != nil {
\t\thttp.Error(w, "Invalid JSON", 400)
\t\treturn
\t}
\tresult, err := db.Exec("INSERT INTO items (name, done) VALUES (?, ?)", it.Name, it.Done)
\tif err != nil {
\t\thttp.Error(w, err.Error(), 500)
\t\treturn
\t}
\tid, _ := result.LastInsertId()
\tit.ID = id
\tw.WriteHeader(201)
\tjson.NewEncoder(w).Encode(it)
}

func deleteItem(w http.ResponseWriter, r *http.Request) {
\tidStr := chi.URLParam(r, "id")
\tid, err := strconv.ParseInt(idStr, 10, 64)
\tif err != nil {
\t\thttp.Error(w, "Invalid ID", 400)
\t\treturn
\t}
\t_, err = db.Exec("DELETE FROM items WHERE id = ?", id)
\tif err != nil {
\t\thttp.Error(w, err.Error(), 500)
\t\treturn
\t}
\tjson.NewEncoder(w).Encode(map[string]bool{"deleted": true})
}
`,

    '.gitignore': `data.db
${safeName}
`,

    'README.md': `# ${appName}

${description}

## Stack

| Layer     | Technology            |
|-----------|-----------------------|
| Language  | Go 1.22+              |
| Router    | Chi v5                |
| Database  | SQLite (modernc.org)  |

## Getting Started

\\\`\\\`\\\`bash
go mod tidy
go run .
\\\`\\\`\\\`

Server runs at [http://localhost:8080](http://localhost:8080)
`,
  };
}
