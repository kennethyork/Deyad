import { useState, useEffect } from 'react';

type DbProvider = 'mysql' | 'postgresql';
type AppType = 'frontend' | 'fullstack' | 'mobile';

interface Props {
  onClose: () => void;
  onCreate: (name: string, description: string, appType: AppType, dbProvider?: DbProvider) => void;
}

interface Template {
  name: string;
  description: string;
  icon: string;
  appType: AppType;
  prompt: string;
}

const TEMPLATES: Template[] = [
  { name: 'Blank App', description: 'Start from scratch', icon: '📄', appType: 'frontend', prompt: '' },
  { name: 'Todo List', description: 'Task manager with add, complete & delete', icon: '✅', appType: 'frontend', prompt: 'Create a todo list app with add, complete, and delete functionality. Use a clean modern UI.' },
  { name: 'Landing Page', description: 'Hero section, features & contact form', icon: '🚀', appType: 'frontend', prompt: 'Build a responsive landing page with a hero section, features grid, and contact form.' },
  { name: 'Dashboard', description: 'Admin dashboard with charts & stats', icon: '📊', appType: 'frontend', prompt: 'Create an admin dashboard with stat cards, a chart area, and a recent activity table.' },
  { name: 'Chat UI', description: 'Real-time chat interface', icon: '💬', appType: 'frontend', prompt: 'Build a chat interface with message bubbles, a text input, and a sidebar with conversation list.' },
  { name: 'Blog', description: 'Blog with posts, categories & comments', icon: '📝', appType: 'fullstack', prompt: 'Create a blog with posts, categories, and comments. Include CRUD for posts and a clean reading UI.' },
  { name: 'E-commerce', description: 'Product catalog with cart & checkout', icon: '🛒', appType: 'fullstack', prompt: 'Build an e-commerce app with product listings, shopping cart, and a checkout flow.' },
  { name: 'Mobile Blank', description: 'Start from scratch', icon: '📱', appType: 'mobile', prompt: '' },
  { name: 'Social Feed', description: 'Social media feed with posts & likes', icon: '📲', appType: 'mobile', prompt: 'Create a social media feed with posts, likes, and a profile screen' },
  { name: 'Fitness Tracker', description: 'Workout logging & progress stats', icon: '💪', appType: 'mobile', prompt: 'Build a fitness tracker with workout logging, stats, and a progress chart' },
];

