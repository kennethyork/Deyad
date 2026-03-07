import { useState, useEffect } from 'react';

interface Props {
  onClose: () => void;
  onCreate: (name: string, description: string, isFullStack: boolean) => void;
}

export default function NewAppModal({ onClose, onCreate }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isFullStack, setIsFullStack] = useState(false);
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    window.deyad.checkDocker().then(setDockerAvailable);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate(name.trim(), description.trim(), isFullStack);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>New App</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
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
                className={`type-card ${!isFullStack ? 'selected' : ''}`}
                onClick={() => setIsFullStack(false)}
              >
                <span className="type-card-icon">⚡</span>
                <span className="type-card-title">Frontend Only</span>
                <span className="type-card-desc">React + Vite · No backend</span>
              </button>

              <button
                type="button"
                className={`type-card ${isFullStack ? 'selected' : ''} ${dockerAvailable === false ? 'disabled' : ''}`}
                onClick={() => dockerAvailable !== false && setIsFullStack(true)}
                title={dockerAvailable === false ? 'Docker is required for full-stack apps' : ''}
              >
                <span className="type-card-icon">🗄️</span>
                <span className="type-card-title">Full Stack</span>
                <span className="type-card-desc">React + Express + MySQL + Prisma</span>
                {dockerAvailable === false && (
                  <span className="type-card-warning">⚠️ Docker required</span>
                )}
              </button>
            </div>
          </div>

          {isFullStack && (
            <div className="stack-info">
              <p className="stack-info-title">🚀 What gets scaffolded automatically:</p>
              <ul>
                <li><strong>docker-compose.yml</strong> — MySQL 8 database</li>
                <li><strong>backend/</strong> — Express API + Prisma ORM</li>
                <li><strong>frontend/</strong> — React + Vite app (proxies to backend)</li>
                <li><strong>README.md</strong> — Setup &amp; run instructions</li>
              </ul>
              <p className="stack-info-db">
                🔑 DB credentials will be randomly generated when you create the app. Check <code>backend/.env</code> after creation.
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
