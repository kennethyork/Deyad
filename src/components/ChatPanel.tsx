import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AppProject } from '../App';
import { buildSmartContext } from '../lib/contextBuilder';
import { extractFilesFromResponse, FRONTEND_SYSTEM_PROMPT, getFullStackSystemPrompt, PLANNING_SYSTEM_PROMPT, PLAN_EXECUTION_PROMPT } from '../lib/codeParser';

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  filesGenerated?: string[];
  model?: string;
}

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
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [planningMode, setPlanningMode] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const streamBuf = useRef('');
  const assistantIdRef = useRef('');
  const streamCleanupRef = useRef<(() => void) | null>(null);

  // Clean up stream listeners on unmount
  useEffect(() => {
    return () => {
      streamCleanupRef.current?.();
    };
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load models on mount
  useEffect(() => {
    loadModels();
  }, []);

  // Load saved messages when app changes
  useEffect(() => {
    (async () => {
      try {
        const saved = await window.deyad.loadMessages(app.id);
        setMessages(saved || []);
      } catch {
        setMessages([]);
      }
    })();
  }, [app.id]);

  // Handle initial prompt from template
  useEffect(() => {
    if (initialPrompt && !streaming) {
      setInput(initialPrompt);
      onInitialPromptConsumed?.();
      // Auto-send after a tick so state settles
      setTimeout(() => {
        sendMessage(initialPrompt);
      }, 100);
    }
  }, [initialPrompt]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadModels = async () => {
    try {
      const { models: list } = await window.deyad.listModels();
      const names = list.map((m) => m.name);
      setModels(names);
      // Try to use saved default model
      const settings = await window.deyad.getSettings();
      if (settings.defaultModel && names.includes(settings.defaultModel)) {
        setSelectedModel(settings.defaultModel);
      } else if (names.length > 0) {
        setSelectedModel(names[0]);
      }
    } catch {
      setError('Could not connect to Ollama. Make sure it is running.');
    }
  };

  const saveMessages = useCallback(
    (msgs: UiMessage[]) => {
      window.deyad.saveMessages(app.id, msgs).catch(() => {});
    },
    [app.id],
  );

  const getSystemPrompt = (): string => {
    if (planningMode && !pendingPlan) return PLANNING_SYSTEM_PROMPT;
    if (app.appType === 'fullstack') return getFullStackSystemPrompt(app.dbProvider);
    return FRONTEND_SYSTEM_PROMPT;
  };

  const sendMessage = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || streaming) return;

    if (!selectedModel) {
      setError('No model selected. Make sure Ollama is running and has at least one model.');
      return;
    }

    setError(null);
    setInput('');

    // Add user message
    const userMsg: UiMessage = { id: Date.now().toString(), role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    // Build context from project files
    const context = buildSmartContext({
      files: appFiles,
      selectedFile,
      userMessage: text,
    });

    // Build Ollama message history
    const systemPrompt = getSystemPrompt();
    const ollamaMessages: { role: 'user' | 'assistant' | 'system'; content: string }[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Add context as a system message if we have project files
    if (context) {
      ollamaMessages.push({
        role: 'system' as const,
        content: `Here are the current project files:\n\n${context}`,
      });
    }

    // Include recent conversation history (last 10 messages for context window)
    const recentMessages = newMessages.slice(-10);
    for (const msg of recentMessages) {
      ollamaMessages.push({ role: msg.role, content: msg.content });
    }

    // If executing an approved plan, append the execution instruction
    if (pendingPlan) {
      ollamaMessages.push({ role: 'user', content: PLAN_EXECUTION_PROMPT });
      setPendingPlan(null);
    }

    // Prepare streaming
    const assistantId = (Date.now() + 1).toString();
    assistantIdRef.current = assistantId;
    streamBuf.current = '';
    setStreaming(true);

    // Add placeholder assistant message
    const assistantMsg: UiMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      model: selectedModel,
    };
    setMessages((prev) => [...prev, assistantMsg]);

    // Set up stream listeners
    const unsubToken = window.deyad.onStreamToken((token: string) => {
      streamBuf.current += token;
      const currentContent = streamBuf.current;
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: currentContent } : m)),
      );
    });

    const onDone = () => {
      streamCleanupRef.current = null;
      const finalContent = streamBuf.current;

      // Extract any generated files from the response
      const parsed = extractFilesFromResponse(finalContent);

      if (parsed.length > 0) {
        const fileMap: Record<string, string> = {};
        for (const f of parsed) fileMap[f.path] = f.content;
        onFilesUpdated(fileMap);

        // Update message with file info
        setMessages((prev) => {
          const updated = prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: finalContent, filesGenerated: parsed.map((f) => f.path) }
              : m,
          );
          saveMessages(updated);
          return updated;
        });
      } else {
        setMessages((prev) => {
          const updated = prev.map((m) =>
            m.id === assistantId ? { ...m, content: finalContent } : m,
          );
          saveMessages(updated);
          return updated;
        });
      }

      // Check if this is a plan response
      if (planningMode && finalContent.includes('## Plan')) {
        setPendingPlan(finalContent);
      }

      setStreaming(false);
    };

    const unsubDone = window.deyad.onStreamDone(onDone);

    const unsubError = window.deyad.onStreamError((err: string) => {
      streamCleanupRef.current = null;
      setError(`Ollama error: ${err}`);
      setStreaming(false);
    });

    // Store cleanup so unmount can tear down listeners
    const cleanup = () => {
      unsubToken();
      unsubDone();
      unsubError();
    };
    streamCleanupRef.current = cleanup;

    try {
      await window.deyad.chatStream(selectedModel, ollamaMessages);
    } catch (err) {
      setError(`Failed to connect to Ollama: ${err instanceof Error ? err.message : String(err)}`);
      setStreaming(false);
    }

    // Cleanup listeners once stream completes normally
    cleanup();
    streamCleanupRef.current = null;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleApprovePlan = () => {
    if (pendingPlan) {
      sendMessage('Execute the plan above.');
    }
  };

  const handleRejectPlan = () => {
    setPendingPlan(null);
  };

  const handleRetry = () => {
    setError(null);
    loadModels();
  };

  return (
    <div className="chat-panel" tabIndex={0}>
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-left">
          <span className="chat-app-name">{app.name}</span>
          <span className="chat-app-desc">{app.description}</span>
        </div>
        <div className="chat-header-right">
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
            onClick={() => setPlanningMode((v) => !v)}
            title="Toggle planning mode"
          >
            {planningMode ? 'Plan ON' : 'Plan'}
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
              onChange={(e) => setSelectedModel(e.target.value)}
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

      {/* Messages area — positioned container guarantees scroll */}
      <div className="chat-messages-container">
        <div ref={messagesRef} className="chat-messages">
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
                    {app.dbProvider === 'postgresql' ? 'PostgreSQL' : 'MySQL'}
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

        {messages.map((m) => (
          <div key={m.id} className={`message message-${m.role}`}>
            <div className="message-avatar">{m.role === 'user' ? '👤' : '🤖'}</div>
            <div className="message-body">
              {m.model && <span className="model-badge">{m.model}</span>}
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              {m.filesGenerated && m.filesGenerated.length > 0 && (
                <div className="files-generated">
                  <span className="files-generated-label">Files:</span>
                  {m.filesGenerated.map((f) => (
                    <span key={f} className="file-chip">
                      {f}
                    </span>
                  ))}
                </div>
              )}
              {/* Plan approval buttons */}
              {pendingPlan && m.content === pendingPlan && (
                <div className="plan-actions">
                  <button className="btn-approve-plan" onClick={handleApprovePlan} disabled={streaming}>
                    ✓ Approve &amp; Execute
                  </button>
                  <button className="btn-reject-plan" onClick={handleRejectPlan} disabled={streaming}>
                    ✗ Reject
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

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

      {/* Input area */}
      <div className="chat-input-area">
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder={streaming ? 'AI is responding…' : 'Describe what you want to build…'}
          disabled={streaming}
        />
        <button className="btn-send" onClick={() => sendMessage()} disabled={streaming || !input.trim()}>
          ↑
        </button>
      </div>
    </div>
  );
}