export default function NewAppModal({ onClose, onCreate }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [appType, setAppType] = useState<AppType>('frontend');
  const [dbProvider, setDbProvider] = useState<DbProvider>('postgresql');
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  useEffect(() => {
    window.deyad.checkDocker().then(setDockerAvailable);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate(name.trim(), description.trim(), appType, appType === 'fullstack' ? dbProvider : undefined);
  };

  const selectTemplate = (template: Template) => {
    setSelectedTemplate(template);
    if (!name) setName(template.name === 'Blank App' || template.name === 'Mobile Blank' ? '' : template.name);
    if (!description) setDescription(template.prompt || template.description);
    setAppType(template.appType);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>New App</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          {/* Template picker */}
          <div className="form-field">
            <label>Start from a template</label>
            <div className="template-grid">
              {TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  className={`template-card ${selectedTemplate?.name === t.name ? 'selected' : ''} ${t.appType === 'fullstack' && dockerAvailable === false ? 'disabled' : ''}`}
                  onClick={() => !(t.appType === 'fullstack' && dockerAvailable === false) && selectTemplate(t)}
                  title={t.appType === 'fullstack' && dockerAvailable === false ? 'Docker required' : t.description}
                >
                  <span className="template-icon">{t.icon}</span>
                  <span className="template-name">{t.name}</span>
                  {t.appType === 'fullstack' && <span className="template-badge">Full Stack</span>}
                  {t.appType === 'mobile' && <span className="template-badge template-badge-mobile">Mobile</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="app-name">App name</label>
            <input
              id="app-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome App"
              required
            />
          </div>

          <div className="form-field">
            <label htmlFor="app-desc">Description <span className="optional">(optional)</span></label>
            <input
              id="app-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short description of what the app does"
            />
          </div>

          {/* App type selector */}
          <div className="form-field">
            <label>App type</label>
            <div className="type-cards">
              <button
                type="button"
                className={`type-card ${appType === 'frontend' ? 'selected' : ''}`}
                onClick={() => setAppType('frontend')}
              >
                <span className="type-card-icon">⚡</span>
                <span className="type-card-title">Frontend Only</span>
                <span className="type-card-desc">React + Vite · No backend</span>
              </button>

              <button
                type="button"
                className={`type-card ${appType === 'fullstack' ? 'selected' : ''} ${dockerAvailable === false ? 'disabled' : ''}`}
                onClick={() => dockerAvailable !== false && setAppType('fullstack')}
                title={dockerAvailable === false ? 'Docker is required for full-stack apps' : ''}
              >
                <span className="type-card-icon">🗄️</span>
                <span className="type-card-title">Full Stack</span>
                <span className="type-card-desc">React + Express + DB + Prisma</span>
                {dockerAvailable === false && (
                  <span className="type-card-warning">⚠️ Docker required</span>
                )}
              </button>

              <button
                type="button"
                className={`type-card ${appType === 'mobile' ? 'selected' : ''}`}
                onClick={() => setAppType('mobile')}
              >
                <span className="type-card-icon">📱</span>
                <span className="type-card-title">Mobile App</span>
                <span className="type-card-desc">Expo + React Native</span>
              </button>
            </div>
          </div>

          {appType === 'fullstack' && (
            <div className="form-field">
              <label>Database</label>
              <div className="type-cards">
                <button
                  type="button"
                  className={`type-card ${dbProvider === 'postgresql' ? 'selected' : ''}`}
                  onClick={() => setDbProvider('postgresql')}
                >
                  <span className="type-card-icon">🐘</span>
                  <span className="type-card-title">PostgreSQL 16</span>
                  <span className="type-card-desc">Recommended · Feature-rich</span>
                </button>

                <button
                  type="button"
                  className={`type-card ${dbProvider === 'mysql' ? 'selected' : ''}`}
                  onClick={() => setDbProvider('mysql')}
                >
                  <span className="type-card-icon">🐬</span>
                  <span className="type-card-title">MySQL 8</span>
                  <span className="type-card-desc">Widely used · Battle-tested</span>
                </button>
              </div>
            </div>
          )}

          {appType === 'fullstack' && (
            <div className="stack-info">
              <p className="stack-info-title">🚀 What gets scaffolded automatically:</p>
              <ul>
                <li><strong>docker-compose.yml</strong> — {dbProvider === 'postgresql' ? 'PostgreSQL 16' : 'MySQL 8'} database</li>
                <li><strong>backend/</strong> — Express API + Prisma ORM</li>
                <li><strong>frontend/</strong> — React + Vite app (proxies to backend)</li>
                <li><strong>README.md</strong> — Setup &amp; run instructions</li>
              </ul>
              <p className="stack-info-db">
                🔑 DB credentials will be randomly generated when you create the app. Check <code>backend/.env</code> after creation.
              </p>
            </div>
          )}

          {appType === 'mobile' && (
            <div className="stack-info">
              <p className="stack-info-title">📱 What gets scaffolded automatically:</p>
              <ul>
                <li><strong>App.tsx</strong> — Root component</li>
                <li><strong>app/</strong> — Expo Router pages (tab navigation)</li>
                <li><strong>app.json</strong> — Expo config (SDK 52)</li>
                <li><strong>package.json</strong> — Expo + React Native dependencies</li>
                <li><strong>README.md</strong> — Setup &amp; run instructions</li>
              </ul>
              <p className="stack-info-db">
                📲 Run <code>npx expo install</code> then <code>npx expo start</code> to launch the dev server.
              </p>
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!name.trim()}>
              Create App
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
