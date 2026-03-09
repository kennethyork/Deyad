import { useState, useEffect } from 'react';

type DbProvider = 'mysql' | 'postgresql';
type AppType = 'frontend' | 'fullstack';

interface Props {
  onClose: () => void;
  onCreate: (name: string, description: string, appType: AppType, dbProvider?: DbProvider, templatePrompt?: string) => void;
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
  { name: 'Todo List', description: 'Task manager with add, complete & delete', icon: '✅', appType: 'frontend', prompt: 'Create a todo list app with add, complete, and delete functionality. Use a clean modern UI with animations.' },
  { name: 'Landing Page', description: 'Hero section, features & contact form', icon: '🚀', appType: 'frontend', prompt: 'Build a responsive landing page with a hero section, features grid, testimonials section, and contact form. Use modern design with gradients.' },
  { name: 'Dashboard', description: 'Admin dashboard with charts & stats', icon: '📊', appType: 'frontend', prompt: 'Create an admin dashboard with stat cards, a chart area, and a recent activity table. Include a sidebar navigation.' },
  { name: 'Chat UI', description: 'Real-time chat interface', icon: '💬', appType: 'frontend', prompt: 'Build a chat interface with message bubbles, a text input, and a sidebar with conversation list. Add typing indicators.' },
  { name: 'Portfolio', description: 'Personal portfolio with projects', icon: '🎨', appType: 'frontend', prompt: 'Build a personal portfolio site with an about section, project cards with images, skill tags, and a contact form. Use smooth scroll navigation.' },
  { name: 'Weather App', description: 'Weather dashboard with forecasts', icon: '🌤️', appType: 'frontend', prompt: 'Create a weather dashboard app with a search bar, current weather display with temperature and conditions, a 5-day forecast section, and weather icons. Use a clean card-based layout.' },
  { name: 'Calculator', description: 'Scientific calculator with history', icon: '🔢', appType: 'frontend', prompt: 'Build a calculator app with basic arithmetic, scientific functions, calculation history, and a clean modern UI with button grid.' },
  { name: 'Notes App', description: 'Markdown notes with live preview', icon: '📝', appType: 'frontend', prompt: 'Create a notes app with markdown editing and live preview side by side. Include a sidebar for note list, search, and categories.' },
  { name: 'Kanban Board', description: 'Drag & drop task board', icon: '📋', appType: 'frontend', prompt: 'Build a Kanban board with columns (To Do, In Progress, Done), draggable task cards, add/edit/delete tasks, and column management.' },
  // new mobile / web-focused templates
  { name: 'Mobile App', description: 'Cordova/Capacitor mobile shell', icon: '📱', appType: 'frontend', prompt: 'Create a simple mobile app shell with a bottom navigation, responsive layout, and example screens. Prepare for Cordova or Capacitor packaging.' },
  { name: 'PWA Dashboard', description: 'Progressive web app dashboard', icon: '🌐', appType: 'frontend', prompt: 'Build a progressive web app dashboard with offline caching, responsive grid, and install prompt support. Include service worker skeleton.' },
  { name: 'Blog', description: 'Blog with posts, categories & comments', icon: '✍️', appType: 'fullstack', prompt: 'Create a blog with posts, categories, and comments. Include CRUD for posts and a clean reading UI with pagination.' },
  { name: 'E-commerce', description: 'Product catalog with cart & checkout', icon: '🛒', appType: 'fullstack', prompt: 'Build an e-commerce app with product listings, shopping cart, checkout flow, and order history.' },
  { name: 'Social Feed', description: 'Social media feed with posts & likes', icon: '📱', appType: 'fullstack', prompt: 'Build a social media feed with user posts, like/unlike functionality, comments, and a create post form with image upload support.' },
  { name: 'Task Tracker', description: 'Project task tracker with teams', icon: '🗂️', appType: 'fullstack', prompt: 'Create a project task tracker with user assignment, due dates, priority levels, project grouping, and a dashboard overview.' },
];

