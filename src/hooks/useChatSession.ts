import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { AppProject } from '../App';
import { buildSmartContext } from '../lib/contextBuilder';
import { extractFilesFromResponse, FRONTEND_SYSTEM_PROMPT, getFullStackSystemPrompt, PLANNING_SYSTEM_PROMPT, PLAN_EXECUTION_PROMPT } from '../lib/codeParser';
import { runAgentLoop } from '../lib/agentLoop';
import { stripToolMarkup } from '../lib/agentTools';
import type { ToolResult } from '../lib/agentTools';
import { detectErrors, buildErrorFixPrompt } from '../lib/errorDetector';
import type { DetectedError } from '../lib/errorDetector';

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  filesGenerated?: string[];
  model?: string;
}

interface UseChatSessionProps {
  app: AppProject;
  appFiles: Record<string, string>;
  selectedFile?: string | null;
  dbStatus: 'none' | 'running' | 'stopped';
  onFilesUpdated: (files: Record<string, string>) => void;
  initialPrompt?: string | null;
  onInitialPromptConsumed?: () => void;
}

export function useChatSession({
  app,
  appFiles,
  selectedFile,
  dbStatus,
  onFilesUpdated,
  initialPrompt,
  onInitialPromptConsumed,
}: UseChatSessionProps) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [modelState, setModelState] = useState({ models: [] as string[], selectedModel: '' });
  const { models, selectedModel } = modelState;
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'chat' | 'planning' | 'agent'>('chat');
  const planningMode = mode === 'planning';
  const agentMode = mode === 'agent';
  const [agentSteps, setAgentSteps] = useState<Array<{ type: 'tool' | 'result'; text: string }>>([]);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [imageAttachment, setImageAttachment] = useState<string | null>(null);
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
  const contextSizeRef = useRef(32768);
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
  }, [mode]);

  // Auto-verify: in agent mode, automatically send detected errors to AI for fixing
  useEffect(() => {
    if (!agentMode || streaming || detectedErrors.length === 0) return;
    if (autoFixAttemptsRef.current >= MAX_AUTO_FIX_ATTEMPTS) return;

    if (autoFixTimerRef.current) clearTimeout(autoFixTimerRef.current);
    autoFixTimerRef.current = setTimeout(async () => {
      autoFixAttemptsRef.current++;
      const freshFiles = await window.deyad.readFiles(app.id);
      const prompt = buildErrorFixPrompt(detectedErrors, freshFiles);
      setDetectedErrors([]);
      sendAgentMessage(prompt);
    }, 2000);

    return () => {
      if (autoFixTimerRef.current) clearTimeout(autoFixTimerRef.current);
    };
  }, [agentMode, streaming, detectedErrors, app.id]);

  // Estimated token count
  const tokenCount = useMemo(() => {
    let chars = 0;
    for (const m of messages) chars += m.content.length;
    return Math.round(chars / 4);
  }, [messages]);

  // Auto-scroll
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
      setTimeout(() => {
        sendMessage(initialPrompt);
      }, 100);
    }
  }, [initialPrompt]);

  const loadModels = async (retries = 3) => {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const { models: list } = await window.deyad.listModels();
        const names = list.map((m) => m.name);
        const settings = await window.deyad.getSettings();
        const model = (settings.defaultModel && names.includes(settings.defaultModel))
          ? settings.defaultModel
          : names[0] ?? '';
        setModelState({ models: names, selectedModel: model });
        if (settings.embedModel) {
          embedModelRef.current = settings.embedModel;
        }
        contextSizeRef.current = settings.contextSize ?? 32768;
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

    const userMsg: UiMessage = { id: Date.now().toString(), role: 'user', content: text };
    if (imageAttachment) {
      userMsg.content = `[Image attached]\n\n${text}`;
    }
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    const context = buildSmartContext({
      files: appFiles,
      selectedFile,
      userMessage: text,
    });

    const systemPrompt = getSystemPrompt();
    const ollamaMessages: { role: 'user' | 'assistant' | 'system'; content: string; images?: string[] }[] = [
      { role: 'system', content: systemPrompt },
    ];

    if (context) {
      ollamaMessages.push({
        role: 'system' as const,
        content: `Here are the current project files:\n\n${context}`,
      });
    }

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

    const recentMessages = newMessages.slice(-10);
    for (const msg of recentMessages) {
      ollamaMessages.push({ role: msg.role, content: msg.content });
    }

    if (imageAttachment) {
      const lastIdx = ollamaMessages.length - 1;
      if (ollamaMessages[lastIdx]?.role === 'user') {
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

    if (pendingPlan) {
      ollamaMessages.push({ role: 'user', content: PLAN_EXECUTION_PROMPT });
      setPendingPlan(null);
    }

    const assistantId = (Date.now() + 1).toString();
    assistantIdRef.current = assistantId;
    streamBuf.current = '';
    setStreaming(true);

    const assistantMsg: UiMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      model: selectedModel,
    };
    setMessages((prev) => [...prev, assistantMsg]);

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

    const cleanup = () => {
      unsubToken();
      unsubDone();
      unsubError();
      streamCleanupRef.current = null;
    };

    const onDone = () => {
      cleanup();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      const finalContent = streamBuf.current;

      const parsed = extractFilesFromResponse(finalContent);

      if (parsed.length > 0) {
        const fileMap: Record<string, string> = {};
        for (const f of parsed) fileMap[f.path] = f.content;
        onFilesUpdated(fileMap);

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
    if (!overrideText) autoFixAttemptsRef.current = 0;

    const userMsg: UiMessage = { id: Date.now().toString(), role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

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

    const history = newMessages.slice(0, -1).map((m) => ({
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
      contextSize: contextSizeRef.current,
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
    const isGitCommand = /\bgit\b/.test(text) && /\b(push|pull|commit|branch|merge|status|log|remote|clone|init|checkout|stash|rebase|diff|reset|tag)\b/.test(text);
    if (agentMode || isGitCommand) sendAgentMessage();
    else sendMessage();
  };

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

  return {
    messages,
    input,
    setInput,
    streaming,
    models,
    selectedModel,
    setModelState,
    error,
    mode,
    setMode,
    planningMode,
    agentMode,
    agentSteps,
    pendingPlan,
    imageAttachment,
    setImageAttachment,
    bottomRef,
    detectedErrors,
    autoFixAttemptsRef,
    MAX_AUTO_FIX_ATTEMPTS,
    tokenCount,
    handleSend,
    handleStopAgent,
    handleApprovePlan,
    handleRejectPlan,
    handleRetry,
    handleAutoFix,
    handleDismissErrors,
    handleImagePaste,
  };
}
