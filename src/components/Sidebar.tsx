import { useState, useRef, useEffect } from 'react';
import type { AppProject } from '../App';

/** How long (ms) the delete confirmation button stays active before auto-cancelling. */
const DELETE_CONFIRM_TIMEOUT_MS = 3000;

interface Props {
  apps: AppProject[];
  selectedApp: AppProject | null;
  onSelectApp: (app: AppProject) => void;
  onNewApp: () => void;
  onDeleteApp: (id: string) => void;
  onRenameApp: (id: string, newName: string) => void;
  onDuplicateApp: (id: string) => void;
  onExportApp: (id: string) => void;
  onDeployApp: () => void;
  onImportApp: () => void;
  onOpenSettings: () => void;
  onOpenTaskQueue: () => void;
  onOpenVersionHistory: () => void;
  activeTasks: number;
}

export default function Sidebar({ apps, selectedApp, onSelectApp, onNewApp, onDeleteApp, onRenameApp, onDuplicateApp, onExportApp, onDeployApp, onImportApp, onOpenSettings, onOpenTaskQueue, onOpenVersionHistory, activeTasks }: Props) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  const startRename = (e: React.MouseEvent, app: AppProject) => {
    e.stopPropagation();
    setRenamingId(app.id);
    setRenameValue(app.name);
  };

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (renamingId && trimmed && trimmed !== apps.find((a) => a.id === renamingId)?.name) {
      onRenameApp(renamingId, trimmed);
    }
    setRenamingId(null);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') setRenamingId(null);
  };

  return (
    <aside className="sidebar" role="complementary" aria-label="Project sidebar">
      <div className="sidebar-header">
        <span className="sidebar-logo">Deyad</span>
        <div className="sidebar-header-actions">
          <button className="btn-import-app" onClick={onImportApp} title="Import existing project" aria-label="Import existing project">
            Import
          </button>
          <button className="btn-new-app" onClick={onNewApp} title="New App" aria-label="Create new app">
            +
          </button>
        </div>
      </div>

      <div className="sidebar-section-label" id="sidebar-apps-label">APPS</div>

      <nav className="sidebar-nav" aria-labelledby="sidebar-apps-label" role="navigation">
        {apps.length === 0 && (
          <p className="sidebar-empty">No apps yet</p>
        )}
        {apps.map((app) => (
          <div
            key={app.id}
            className={`sidebar-item ${selectedApp?.id === app.id ? 'active' : ''}`}
            onClick={() => renamingId !== app.id && onSelectApp(app)}
            role="button"
            tabIndex={0}
            aria-current={selectedApp?.id === app.id ? 'true' : undefined}
            aria-label={`Select app ${app.name}`}
            onKeyDown={(e) => { if (e.key === 'Enter' && renamingId !== app.id) onSelectApp(app); }}
          >
            <span className="sidebar-item-icon" />
            {renamingId === app.id ? (
              <input
                ref={renameInputRef}
                className="sidebar-rename-input"
                value={renameValue}
                autoFocus
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={handleRenameKeyDown}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="sidebar-item-name"
                onDoubleClick={(e) => startRename(e, app)}
                title="Double-click to rename"
              >
                {app.name}
              </span>
            )}
            <button
              className="sidebar-export"
              onClick={(e) => { e.stopPropagation(); onDuplicateApp(app.id); }}
              title="Duplicate project"
            >
              Dup
            </button>
            <button
              className="sidebar-export"
              onClick={(e) => { e.stopPropagation(); onExportApp(app.id); }}
              title="Export as ZIP"
            >
              Export
            </button>
            {selectedApp?.id === app.id && (
              <button
                className="sidebar-deploy"
                onClick={(e) => { e.stopPropagation(); onDeployApp(); }}
                title="Deploy to web"
              >
                Deploy
              </button>
            )}
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

      <div className="sidebar-footer" role="toolbar" aria-label="Sidebar actions">
        <button className="sidebar-tasks-btn" onClick={onOpenTaskQueue} title="Background task queue" aria-label={`Task queue${activeTasks > 0 ? `, ${activeTasks} active` : ''}`}>
          Tasks{activeTasks > 0 && <span className="task-badge" aria-hidden="true">{activeTasks}</span>}
        </button>
        <button className="sidebar-history-btn" onClick={onOpenVersionHistory} title="Version history" aria-label="Version history">
          History
        </button>
        <button className="sidebar-settings-btn" onClick={onOpenSettings} title="Settings" aria-label="Settings">
          Settings
        </button>
      </div>
    </aside>
  );
}