export default function NewAppModal({ onClose, onCreate }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [appType, setAppType] = useState<AppType>('frontend');
  const [dbProvider, setDbProvider] = useState<DbProvider>('postgresql');
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [pluginTemplates, setPluginTemplates] = useState<Template[]>([]);

  // load plugin templates on mount
  useEffect(() => {
    window.deyad.listPlugins().then((plugins) => {
      const pts: Template[] = [];
      plugins.forEach((p) => {
        if (p.templates) {
          p.templates.forEach((t) => pts.push({ ...t }));
        }
      });
      setPluginTemplates(pts);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    window.deyad.checkDocker().then(setDockerAvailable);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const tPrompt = selectedTemplate?.prompt || undefined;
    onCreate(name.trim(), description.trim(), appType, appType === 'fullstack' ? dbProvider : undefined, tPrompt);
  };

  const selectTemplate = (template: Template) => {
    setSelectedTemplate(template);
    setName(template.name === 'Blank App' ? '' : template.name);
    setDescription(template.prompt || template.description);
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
            <div className="template-grid-scroll">
              <div className="template-grid">
                {(TEMPLATES.concat(pluginTemplates)).map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    className={`template-card ${selectedTemplate?.name === t.name ? 'selected' : ''} ${t.appType === 'fullstack' && dockerAvailable === false ? 'disabled' : ''}`}
                    onClick={() => !(t.appType === 'fullstack' && dockerAvailable === false) && selectTemplate(t)}
                    title={t.appType === 'fullstack' && dockerAvailable === false ? 'Docker required' : t.description}
                  >
                    <span className="template-icon">{t.icon}</span>
                    <span className="template-name">{t.name}</span>
                    <span className="template-desc">{t.description}</span>
                    {t.appType === 'fullstack' && <span className="template-badge">Full Stack</span>}
                  </button>
                ))}
              </div>
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
                <span className="type-card-icon"></span>
                <span className="type-card-title">Frontend Only</span>
                <span className="type-card-desc">React + Vite · No backend</span>
              </button>

              <button
                type="button"
                className={`type-card ${appType === 'fullstack' ? 'selected' : ''} ${dockerAvailable === false ? 'disabled' : ''}`}
                onClick={() => dockerAvailable !== false && setAppType('fullstack')}
                title={dockerAvailable === false ? 'Docker is required for full-stack apps' : ''}
              >
                <span className="type-card-icon"></span>
                <span className="type-card-title">Full Stack</span>
                <span className="type-card-desc">React + Express + DB + Prisma</span>
                {dockerAvailable === false && (
                  <span className="type-card-warning">Docker required</span>
                )}
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
                  <span className="type-card-icon"></span>
                  <span className="type-card-title">PostgreSQL 16</span>
                  <span className="type-card-desc">Recommended · Feature-rich</span>
                </button>

                <button
                  type="button"
                  className={`type-card ${dbProvider === 'mysql' ? 'selected' : ''}`}
                  onClick={() => setDbProvider('mysql')}
                >
                  <span className="type-card-icon"></span>
                  <span className="type-card-title">MySQL 8</span>
                  <span className="type-card-desc">Widely used · Battle-tested</span>
                </button>
              </div>
            </div>
          )}

          {appType === 'fullstack' && (
            <div className="stack-info">
              <p className="stack-info-title">What gets scaffolded automatically:</p>
              <ul>
                <li><strong>docker-compose.yml</strong> — {dbProvider === 'postgresql' ? 'PostgreSQL 16' : 'MySQL 8'} database</li>
                <li><strong>backend/</strong> — Express API + Prisma ORM</li>
                <li><strong>frontend/</strong> — React + Vite app (proxies to backend)</li>
                <li><strong>README.md</strong> — Setup &amp; run instructions</li>
              </ul>
              <p className="stack-info-db">
                DB credentials will be randomly generated when you create the app. Check <code>backend/.env</code> after creation.
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
