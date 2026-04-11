import type { AppProject } from '../App';
import type { DetectedError } from '../lib/errorDetector';
import { getErrorHint } from '../lib/errorDetector';

interface ChatHeaderProps {
  app: AppProject;
  tokenCount: number;
  dbStatus: 'none' | 'running' | 'stopped';
  onDbToggle: () => void;
  planningMode: boolean;
  agentMode: boolean;
  setMode: React.Dispatch<React.SetStateAction<"chat" | "planning" | "agent">>;
  canRevert: boolean;
  onRevert: () => void;
  models: string[];
  selectedModel: string;
  setModelState: React.Dispatch<React.SetStateAction<{ models: string[]; selectedModel: string }>>;
  streaming: boolean;
}

export function ChatHeader({
  app, tokenCount, dbStatus, onDbToggle,
  planningMode, agentMode, setMode,
  canRevert, onRevert,
  models, selectedModel, setModelState, streaming,
}: ChatHeaderProps) {
  return (
    <div className="chat-header">
      <div className="chat-header-left">
        <span className="chat-app-name">{app.name}</span>
        <span className="chat-app-desc">{app.description}</span>
      </div>
      <div className="chat-header-right">
        {tokenCount > 0 && (
          <span className="token-counter" title="Estimated tokens in conversation">
            ~{tokenCount > 1000 ? `${(tokenCount / 1000).toFixed(1)}k` : tokenCount} tokens
          </span>
        )}
        {app.appType === 'fullstack' && (
          <div className="db-status">
            <span className={`db-indicator ${dbStatus}`}>
              {dbStatus === 'running' ? 'DB Running' : dbStatus === 'stopped' ? 'DB Stopped' : ''}
            </span>
            {dbStatus !== 'none' && (
              <button className={`btn-db ${dbStatus}`} onClick={onDbToggle}>
                {dbStatus === 'running' ? 'Stop' : 'Start'}
              </button>
            )}
          </div>
        )}
        <button
          className={`btn-plan-mode ${planningMode ? 'active' : ''}`}
          onClick={() => setMode(m => m === 'planning' ? 'chat' : 'planning')}
          title="Toggle planning mode"
        >
          {planningMode ? 'Plan ON' : 'Plan'}
        </button>
        <button
          className={`btn-agent-mode ${agentMode ? 'active' : ''}`}
          onClick={() => setMode(m => m === 'agent' ? 'chat' : 'agent')}
          title="Toggle autonomous agent mode"
        >
          {agentMode ? 'Agent ON' : 'Agent'}
        </button>
        {canRevert && (
          <button className="btn-db" onClick={onRevert} title="Undo last AI change">
            Undo
          </button>
        )}
        {models.length > 0 ? (
          <select
            className="model-select"
            value={selectedModel}
            onChange={(e) => setModelState(s => ({ ...s, selectedModel: e.target.value }))}
            disabled={streaming}
            aria-label="Select AI model"
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <span className="no-models">No models</span>
        )}
      </div>
    </div>
  );
}

interface ErrorBannersProps {
  error: string | null;
  detectedErrors: DetectedError[];
  streaming: boolean;
  agentMode: boolean;
  autoFixAttemptsRef: React.MutableRefObject<number>;
  MAX_AUTO_FIX_ATTEMPTS: number;
  onRetry: () => void;
  onAutoFix: () => void;
  onDismissErrors: () => void;
}

export function ErrorBanners({
  error, detectedErrors, streaming, agentMode,
  autoFixAttemptsRef, MAX_AUTO_FIX_ATTEMPTS,
  onRetry, onAutoFix, onDismissErrors,
}: ErrorBannersProps) {
  return (
    <>
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button className="btn-retry" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      {detectedErrors.length > 0 && !streaming && (
        <div className="error-detection-banner" role="alert">
          <div className="error-detection-header">
            <span>⚠️ {detectedErrors.length} error{detectedErrors.length > 1 ? 's' : ''} detected</span>
            <div className="error-detection-actions">
              {agentMode && autoFixAttemptsRef.current < MAX_AUTO_FIX_ATTEMPTS ? (
                <span className="auto-verify-status">🔄 Auto-fixing ({autoFixAttemptsRef.current + 1}/{MAX_AUTO_FIX_ATTEMPTS})…</span>
              ) : (
                <button className="btn-auto-fix" onClick={onAutoFix}>
                  🔧 Auto-fix
                </button>
              )}
              <button className="btn-dismiss-errors" onClick={onDismissErrors} aria-label="Dismiss errors">
                ✕
              </button>
            </div>
          </div>
          <div className="error-detection-list">
            {detectedErrors.slice(0, 3).map((e, i) => (
              <div key={i} className="error-detection-item">
                <span className="error-type-badge">{e.type}</span>
                <span className="error-msg">{e.message.slice(0, 120)}</span>
                {(() => {
                  const hint = getErrorHint(e);
                  return hint ? <div className="error-hint">💡 {hint}</div> : null;
                })()}
              </div>
            ))}
            {detectedErrors.length > 3 && (
              <div className="error-detection-more">+{detectedErrors.length - 3} more</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
