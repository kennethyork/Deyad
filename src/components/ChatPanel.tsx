import { useState, useEffect, useRef, useCallback } from 'react';
import type { AppProject } from '../App';
import { extractFilesFromResponse, isFullStackRequest, FRONTEND_SYSTEM_PROMPT, FULLSTACK_SYSTEM_PROMPT } from '../lib/codeParser';
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
}

export default function ChatPanel({ app, appFiles, dbStatus, onFilesUpdated, onDbToggle }: Props) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [ollamaError, setOllamaError] = useState('');
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load models on mount / app change
  useEffect(() => {
    setMessages([]);
    loadModels();
    checkDocker();
  }, [app.id]);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadModels = async () => {
    try {
      const { models: list } = await window.deyad.listModels();
      const names = list.map((m) => m.name);
      setModels(names);
      if (names.length > 0 && !selectedModel) {
        setSelectedModel(names[0]);
      }
      setOllamaError('');
    } catch {
      setOllamaError('Ollama is not running. Start Ollama and reload.');
    }
  };

  const checkDocker = async () => {
    const available = await window.deyad.checkDocker();
    setDockerAvailable(available);
  };

  const buildHistory = useCallback((): ChatMessage[] => {
    const systemPrompt = app.isFullStack ? FULLSTACK_SYSTEM_PROMPT : FRONTEND_SYSTEM_PROMPT;
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
  }, [app.isFullStack, appFiles, messages]);

  const sendMessage = async () => {
    if (!input.trim() || streaming || !selectedModel) return;

    const userContent = input.trim();
    setInput('');
    const userMsg: UiMessage = { id: Date.now().toString(), role: 'user', content: userContent };
    setMessages((prev) => [...prev, userMsg]);

    // Detect if user is asking for full-stack (only show hint if not already full-stack)
    if (!app.isFullStack && isFullStackRequest(userContent)) {
      const hint: UiMessage = {
        id: `hint-${Date.now()}`,
        role: 'assistant',
        content: '💡 **Tip:** This sounds like a full-stack request. Create a new app with "Full Stack (React + Express + MySQL)" enabled to get Docker Compose, Prisma, and a complete backend scaffold automatically.',
      };
      setMessages((prev) => [...prev, hint]);
      return;
    }

    // Start streaming
    const assistantId = `assistant-${Date.now()}`;
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '' }]);
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
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, filesGenerated: parsed.map((f) => f.path) }
              : m,
          ),
        );
      }
    });

    const unsubError = window.deyad.onStreamError((err) => {
      setStreaming(false);
      unsubToken();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: `❌ Error: ${err}` } : m,
        ),
      );
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
          <span className="chat-app-name">{app.isFullStack ? '🗄️' : '⚡'} {app.name}</span>
          {app.description && <span className="chat-app-desc">{app.description}</span>}
        </div>
        <div className="chat-header-right">
          {/* DB controls for full-stack apps */}
          {app.isFullStack && (
            <div className="db-status">
              {dockerAvailable === false && (
                <span className="db-warning" title="Docker not found">⚠️ No Docker</span>
              )}
              <span className={`db-indicator ${dbStatus}`}>
                {dbStatus === 'running' ? '🟢' : dbStatus === 'stopped' ? '🔴' : '⚪'}
                {' MySQL'}
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
      {ollamaError && (
        <div className="error-banner">
          <span>⚠️ {ollamaError}</span>
          <button onClick={loadModels} className="btn-retry">Retry</button>
        </div>
      )}

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <p className="chat-welcome-title">
              {app.isFullStack
                ? '🗄️ Full-Stack App — React + Express + MySQL'
                : '⚡ Frontend App — React + Vite'}
            </p>
            <p className="chat-welcome-sub">Describe what you want to build and I'll generate the code.</p>
            {app.isFullStack && (
              <div className="stack-badge-row">
                <span className="stack-badge">React</span>
                <span className="stack-badge">Express</span>
                <span className="stack-badge stack-badge-db">MySQL 8</span>
                <span className="stack-badge">Prisma</span>
                <span className="stack-badge">Docker</span>
              </div>
            )}
            <div className="chat-suggestions">
              {app.isFullStack ? (
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
              ? 'Start Ollama to use chat…'
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
