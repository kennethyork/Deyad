import { useState } from 'react';
import type { AppProject } from '../App';

/** How long (ms) the delete confirmation button stays active before auto-cancelling. */
const DELETE_CONFIRM_TIMEOUT_MS = 3000;

interface Props {
  apps: AppProject[];
  selectedApp: AppProject | null;
  onSelectApp: (app: AppProject) => void;
  onNewApp: () => void;
  onDeleteApp: (id: string) => void;
}

export default function Sidebar({ apps, selectedApp, onSelectApp, onNewApp, onDeleteApp }: Props) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirmDelete === id) {
      onDeleteApp(id);
      setConfirmDelete(null);
    } else {
      setConfirmDelete(id);
      setTimeout(() => setConfirmDelete(null), DELETE_CONFIRM_TIMEOUT_MS);
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-logo">🤖 Deyad</span>
        <button className="btn-new-app" onClick={onNewApp} title="New App">
          +
        </button>
      </div>

      <div className="sidebar-section-label">APPS</div>

      <nav className="sidebar-nav">
        {apps.length === 0 && (
          <p className="sidebar-empty">No apps yet</p>
        )}
        {apps.map((app) => (
          <div
            key={app.id}
            className={`sidebar-item ${selectedApp?.id === app.id ? 'active' : ''}`}
            onClick={() => onSelectApp(app)}
          >
            <span className="sidebar-item-icon">
              {app.isFullStack ? '🗄️' : '⚡'}
            </span>
            <span className="sidebar-item-name">{app.name}</span>
            <button
              className={`sidebar-delete ${confirmDelete === app.id ? 'confirm' : ''}`}
              onClick={(e) => handleDelete(e, app.id)}
              title={confirmDelete === app.id ? 'Click again to confirm' : 'Delete app'}
            >
              {confirmDelete === app.id ? '✓' : '×'}
            </button>
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <a
          className="sidebar-footer-link"
          href="https://ollama.ai"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by Ollama
        </a>
      </div>
    </aside>
  );
}
