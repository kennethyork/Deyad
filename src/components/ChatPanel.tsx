import { useState, useEffect, useRef, useCallback } from 'react';
import type { AppProject } from '../App';
import { extractFilesFromResponse, isFullStackRequest, FRONTEND_SYSTEM_PROMPT, getFullStackSystemPrompt } from '../lib/codeParser';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Maximum number of project files to include as context in a chat turn. */
const MAX_CONTEXT_FILES = 20;
/** Maximum characters of a single file to include in context (avoids huge prompts). */
const MAX_CONTEXT_FILE_CHARS = 2000;

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  filesGenerated?: string[];
}

interface Props {
  app: AppProject;
  appFiles: Record<string, string>;
  dbStatus: 'none' | 'running' | 'stopped';
  onFilesUpdated: (files: Record<string, string>) => void;
  onDbToggle: () => void;
  onRevert: () => void;
  canRevert: boolean;
}

export default function ChatPanel({ app, appFiles, dbStatus, onFilesUpdated, onDbToggle, onRevert, canRevert }: Props) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [providerError, setProviderError] = useState('');
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load models and persisted messages on mount / app change
  useEffect(() => {
    setMessages([]);
    loadModels();
    checkDocker();
    loadPersistedMessages();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.id]);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadModels = async () => {
    try {
      const settings = await window.deyad.getSettings();
      const { models: list } = await window.deyad.listModels();
      const names = list.map((m) => m.name);
      setModels(names);
      if (names.length > 0 && !selectedModel) {
        if (settings.defaultModel && names.includes(settings.defaultModel)) {
          setSelectedModel(settings.defaultModel);
        } else {
          setSelectedModel(names[0]);
        }
      }
      setProviderError('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProviderError(msg || 'AI provider is not available. Check Settings.');
    }
  };

  const checkDocker = async () => {
    const available = await window.deyad.checkDocker();
    setDockerAvailable(available);
  };

  const loadPersistedMessages = async () => {
    try {
      const saved = await window.deyad.loadMessages(app.id);
      if (saved.length > 0) setMessages(saved);
    } catch { /* ignore persistence errors */ }
  };

  const persistMessages = async (msgs: UiMessage[]) => {
    try { await window.deyad.saveMessages(app.id, msgs); }
    catch { /* ignore persistence errors */ }
  };

  const buildHistory = useCallback((): ChatMessage[] => {
    let systemPrompt: string;
    if (app.appType === 'fullstack') {
      systemPrompt = getFullStackSystemPrompt(app.dbProvider);
    } else {
      systemPrompt = FRONTEND_SYSTEM_PROMPT;
    }
    const history: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

    // Inject current files as context (truncated for large codebases)
    const fileEntries = Object.entries(appFiles);
    if (fileEntries.length > 0) {
      const codeContext = fileEntries
        .slice(0, MAX_CONTEXT_FILES)
        .map(([path, content]) => `### FILE: ${path}\n\`\`\`\n${content.slice(0, MAX_CONTEXT_FILE_CHARS)}\n\`\`\``)
        .join('\n\n');
      history.push({
        role: 'user',
        content: `Here are the current project files:\n\n${codeContext}`,
      });
      history.push({
        role: 'assistant',
        content: 'I can see the current project files. How can I help you?',
      });
    }

    // Add conversation history
    for (const msg of messages) {
      history.push({ role: msg.role, content: msg.content });
    }
    return history;
  }, [app.appType, app.dbProvider, appFiles, messages]);

  const sendMessage = async () => {
    if (!input.trim() || streaming || !selectedModel) return;

    const userContent = input.trim();
    setInput('');
    const userMsg: UiMessage = { id: Date.now().toString(), role: 'user', content: userContent };
    const msgsWithUser = [...messages, userMsg];
    setMessages(msgsWithUser);

    // Detect if user is asking for full-stack (only show hint if not already full-stack)
    if (app.appType !== 'fullstack' && isFullStackRequest(userContent)) {
      const hint: UiMessage = {
        id: `hint-${Date.now()}`,
        role: 'assistant',
        content: '💡 **Tip:** This sounds like a full-stack request. Create a new app with **Full Stack** mode enabled to get Docker Compose, Prisma, and a complete backend scaffold with your choice of PostgreSQL or MySQL.',
      };
      const msgsWithHint = [...msgsWithUser, hint];
      setMessages(msgsWithHint);
      persistMessages(msgsWithHint);
      return;
    }

    // Start streaming
    const assistantId = `assistant-${Date.now()}`;
    const placeholder: UiMessage = { id: assistantId, role: 'assistant', content: '' };
    const msgsWithPlaceholder = [...msgsWithUser, placeholder];
    setMessages(msgsWithPlaceholder);
    setStreaming(true);

    let fullContent = '';
    const history = buildHistory();
    history.push({ role: 'user', content: userContent });

    const unsubToken = window.deyad.onStreamToken((token) => {
      fullContent += token;
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: fullContent } : m)),
      );
    });

    const unsubDone = window.deyad.onStreamDone(() => {
      setStreaming(false);
      unsubToken();

      // Extract generated files
      const parsed = extractFilesFromResponse(fullContent);
      if (parsed.length > 0) {
        const fileMap: Record<string, string> = {};
        for (const f of parsed) fileMap[f.path] = f.content;
        onFilesUpdated(fileMap);
      }

      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: fullContent, filesGenerated: parsed.length > 0 ? parsed.map((f) => f.path) : undefined }
            : m,
        );
        persistMessages(updated);
        return updated;
      });
    });

    const unsubError = window.deyad.onStreamError((err) => {
      setStreaming(false);
      unsubToken();
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === assistantId ? { ...m, content: `❌ Error: ${err}` } : m,
        );
        persistMessages(updated);
        return updated;
      });
    });

    try {
      await window.deyad.chatStream(selectedModel, history);
    } catch (err) {
      unsubToken();
      unsubDone();
      unsubError();
      setStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="chat-panel">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-left">
          <span className="chat-app-name">
            {app.appType === 'fullstack' ? '🗄️' : '⚡'} {app.name}
          </span>
          {app.description && <span className="chat-app-desc">{app.description}</span>}
        </div>
        <div className="chat-header-right">
          {/* Revert button */}
          {canRevert && (
            <button
              className="btn-revert"
              onClick={onRevert}
              title="Undo last AI changes — restore files to their state before the most recent generation"
            >
              ↩ Undo
            </button>
          )}

          {/* DB controls for full-stack apps */}
          {app.appType === 'fullstack' && (
            <div className="db-status">
              {dockerAvailable === false && (
                <span className="db-warning" title="Docker not found">⚠️ No Docker</span>
              )}
              <span className={`db-indicator ${dbStatus}`}>
                {dbStatus === 'running' ? '🟢' : dbStatus === 'stopped' ? '🔴' : '⚪'}
                {app.dbProvider === 'postgresql' ? ' PostgreSQL' : ' MySQL'}
              </span>
              <button
                className={`btn-db ${dbStatus === 'running' ? 'running' : ''}`}
                onClick={onDbToggle}
                disabled={dockerAvailable === false}
                title={dbStatus === 'running' ? 'Stop database' : 'Start database'}
              >
                {dbStatus === 'running' ? '⏹ Stop DB' : '▶ Start DB'}
              </button>
            </div>
          )}

          {/* Model selector */}
          {models.length > 0 ? (
            <select
              className="model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <span className="no-models">No models</span>
          )}
        </div>
      </div>

      {/* Ollama error banner */}
      {providerError && (
        <div className="error-banner">
          <span>⚠️ {providerError}</span>
          <button onClick={loadModels} className="btn-retry">Retry</button>
        </div>
      )}

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <p className="chat-welcome-title">
              {app.appType === 'fullstack'
                ? `🗄️ Full-Stack App — React + Express + ${app.dbProvider === 'postgresql' ? 'PostgreSQL' : 'MySQL'}`
                : '⚡ Frontend App — React + Vite'}
            </p>
            <p className="chat-welcome-sub">Describe what you want to build and I'll generate the code.</p>
            {app.appType === 'fullstack' && (
              <>
                <div className="stack-badge-row">
                  <span className="stack-badge">React</span>
                  <span className="stack-badge">Express</span>
                  <span className="stack-badge stack-badge-db">{app.dbProvider === 'postgresql' ? 'PostgreSQL 16' : 'MySQL 8'}</span>
                  <span className="stack-badge">Prisma</span>
                  <span className="stack-badge">Docker</span>
                </div>
                <div className="chat-guide">
                  <p className="chat-guide-title">📖 Quick-start guide</p>
                  <ol className="chat-guide-steps">
                    <li>Click <strong>▶ Start DB</strong> above to spin up {app.dbProvider === 'postgresql' ? 'PostgreSQL' : 'MySQL'} via Docker</li>
                    <li>Chat with the AI to add models, routes &amp; UI</li>
                    <li>Open a terminal in <code>backend/</code> and run:<br />
                      <code>npm install &amp;&amp; npx prisma db push &amp;&amp; npm run dev</code></li>
                    <li>Open a terminal in <code>frontend/</code> and run:<br />
                      <code>npm install &amp;&amp; npm run dev</code></li>
                  </ol>
                  <p className="chat-guide-hint">
                    💡 DB credentials are in <code>backend/.env</code> · Prisma schema is at <code>backend/prisma/schema.prisma</code>
                  </p>
                </div>
              </>
            )}
            <div className="chat-suggestions">
              {app.appType === 'fullstack' ? (
                <>
                  <button className="suggestion" onClick={() => setInput('Add a users table with email and name, and REST endpoints for CRUD operations')}>
                    Add users table with CRUD
                  </button>
                  <button className="suggestion" onClick={() => setInput('Create a products table with name, price, and stock, plus API endpoints and a React UI to manage them')}>
                    Products management UI
                  </button>
                  <button className="suggestion" onClick={() => setInput('Update the Prisma schema to add a todo list with title, completed boolean, and due date')}>
                    Todo list schema
                  </button>
                </>
              ) : (
                <>
                  <button className="suggestion" onClick={() => setInput('Create a simple todo list app with add, complete, and delete functionality')}>
                    Todo list app
                  </button>
                  <button className="suggestion" onClick={() => setInput('Build a responsive landing page with a hero section, features grid, and contact form')}>
                    Landing page
                  </button>
                  <button className="suggestion" onClick={() => setInput('Make a markdown notes editor where I can write and preview markdown in real-time')}>
                    Markdown editor
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`message message-${msg.role}`}>
            <div className="message-avatar">
              {msg.role === 'user' ? '👤' : '🤖'}
            </div>
            <div className="message-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {msg.content || (streaming && msg.role === 'assistant' ? '▋' : '')}
              </ReactMarkdown>
              {msg.filesGenerated && msg.filesGenerated.length > 0 && (
                <div className="files-generated">
                  <span className="files-generated-label">📁 Files updated:</span>
                  {msg.filesGenerated.map((f) => (
                    <span key={f} className="file-chip">{f}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {streaming && (
          <div className="streaming-indicator">
            <span className="dot" /><span className="dot" /><span className="dot" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="chat-input-area">
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            models.length === 0
              ? 'Configure Ollama in Settings to use chat…'
              : `Message ${selectedModel || 'Ollama'}… (Enter to send, Shift+Enter for newline)`
          }
          disabled={models.length === 0 || streaming}
          rows={3}
        />
        <button
          className="btn-send"
          onClick={sendMessage}
          disabled={!input.trim() || streaming || models.length === 0}
        >
          {streaming ? '⏳' : '↑'}
        </button>
      </div>
    </div>
  );
}
