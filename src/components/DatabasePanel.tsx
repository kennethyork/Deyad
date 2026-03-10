import { useEffect, useRef, useState } from 'react';
import type { AppProject } from '../App';

interface TableInfo {
  name: string;
  columns: string[];
}

type ViewMode = 'gui' | 'schema';

interface Props {
  app: AppProject;
  dbStatus: 'none' | 'running' | 'stopped';
}

const DEFAULT_GUI_PORTS: Record<string, number> = {
  mysql: 8080,
  postgresql: 5050,
};

const GUI_LABELS: Record<string, string> = {
  mysql: 'phpMyAdmin',
  postgresql: 'pgAdmin',
};

export default function DatabasePanel({ app, dbStatus }: Props) {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('gui');
  const [portReady, setPortReady] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const provider = app.dbProvider ?? 'mysql';
  const guiPort = app.guiPort ?? DEFAULT_GUI_PORTS[provider];
  const guiUrl = `http://localhost:${guiPort}`;
  const guiLabel = GUI_LABELS[provider];

  // Poll until the GUI port actually accepts connections before rendering the iframe
  useEffect(() => {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
    if (dbStatus !== 'running') { setPortReady(false); return; }
    let cancelled = false;
    const check = () => {
      fetch(guiUrl, { mode: 'no-cors' })
        .then(() => { if (!cancelled) setPortReady(true); })
        .catch(() => {
          if (!cancelled) pollRef.current = setTimeout(check, 1500);
        });
    };
    check();
    return () => { cancelled = true; if (pollRef.current) clearTimeout(pollRef.current); };
  }, [dbStatus, guiUrl]);

  useEffect(() => {
    if (app.appType !== 'fullstack') return;
    setLoading(true);
    window.deyad.dbDescribe(app.id)
      .then((res) => setTables(res.tables))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [app]);

  if (app.appType !== 'fullstack') {
    return <div className="db-panel">Database info is available only for full-stack apps.</div>;
  }

  return (
    <div className="db-panel">
      {/* Toolbar */}
      <div className="db-toolbar">
        <div className="db-toolbar-tabs">
          <button
            className={`db-toolbar-tab ${view === 'gui' ? 'active' : ''}`}
            onClick={() => setView('gui')}
          >
            {guiLabel}
          </button>
          <button
            className={`db-toolbar-tab ${view === 'schema' ? 'active' : ''}`}
            onClick={() => setView('schema')}
          >
            Schema
          </button>
        </div>
        <div className="db-toolbar-status">
          <span className={`db-status-dot ${dbStatus}`} />
          {dbStatus === 'running' ? 'Running' : dbStatus === 'stopped' ? 'Stopped' : 'No DB'}
        </div>
      </div>

      {/* GUI view */}
      {view === 'gui' && (
        <div className="db-gui-wrapper">
          {dbStatus !== 'running' ? (
            <div className="db-gui-placeholder">
              <div className="db-gui-placeholder-icon">{provider === 'mysql' ? '🐬' : '🐘'}</div>
              <h3>{guiLabel}</h3>
              <p>Start the database to access {guiLabel}.</p>
              <p className="db-gui-hint">
                Use the <strong>DB toggle</strong> in the chat panel or run <code>docker compose up -d</code> in the terminal.
              </p>
            </div>
          ) : !portReady ? (
            <div className="db-gui-placeholder">
              <div className="db-gui-placeholder-icon">⏳</div>
              <h3>Starting {guiLabel}…</h3>
              <p>Waiting for {guiLabel} to be ready on port {guiPort}.</p>
            </div>
          ) : (
            <iframe
              key={`${provider}-${dbStatus}`}
              src={guiUrl}
              className="db-gui-iframe"
              title={guiLabel}
            />
          )}
        </div>
      )}

      {/* Schema view */}
      {view === 'schema' && (
        <div className="db-schema-view">
          {loading && <p className="db-schema-loading">Loading schema…</p>}
          {error && <p className="db-schema-error">Error: {error}</p>}
          {!loading && !error && tables.length === 0 && <p className="db-schema-empty">No tables found in schema.</p>}
          {tables.map((t) => (
            <div key={t.name} className="db-table">
              <div className="db-table-name">{t.name}</div>
              <ul className="db-table-cols">
                {t.columns.map((c) => (<li key={c}>{c}</li>))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
