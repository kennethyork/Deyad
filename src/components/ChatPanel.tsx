import { useRef } from 'react';
import type { AppProject } from '../App';
import { getErrorHint } from '../lib/errorDetector';
import { useChatSession } from '../hooks/useChatSession';
import MessageList from './MessageList';
import AgentStepsList from './AgentStepsList';
import ChatInput from './ChatInput';

interface Props {
  app: AppProject;
  appFiles: Record<string, string>;
  selectedFile?: string | null;
  dbStatus: 'none' | 'running' | 'stopped';
  onFilesUpdated: (files: Record<string, string>) => void;
  onDbToggle: () => void;
  onRevert: () => void;
  canRevert: boolean;
  initialPrompt?: string | null;
  onInitialPromptConsumed?: () => void;
}

export default function ChatPanel({
  app,
  appFiles,
  selectedFile,
  dbStatus,
  onFilesUpdated,
  onDbToggle,
  onRevert,
  canRevert,
  initialPrompt,
  onInitialPromptConsumed,
}: Props) {
  const session = useChatSession({
    app,
    appFiles,
    selectedFile,
    dbStatus,
    onFilesUpdated,
    initialPrompt,
    onInitialPromptConsumed,
  });

  const {
    messages, input, setInput, streaming,
    models, selectedModel, setModelState,
    error, mode, setMode, planningMode, agentMode,
    agentSteps, pendingPlan, imageAttachment, setImageAttachment,
    bottomRef, detectedErrors, autoFixAttemptsRef, MAX_AUTO_FIX_ATTEMPTS,
    tokenCount, handleSend, handleStopAgent, handleApprovePlan,
    handleRejectPlan, handleRetry, handleAutoFix, handleDismissErrors,
    handleImagePaste,
  } = session;

  const messagesRef = useRef<HTMLDivElement>(null);

  return (
    <div className="chat-panel" tabIndex={0}>
      {/* Header */}
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

      {/* Error banner */}
      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button className="btn-retry" onClick={handleRetry}>
            Retry
          </button>
        </div>
      )}

      {/* Detected errors from dev server */}
      {detectedErrors.length > 0 && !streaming && (
        <div className="error-detection-banner">
          <div className="error-detection-header">
            <span>⚠️ {detectedErrors.length} error{detectedErrors.length > 1 ? 's' : ''} detected</span>
            <div className="error-detection-actions">
              {agentMode && autoFixAttemptsRef.current < MAX_AUTO_FIX_ATTEMPTS ? (
                <span className="auto-verify-status">🔄 Auto-fixing ({autoFixAttemptsRef.current + 1}/{MAX_AUTO_FIX_ATTEMPTS})…</span>
              ) : (
                <button className="btn-auto-fix" onClick={handleAutoFix}>
                  🔧 Auto-fix
                </button>
              )}
              <button className="btn-dismiss-errors" onClick={handleDismissErrors}>
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

      {/* Messages area — positioned container guarantees scroll */}
      <div className="chat-messages-container">
        <div ref={messagesRef} className="chat-messages" role="log" aria-live="polite" aria-label="Chat messages">
          {messages.length === 0 && (
          <div className="chat-welcome">
            <div className="chat-welcome-title">Start building with AI</div>
            <div className="chat-welcome-sub">
              Describe what you want to build and the AI will generate code for your{' '}
              {app.appType === 'fullstack' ? 'full-stack' : 'frontend'} app.
            </div>
            <div className="stack-badge-row">
              <span className="stack-badge">React</span>
              <span className="stack-badge">Vite</span>
              <span className="stack-badge">TypeScript</span>
              {app.appType === 'fullstack' && (
                <>
                  <span className="stack-badge">Express</span>
                  <span className="stack-badge">Prisma</span>
                  <span className={`stack-badge stack-badge-db`}>
                    SQLite
                  </span>
                </>
              )}
            </div>
            <div className="chat-guide">
              <div className="chat-guide-title">Quick Start</div>
              <ol className="chat-guide-steps">
                <li>Type a prompt like <code>make a todo app</code></li>
                <li>AI generates files and applies them to your project</li>
                <li>Switch to the Preview tab to see it running</li>
              </ol>
              <p className="chat-guide-hint">
                Tip: Use <code>Plan</code> mode to review changes before they're applied.
              </p>
            </div>
          </div>
        )}

        <MessageList
          messages={messages}
          pendingPlan={pendingPlan}
          streaming={streaming}
          onApprovePlan={handleApprovePlan}
          onRejectPlan={handleRejectPlan}
        />

        {agentMode && agentSteps.length > 0 && (
          <AgentStepsList steps={agentSteps} />
        )}

        {streaming && (
          <div className="streaming-indicator">
            <div className="dot" />
            <div className="dot" />
            <div className="dot" />
          </div>
        )}

        <div ref={bottomRef} />
        </div>
      </div>

      <ChatInput
        input={input}
        setInput={setInput}
        streaming={streaming}
        agentMode={agentMode}
        imageAttachment={imageAttachment}
        setImageAttachment={setImageAttachment}
        onSend={handleSend}
        onStop={handleStopAgent}
        onImagePaste={handleImagePaste}
      />
    </div>
  );
}
