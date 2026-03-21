import { useState, useEffect } from 'react';
import { taskQueue } from '../lib/taskQueue';
import type { TaskQueueItem } from '../lib/taskQueue';

interface Props {
  /** Current app context for quick-enqueue. */
  appId: string;
  appName: string;
  appType: 'frontend' | 'fullstack';
  dbProvider?: 'sqlite';
  dbStatus: 'none' | 'running' | 'stopped';
  model: string;
  onClose: () => void;
  /** Called when a background task writes files for the current app. */
  onRefreshFiles?: () => void;
}

export default function TaskQueuePanel({
  appId,
  appName,
  appType,
  dbProvider,
  dbStatus,
  model,
  onClose,
  onRefreshFiles,
}: Props) {
  const [tasks, setTasks] = useState<TaskQueueItem[]>(taskQueue.getAll());
  const [newPrompt, setNewPrompt] = useState('');
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  useEffect(() => {
    const unsub = taskQueue.subscribe(() => {
      setTasks(taskQueue.getAll());
    });
    return unsub;
  }, []);

  const handleEnqueue = () => {
    if (!newPrompt.trim() || !model) return;
    taskQueue.enqueue({
      appId,
      appName,
      appType,
      dbProvider,
      dbStatus,
      model,
      prompt: newPrompt.trim(),
    });
    setNewPrompt('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEnqueue();
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDuration = (start: number, end?: number) => {
    const ms = (end ?? Date.now()) - start;
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    return `${mins}m ${secs % 60}s`;
  };

  const statusIcon = (status: TaskQueueItem['status']) => {
    switch (status) {
      case 'queued': return '⏳';
      case 'running': return '⚡';
      case 'done': return '✅';
      case 'error': return '❌';
    }
  };

  const active = tasks.filter((t) => t.status === 'running' || t.status === 'queued');
  const history = tasks.filter((t) => t.status === 'done' || t.status === 'error');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal task-queue-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Background Tasks</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {/* New task input */}
          <div className="tq-new-task">
            <textarea
              className="tq-input"
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Queue a task for ${appName}… (runs autonomously in background)`}
              rows={2}
            />
            <button
              className="btn-primary tq-enqueue-btn"
              onClick={handleEnqueue}
              disabled={!newPrompt.trim() || !model}
            >
              + Queue Task
            </button>
          </div>

          {!model && (
            <div className="tq-warning">No model selected. Select a model in the chat panel first.</div>
          )}

          {/* Active tasks */}
          {active.length > 0 && (
            <div className="tq-section">
              <div className="tq-section-title">Active ({active.length})</div>
              {active.map((task) => (
                <div key={task.id} className={`tq-task tq-task-${task.status}`}>
                  <div className="tq-task-header" onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}>
                    <span className="tq-status-icon">{statusIcon(task.status)}</span>
                    <div className="tq-task-info">
                      <span className="tq-task-prompt">{task.prompt.length > 80 ? task.prompt.slice(0, 80) + '…' : task.prompt}</span>
                      <span className="tq-task-meta">
                        {task.appName} · {task.model} · {formatDuration(task.createdAt)}
                      </span>
                    </div>
                    <button
                      className="btn-secondary tq-cancel-btn"
                      onClick={(e) => { e.stopPropagation(); taskQueue.cancel(task.id); }}
                    >
                      Cancel
                    </button>
                  </div>
                  {expandedTask === task.id && (
                    <div className="tq-task-details">
                      {task.steps.length > 0 && (
                        <div className="tq-steps">
                          {task.steps.slice(-15).map((step, i) => (
                            <div key={i} className={`tq-step tq-step-${step.type}`}>
                              <span>{step.type === 'tool' ? '🔧' : '📋'}</span>
                              <span>{step.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {task.output && (
                        <pre className="tq-output">{task.output.slice(-500)}</pre>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="tq-section">
              <div className="tq-section-title">
                History ({history.length})
                <button className="tq-clear-btn" onClick={() => taskQueue.clearHistory()}>Clear</button>
              </div>
              {history.slice().reverse().slice(0, 20).map((task) => (
                <div key={task.id} className={`tq-task tq-task-${task.status}`}>
                  <div className="tq-task-header" onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}>
                    <span className="tq-status-icon">{statusIcon(task.status)}</span>
                    <div className="tq-task-info">
                      <span className="tq-task-prompt">{task.prompt.length > 80 ? task.prompt.slice(0, 80) + '…' : task.prompt}</span>
                      <span className="tq-task-meta">
                        {task.appName} · {formatTime(task.createdAt)}
                        {task.finishedAt && ` · ${formatDuration(task.createdAt, task.finishedAt)}`}
                      </span>
                    </div>
                    <button
                      className="tq-remove-btn"
                      onClick={(e) => { e.stopPropagation(); taskQueue.remove(task.id); }}
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                  {expandedTask === task.id && (
                    <div className="tq-task-details">
                      {task.error && <div className="tq-error">{task.error}</div>}
                      {task.steps.length > 0 && (
                        <div className="tq-steps">
                          {task.steps.slice(-15).map((step, i) => (
                            <div key={i} className={`tq-step tq-step-${step.type}`}>
                              <span>{step.type === 'tool' ? '🔧' : '📋'}</span>
                              <span>{step.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {task.output && (
                        <pre className="tq-output">{task.output.slice(-500)}</pre>
                      )}
                      {task.status === 'done' && task.appId === appId && onRefreshFiles && (
                        <button className="btn-secondary" onClick={onRefreshFiles}>
                          Refresh Files
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {active.length === 0 && history.length === 0 && (
            <div className="tq-empty">
              No tasks yet. Queue a task above to have the AI work autonomously in the background.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
