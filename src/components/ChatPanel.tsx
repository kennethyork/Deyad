import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { AppProject } from '../App';
import { buildSmartContext } from '../lib/contextBuilder';
import { extractFilesFromResponse, FRONTEND_SYSTEM_PROMPT, getFullStackSystemPrompt, PLANNING_SYSTEM_PROMPT, PLAN_EXECUTION_PROMPT } from '../lib/codeParser';
import { runAgentLoop } from '../lib/agentLoop';
import { stripToolMarkup } from '../lib/agentTools';
import type { ToolResult } from '../lib/agentTools';
import { detectErrors, buildErrorFixPrompt, getErrorHint } from '../lib/errorDetector';
import type { DetectedError } from '../lib/errorDetector';
import MessageList from './MessageList';
import AgentStepsList from './AgentStepsList';
import ChatInput from './ChatInput';

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
  const [agentMode, setAgentMode] = useState(false);
  const [agentSteps, setAgentSteps] = useState<Array<{ type: 'tool' | 'result'; text: string }>>([]);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [imageAttachment, setImageAttachment] = useState<string | null>(null); // base64 data URI
  const messagesRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const streamBuf = useRef('');
  const assistantIdRef = useRef('');
  const streamCleanupRef = useRef<(() => void) | null>(null);
  const agentAbortRef = useRef<(() => void) | null>(null);
  const [detectedErrors, setDetectedErrors] = useState<DetectedError[]>([]);
  const autoFixAttemptsRef = useRef(0);
  const autoFixTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_AUTO_FIX_ATTEMPTS = 3;
  const embedModelRef = useRef('');
  const modelOptionsRef = useRef<{ temperature: number; top_p: number; repeat_penalty: number }>({ temperature: 0.7, top_p: 0.9, repeat_penalty: 1.1 });
  const rafRef = useRef<number>(0);

  // Clean up stream listeners on unmount
  useEffect(() => {
    return () => {
      streamCleanupRef.current?.();
      agentAbortRef.current?.();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Listen to dev server logs for error auto-detection
  useEffect(() => {
    const unsub = window.deyad.onAppDevLog(({ appId, data }) => {
      if (appId !== app.id) return;
      const errors = detectErrors(data);
      if (errors.length > 0) {
        setDetectedErrors((prev) => {
          // Dedup by message
          const existing = new Set(prev.map((e) => e.message));
          const fresh = errors.filter((e) => !existing.has(e.message));
          return fresh.length > 0 ? [...prev, ...fresh].slice(-10) : prev;
        });
      }
    });
    return unsub;
  }, [app.id]);

  // Reset auto-fix counter when agent mode is toggled
  useEffect(() => {
    autoFixAttemptsRef.current = 0;
  }, [agentMode]);

  // Auto-verify: in agent mode, automatically send detected errors to AI for fixing
  useEffect(() => {
    if (!agentMode || streaming || detectedErrors.length === 0) return;
    if (autoFixAttemptsRef.current >= MAX_AUTO_FIX_ATTEMPTS) return;

    // Debounce 2s to batch errors from dev server
    if (autoFixTimerRef.current) clearTimeout(autoFixTimerRef.current);
    autoFixTimerRef.current = setTimeout(async () => {
      autoFixAttemptsRef.current++;
      // Re-read files from disk to avoid stale closure data
      const freshFiles = await window.deyad.readFiles(app.id);
      const prompt = buildErrorFixPrompt(detectedErrors, freshFiles);
      setDetectedErrors([]);
      sendAgentMessage(prompt);
    }, 2000);

    return () => {
      if (autoFixTimerRef.current) clearTimeout(autoFixTimerRef.current);
    };
  }, [agentMode, streaming, detectedErrors, app.id]);

  // Estimate token count from conversation (derived, no extra state)
  const tokenCount = useMemo(() => {
    let chars = 0;
    for (const m of messages) chars += m.content.length;
    return Math.round(chars / 3.5);
  }, [messages]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: streaming ? 'auto' : 'smooth' });
  }, [messages, streaming]);

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
      } catch (err) {
        console.debug('Handled error:', err);
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

  const loadModels = async (retries = 3) => {
    for (let attempt = 0; attempt < retries; attempt++) {
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
        if (settings.embedModel) {
          embedModelRef.current = settings.embedModel;
        }
        modelOptionsRef.current = {
          temperature: settings.temperature ?? 0.7,
          top_p: settings.topP ?? 0.9,
          repeat_penalty: settings.repeatPenalty ?? 1.1,
        };
        setError(null);
        return;
      } catch (err) {
        console.debug('Handled error:', err);
        if (attempt < retries - 1) {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }
    setError('Could not connect to Ollama. Make sure it is running.');
  };

  const saveMessages = useCallback(
    (msgs: UiMessage[]) => {
      window.deyad.saveMessages(app.id, msgs).catch((err) => console.warn('Failed to save messages:', err));
    },
    [app.id],
  );

  const getSystemPrompt = (): string => {
    if (planningMode && !pendingPlan) return PLANNING_SYSTEM_PROMPT;
    if (app.appType === 'fullstack') return getFullStackSystemPrompt();
    return FRONTEND_SYSTEM_PROMPT;
  };

  const handleImagePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = () => setImageAttachment(reader.result as string);
          reader.readAsDataURL(file);
          e.preventDefault();
        }
        break;
      }
    }
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
    if (imageAttachment) {
      userMsg.content = `[Image attached]\n\n${text}`;
    }
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
    const ollamaMessages: { role: 'user' | 'assistant' | 'system'; content: string; images?: string[] }[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Add context as a system message if we have project files
    if (context) {
      ollamaMessages.push({
        role: 'system' as const,
        content: `Here are the current project files:\n\n${context}`,
      });
    }

    // If the database is running, fetch and inject the live schema
    if (dbStatus === 'running' && app.appType === 'fullstack') {
      try {
        const schema = await window.deyad.dbDescribe(app.id);
        if (schema.tables.length > 0) {
          const schemaText = schema.tables
            .map((t) => `  ${t.name}: ${t.columns.join(', ')}`)
            .join('\n');
          ollamaMessages.push({
            role: 'system' as const,
            content: `The database is running (SQLite via Prisma). Current schema:\n${schemaText}\n\nUse this schema when generating backend code, API routes, or Prisma queries.`,
          });
        }
      } catch (err) {
        console.debug('DB describe failed — continue without schema context:', err);
      }
    }

    // Include recent conversation history (last 10 messages for context window)
    const recentMessages = newMessages.slice(-10);
    for (const msg of recentMessages) {
      ollamaMessages.push({ role: msg.role, content: msg.content });
    }

    // If image attached, add to the last user message for vision models
    if (imageAttachment) {
      const lastIdx = ollamaMessages.length - 1;
      if (ollamaMessages[lastIdx]?.role === 'user') {
        // For Ollama vision models: strip data URI prefix, pass raw base64
        const base64 = imageAttachment.replace(/^data:image\/[^;]+;base64,/, '');
        ollamaMessages[lastIdx].images = [base64];
        ollamaMessages[lastIdx].content = `The user has attached a screenshot or design mockup (possibly from Figma, a wireframe, or a UI screenshot). Your task:

1. Analyze the layout, spacing, typography, colors, icons, and component hierarchy precisely.
2. Recreate the UI as pixel-perfect React + TypeScript + CSS code.
3. Use semantic HTML elements, CSS variables for colors, and responsive flexbox/grid layouts.
4. Match exact colors (extract hex values from the image), font sizes, border radii, and spacing.
5. If it looks like a multi-page design, implement navigation between views.
6. Add hover states, transitions, and interactive behavior where visually implied.

User's instructions: ${text}`;
      }
      setImageAttachment(null);
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
    const requestId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const unsubToken = window.deyad.onStreamToken(requestId, (token: string) => {
      streamBuf.current += token;
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          const snapshot = streamBuf.current;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: snapshot } : m)),
          );
        });
      }
    });

    // Store cleanup so unmount can tear down listeners
    const cleanup = () => {
      unsubToken();
      unsubDone();
      unsubError();
      streamCleanupRef.current = null;
    };

    const onDone = () => {
      cleanup();
      // Cancel any pending RAF — we'll set the final content directly
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
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

    const unsubDone = window.deyad.onStreamDone(requestId, onDone);

    const unsubError = window.deyad.onStreamError(requestId, (err: string) => {
      cleanup();
      setError(`Ollama error: ${err}`);
      setStreaming(false);
    });

    streamCleanupRef.current = cleanup;

    window.deyad.chatStream(selectedModel, ollamaMessages, requestId, modelOptionsRef.current).catch((err) => {
      cleanup();
      setError(`Failed to connect to Ollama: ${err instanceof Error ? err.message : String(err)}`);
      setStreaming(false);
    });
  };

  const sendAgentMessage = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || streaming) return;

    if (!selectedModel) {
      setError('No model selected. Make sure Ollama is running and has at least one model.');
      return;
    }

    setError(null);
    setInput('');
    setAgentSteps([]);
    // Reset auto-fix counter on new user-initiated message
    if (!overrideText) autoFixAttemptsRef.current = 0;

    // Add user message
    const userMsg: UiMessage = { id: Date.now().toString(), role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    // Add placeholder assistant message
    const assistantId = (Date.now() + 1).toString();
    assistantIdRef.current = assistantId;
    setStreaming(true);

    const assistantMsg: UiMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      model: selectedModel,
    };
    setMessages((prev) => [...prev, assistantMsg]);

    // Build conversation history for agent
    const history = newMessages.slice(-8).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const abort = runAgentLoop({
      appId: app.id,
      appType: app.appType,
      dbProvider: app.dbProvider,
      dbStatus,
      model: selectedModel,
      userMessage: text,
      appFiles,
      selectedFile,
      history,
      embedModel: embedModelRef.current || undefined,
      modelOptions: modelOptionsRef.current,
      callbacks: {
        onContent: (fullText: string) => {
          streamBuf.current = stripToolMarkup(fullText);
          if (!rafRef.current) {
            rafRef.current = requestAnimationFrame(() => {
              rafRef.current = 0;
              const snapshot = streamBuf.current;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: snapshot } : m)),
              );
            });
          }
        },
        onToolStart: (toolName: string, params: Record<string, string>) => {
          const summary = toolName === 'run_command' ? `${toolName}: ${params.command ?? ''}` :
                          toolName === 'read_file' ? `${toolName}: ${params.path ?? ''}` :
                          toolName === 'write_files' ? `${toolName}: ${params.path || Object.keys(params).filter(k => k.endsWith('_path')).map(k => params[k]).join(', ')}` :
                          toolName;
          setAgentSteps((prev) => [...prev, { type: 'tool', text: summary }]);
        },
        onToolResult: (result: ToolResult) => {
          const statusIcon = result.success ? '\u2713' : '\u2717';
          const preview = result.output.length > 120 ? result.output.slice(0, 120) + '...' : result.output;
          setAgentSteps((prev) => [...prev, { type: 'result', text: `${statusIcon} ${result.tool}: ${preview}` }]);
        },
        onFilesWritten: async (files: Record<string, string>) => {
          onFilesUpdated(files);
          // Update the assistant message with generated file info
          const paths = Object.keys(files);
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id === assistantId) {
                const existing = m.filesGenerated || [];
                return { ...m, filesGenerated: [...new Set([...existing, ...paths])] };
              }
              return m;
            }),
          );
        },
        onDone: () => {
          // Flush any pending RAF update
          if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = 0;
            const snapshot = streamBuf.current;
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: snapshot } : m)),
            );
          }
          setStreaming(false);
          agentAbortRef.current = null;
          // Save messages
          setMessages((prev) => {
            saveMessages(prev);
            return prev;
          });
        },
        onError: (error: string) => {
          setError(`Agent error: ${error}`);
          setStreaming(false);
          agentAbortRef.current = null;
        },
      },
    });

    agentAbortRef.current = abort;
  };

  const handleStopAgent = () => {
    agentAbortRef.current?.();
    streamCleanupRef.current?.();
    setStreaming(false);
    setError('Agent stopped by user');
    setAgentSteps((prev) => [...prev, { type: 'result', text: '⏹️ Agent stopped by user' }]);
  };

  const sendRef = useRef<(text?: string) => void>();

  const handleSend = () => {
    const text = input.trim().toLowerCase();
    // Auto-route git commands through the agent loop even when agent mode is off
    const isGitCommand = /\bgit\b/.test(text) && /\b(push|pull|commit|branch|merge|status|log|remote|clone|init|checkout|stash|rebase|diff|reset|tag)\b/.test(text);
    if (agentMode || isGitCommand) sendAgentMessage();
    else sendMessage();
  };

  // Keep ref fresh so memoized callbacks always call the latest send
  sendRef.current = sendMessage;

  const handleApprovePlan = useCallback(() => {
    sendRef.current?.('Execute the plan above.');
  }, []);

  const handleRejectPlan = useCallback(() => {
    setPendingPlan(null);
  }, []);

  const handleRetry = () => {
    setError(null);
    loadModels();
  };

  const handleAutoFix = () => {
    const prompt = buildErrorFixPrompt(detectedErrors, appFiles);
    setDetectedErrors([]);
    if (agentMode) sendAgentMessage(prompt);
    else sendMessage(prompt);
  };

  const handleDismissErrors = () => setDetectedErrors([]);

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
            onClick={() => { setPlanningMode((v) => !v); if (agentMode) setAgentMode(false); }}
            title="Toggle planning mode"
          >
            {planningMode ? 'Plan ON' : 'Plan'}
          </button>
          <button
            className={`btn-agent-mode ${agentMode ? 'active' : ''}`}
            onClick={() => { setAgentMode((v) => !v); if (planningMode) setPlanningMode(false); }}
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
