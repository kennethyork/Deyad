import { useState, useEffect } from 'react';

type AppType = 'frontend' | 'fullstack';

interface Props {
  onClose: () => void;
  onCreate: (name: string, description: string, appType: AppType, templatePrompt?: string) => void;
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
  // Auth scaffolding templates
  { name: 'Auth App', description: 'Login, signup & JWT auth', icon: '🔐', appType: 'fullstack', prompt: 'Create a full-stack app with user authentication: signup form, login form, JWT token-based auth, protected routes, logout, and a user profile page. Use bcrypt for password hashing, Express middleware for auth checks, and Prisma for the User model.' },
  { name: 'OAuth Login', description: 'Google & GitHub OAuth login', icon: '🔑', appType: 'fullstack', prompt: 'Build a full-stack app with OAuth login using Google and GitHub. Include a login page with social login buttons, callback routes, session management, and a protected dashboard that shows user info from the OAuth provider.' },
  { name: 'Role-Based Access', description: 'Admin & user roles with guards', icon: '🛡️', appType: 'fullstack', prompt: 'Create a full-stack app with role-based access control. Include user registration with roles (admin, user), login, role-guarded API routes, an admin panel for user management, and a regular user dashboard.' },
  // Additional templates for gallery expansion
  { name: 'SaaS Starter', description: 'Stripe billing + dashboard', icon: '💳', appType: 'fullstack', prompt: 'Build a SaaS starter kit with Stripe subscription billing, pricing page with plan tiers, user dashboard with usage stats, account settings, and webhook handling for payment events.' },
  { name: 'REST API', description: 'RESTful API with CRUD + docs', icon: '🔌', appType: 'fullstack', prompt: 'Create a RESTful API backend with Express. Include full CRUD for resources, input validation, error handling middleware, pagination, and auto-generated API documentation page.' },
  { name: 'File Manager', description: 'Upload, preview & organize files', icon: '📁', appType: 'fullstack', prompt: 'Build a file manager with file upload, preview (images and text), folder organization, drag and drop, file search, and a clean grid/list view toggle.' },
  { name: 'Survey Builder', description: 'Build & collect survey responses', icon: '📊', appType: 'fullstack', prompt: 'Create a survey builder app where users can create surveys with multiple question types (text, multiple choice, rating), publish surveys via link, collect responses, and view results with charts.' },
  { name: 'Pomodoro Timer', description: 'Focus timer with stats', icon: '⏱️', appType: 'frontend', prompt: 'Build a Pomodoro timer app with work/break intervals, customizable durations, session history, productivity stats, and audio notifications. Use a clean minimal design.' },
  { name: 'Recipe Book', description: 'Recipe collection with search', icon: '🍳', appType: 'frontend', prompt: 'Create a recipe book app with recipe cards (image, title, ingredients, steps), category filtering, search, and a form to add new recipes. Use a warm, food-themed design.' },
  { name: 'Quiz Game', description: 'Trivia quiz with score tracking', icon: '🎮', appType: 'frontend', prompt: 'Build a trivia quiz game with multiple categories, timed questions, score tracking, leaderboard, and animated transitions between questions. Include at least 10 sample questions per category.' },
  { name: 'Expense Tracker', description: 'Track spending with charts', icon: '💰', appType: 'frontend', prompt: 'Create an expense tracker app with add/edit/delete transactions, category labels, monthly summary with pie chart, budget limits, and a clean financial dashboard.' },
];

export default function NewAppModal({ onClose, onCreate }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [appType, setAppType] = useState<AppType>('frontend');
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
    }).catch((err) => console.warn('listPlugins:', err));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const tPrompt = selectedTemplate?.prompt || undefined;
    onCreate(name.trim(), description.trim(), appType, tPrompt);
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
                    className={`template-card ${selectedTemplate?.name === t.name ? 'selected' : ''}`}
                    onClick={() => selectTemplate(t)}
                    title={t.description}
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
                className={`type-card ${appType === 'fullstack' ? 'selected' : ''}`}
                onClick={() => setAppType('fullstack')}
              >
                <span className="type-card-icon"></span>
                <span className="type-card-title">Full Stack</span>
                <span className="type-card-desc">React + Express + SQLite + Prisma</span>
              </button>
            </div>
          </div>



          {appType === 'fullstack' && (
            <div className="stack-info">
              <p className="stack-info-title">What gets scaffolded automatically:</p>
              <ul>
                <li><strong>backend/</strong> — Express API + Prisma ORM + SQLite</li>
                <li><strong>frontend/</strong> — React + Vite app (proxies to backend)</li>
                <li><strong>README.md</strong> — Setup &amp; run instructions</li>
              </ul>
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
