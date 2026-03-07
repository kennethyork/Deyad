import { useState, useEffect, useRef } from 'react';
import type { AppProject } from '../App';

/** Port the Vite dev server listens on (matches vite.config.ts in both scaffolds). */
const PREVIEW_URL = 'http://localhost:5173';

type DevStatus = 'stopped' | 'starting' | 'running' | 'error';

interface Props {
  app: AppProject;
}

export default function PreviewPanel({ app }: Props) {
  const [status, setStatus] = useState<DevStatus>('stopped');
  const [logs, setLogs] = useState<string>('');
  const [showLogs, setShowLogs] = useState(false);
  const [startError, setStartError] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Subscribe to dev-server log and status events
  useEffect(() => {
    const unsubLog = window.deyad.onAppDevLog(({ appId, data }) => {
      if (appId !== app.id) return;
      setLogs((prev) => prev + data);
      // Auto-detect "ready" from Vite output
      if (data.includes('localhost') || data.includes('Local:')) {
        setStatus('running');
      }
    });

    const unsubStatus = window.deyad.onAppDevStatus(({ appId, status: s }) => {
      if (appId !== app.id) return;
      if (s === 'stopped') setStatus('stopped');
      if (s === 'starting') setStatus('starting');
      if (s === 'running') setStatus('running');
    });

    return () => {
      unsubLog();
      unsubStatus();
    };
  }, [app.id]);

  // Scroll logs to bottom on new output
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Reset when switching apps
  useEffect(() => {
    setStatus('stopped');
    setLogs('');
    setStartError('');
  }, [app.id]);

  const handleStart = async () => {
    setStartError('');
    setLogs('');
    setStatus('starting');
    const result = await window.deyad.appDevStart(app.id);
    if (!result.success) {
      setStatus('error');
      setStartError(result.error ?? 'Unknown error');
    }
  };

  const handleStop = async () => {
    await window.deyad.appDevStop(app.id);
    setStatus('stopped');
  };

  const handleRefresh = () => {
    if (iframeRef.current) {
      iframeRef.current.src = PREVIEW_URL;
    }
  };

  return (
    <div className="preview-panel">
      {/* Toolbar */}
      <div className="preview-toolbar">
        <span className="preview-url">{PREVIEW_URL}</span>

        <div className="preview-toolbar-actions">
          {status === 'running' && (
            <button className="btn-preview-action" onClick={handleRefresh} title="Refresh preview">
              ↺
            </button>
          )}
          {(status === 'stopped' || status === 'error') && (
            <button className="btn-preview-run" onClick={handleStart}>
              ▶ Run App
            </button>
          )}
          {status === 'starting' && (
            <button className="btn-preview-run starting" disabled>
              <span className="preview-spinner" /> Starting…
            </button>
          )}
          {status === 'running' && (
            <button className="btn-preview-stop" onClick={handleStop}>
              ⏹ Stop
            </button>
          )}
          <button
            className={`btn-preview-logs ${showLogs ? 'active' : ''}`}
            onClick={() => setShowLogs((v) => !v)}
            title="Toggle logs"
          >
            📋
          </button>
        </div>
      </div>

      {/* Error banner */}
      {status === 'error' && startError && (
        <div className="preview-error">
          <span>⚠️ {startError}</span>
        </div>
      )}

      {/* Log drawer */}
      {showLogs && (
        <div className="preview-logs">
          <pre>{logs || '(no output yet)'}</pre>
          <div ref={logsEndRef} />
        </div>
      )}

      {/* Preview area */}
      <div className="preview-frame-wrapper">
        {status === 'stopped' || status === 'error' ? (
          <div className="preview-placeholder">
            <div className="preview-placeholder-icon">👁</div>
            <p>Click <strong>Run App</strong> to start the dev server and preview your app here.</p>
            {!app.isFullStack && (
              <p className="preview-placeholder-hint">
                Make sure the AI has generated a complete app before running.
              </p>
            )}
          </div>
        ) : status === 'starting' ? (
          <div className="preview-placeholder">
            <div className="preview-spinner-large" />
            <p>Starting dev server…</p>
            <p className="preview-placeholder-hint">Installing dependencies if needed — this may take a moment.</p>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={PREVIEW_URL}
            className="preview-iframe"
            title="App preview"
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
          />
        )}
      </div>
    </div>
  );
}
