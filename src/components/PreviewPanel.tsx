import { useState, useEffect, useRef } from 'react';
import type { AppProject } from '../App';

const FALLBACK_URL = 'http://localhost:5173';

type DevStatus = 'stopped' | 'starting' | 'running' | 'error';

interface Props {
  app: AppProject;
  onPublish: () => void;
  refreshKey?: number;
}

export default function PreviewPanel({ app, onPublish, refreshKey }: Props) {
  const [status, setStatus] = useState<DevStatus>('stopped');
  const [logs, setLogs] = useState<string>('');
  const [showLogs, setShowLogs] = useState(false);
  const [startError, setStartError] = useState('');
  const [previewUrl, setPreviewUrl] = useState(FALLBACK_URL);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Subscribe to dev-server log and status events
  useEffect(() => {
    const unsubLog = window.deyad.onAppDevLog(({ appId, data }) => {
      if (appId !== app.id) return;
      setLogs((prev) => prev + data);
      // Auto-detect "ready" from Vite output and extract the actual URL
      const urlMatch = data.match(/https?:\/\/localhost:\d+/);
      if (urlMatch) {
        setPreviewUrl(urlMatch[0]);
        setStatus('running');
      } else if (data.includes('Local:')) {
        setStatus('running');
      }
    });

    const unsubStatus = window.deyad.onAppDevStatus(({ appId, status: s }) => {
      if (appId !== app.id) return;
      if (s === 'stopped') setStatus('stopped');
      if (s === 'starting') {
        setStatus('starting');
        setPreviewUrl(FALLBACK_URL);
      }
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

  // Auto-refresh iframe when files are written by the agent
  const prevRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey !== prevRefreshKey.current && status === 'running' && iframeRef.current) {
      // Small delay to let Vite process the file change
      const timer = setTimeout(() => {
        if (iframeRef.current) iframeRef.current.src = previewUrl;
      }, 500);
      prevRefreshKey.current = refreshKey;
      return () => clearTimeout(timer);
    }
    prevRefreshKey.current = refreshKey;
  }, [refreshKey, status, previewUrl]);

  // Reset when switching apps — check actual server status
  useEffect(() => {
    setLogs('');
    setStartError('');
    setPreviewUrl(FALLBACK_URL);
    window.deyad.appDevStatus(app.id).then((res: { status: string }) => {
      if (res.status === 'running') {
        setStatus('running');
      } else {
        setStatus('stopped');
      }
    }).catch(() => setStatus('stopped'));
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
      iframeRef.current.src = previewUrl;
    }
  };

  return (
    <div className="preview-panel">
      {/* Toolbar */}
      <div className="preview-toolbar">
        <span className="preview-url">{previewUrl}</span>

        <div className="preview-toolbar-actions">
          {status === 'running' && (
            <button className="btn-preview-action" onClick={handleRefresh} title="Refresh preview">
              Refresh
            </button>
          )}
          {(status === 'stopped' || status === 'error') && (
            <button className="btn-preview-run" onClick={handleStart}>
              Run App
            </button>
          )}
          {status === 'starting' && (
            <button className="btn-preview-run starting" disabled>
              <span className="preview-spinner" /> Starting…
            </button>
          )}
          {status === 'running' && (
            <button className="btn-preview-stop" onClick={handleStop}>
              Stop
            </button>
          )}
          <button
            className={`btn-preview-logs ${showLogs ? 'active' : ''}`}
            onClick={() => setShowLogs((v) => !v)}
            title="Toggle logs"
          >
            Logs
          </button>
          <button
            className="btn-preview-publish"
            onClick={onPublish}
            title="Deploy to web"
          >
            Publish
          </button>
        </div>
      </div>

      {/* Error banner */}
      {status === 'error' && startError && (
        <div className="preview-error">
          <span>{startError}</span>
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
            <div className="preview-placeholder-icon"></div>
            <p>Click <strong>Run App</strong> to start the dev server and preview your app here.</p>
            {app.appType !== 'fullstack' && (
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
            src={previewUrl}
            className="preview-iframe"
            title="App preview"
            sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"
          />
        )}
      </div>
    </div>
  );
}
