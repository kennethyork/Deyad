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
  onDbToggle: () => void;
}

const DEFAULT_GUI_PORT = 5050;

export default function DatabasePanel({ app, dbStatus, onDbToggle }: Props) {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('gui');
  const [portReady, setPortReady] = useState(false);
  const [pgEmail, setPgEmail] = useState('admin@admin.com');
  const [pgPassword, setPgPassword] = useState('admin');
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const guiPort = app.guiPort ?? DEFAULT_GUI_PORT;
  const guiUrl = `http://localhost:${guiPort}`;

  // Poll until the GUI port actually accepts connections before rendering the iframe
  useEffect(() => {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
    if (dbStatus !== 'running') { setPortReady(false); return; }
    let cancelled = false;
    const check = () => {
      window.deyad.portCheck(guiPort)
        .then((open) => {
          if (cancelled) return;
          if (open) setPortReady(true);
          else pollRef.current = setTimeout(check, 1500);
        })
        .catch(() => {
          if (!cancelled) pollRef.current = setTimeout(check, 1500);
        });
    };
    check();
    return () => { cancelled = true; if (pollRef.current) clearTimeout(pollRef.current); };
  }, [dbStatus, guiPort]);

  useEffect(() => {
    window.deyad.getSettings().then((s) => {
      setPgEmail(s.pgAdminEmail ?? 'admin@admin.com');
      setPgPassword(s.pgAdminPassword ?? 'admin');
    }).catch((err) => console.warn('Failed to load settings:', err));
  }, []);

  useEffect(() => {
    if (app.appType !== 'fullstack') return;
    setLoading(true);
    window.deyad.dbDescribe(app.id)
      .then((res) => setTables(res.tables))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [app.id, app.appType]);

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
            pgAdmin
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
          {dbStatus !== 'none' && (
            <button className={`btn-db ${dbStatus}`} onClick={onDbToggle}>
              {dbStatus === 'running' ? '⏹ Stop' : '▶ Start'}
            </button>
          )}
        </div>
      </div>

      {/* GUI view */}
      {view === 'gui' && (
        <div className="db-gui-wrapper">
          {dbStatus !== 'running' ? (
            <div className="db-gui-placeholder">
              <div className="db-gui-placeholder-icon">🐘</div>
              <h3>PostgreSQL + pgAdmin</h3>
              <p>Start the database to access pgAdmin.</p>
              <button className="btn-db-start-large" onClick={onDbToggle}>
                ▶ Start Database
              </button>
            </div>
          ) : !portReady ? (
            <div className="db-gui-placeholder">
              <div className="db-gui-placeholder-icon">⏳</div>
              <h3>Starting pgAdmin…</h3>
              <p>Waiting for pgAdmin to be ready on port {guiPort}.</p>
            </div>
          ) : (
            <>
              <div className="db-gui-credentials">
                <span>Login: <strong>{pgEmail}</strong> / <strong>{pgPassword}</strong></span>
              </div>
              <webview
                key={`pgadmin-${dbStatus}`}
                src={guiUrl}
                className="db-gui-iframe"
                partition="persist:pgadmin"
                // @ts-expect-error -- webview attributes not in React typings
                allowpopups="true"
              />
            </>
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
