import { useRef } from 'react';
import type { AppProject } from '../App';
import { useChatSession } from '../hooks/useChatSession';
import { ChatHeader, ErrorBanners } from './ChatSubComponents';
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
      <ChatHeader
        app={app}
        tokenCount={tokenCount}
        dbStatus={dbStatus}
        onDbToggle={onDbToggle}
        planningMode={planningMode}
        agentMode={agentMode}
        setMode={setMode}
        canRevert={canRevert}
        onRevert={onRevert}
        models={models}
        selectedModel={selectedModel}
        setModelState={setModelState}
        streaming={streaming}
      />

      <ErrorBanners
        error={error}
        detectedErrors={detectedErrors}
        streaming={streaming}
        agentMode={agentMode}
        autoFixAttemptsRef={autoFixAttemptsRef}
        MAX_AUTO_FIX_ATTEMPTS={MAX_AUTO_FIX_ATTEMPTS}
        onRetry={handleRetry}
        onAutoFix={handleAutoFix}
        onDismissErrors={handleDismissErrors}
      />

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
