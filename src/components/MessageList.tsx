import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  filesGenerated?: string[];
  model?: string;
}

interface Props {
  messages: UiMessage[];
  pendingPlan: string | null;
  streaming: boolean;
  onApprovePlan: () => void;
  onRejectPlan: () => void;
}

export default memo(function MessageList({ messages, pendingPlan, streaming, onApprovePlan, onRejectPlan }: Props) {
  return (
    <div aria-live="polite" aria-relevant="additions">
      {messages.map((m) => (
        <div key={m.id} className={`message message-${m.role}`} role="article" aria-label={`${m.role === 'user' ? 'User' : 'Assistant'} message`}>
          <div className="message-avatar" aria-hidden="true">{m.role === 'user' ? '👤' : '🤖'}</div>
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
            {pendingPlan && m.content === pendingPlan && (
              <div className="plan-actions">
                <button className="btn-approve-plan" onClick={onApprovePlan} disabled={streaming} aria-label="Approve and execute plan">
                  ✓ Approve &amp; Execute
                </button>
                <button className="btn-reject-plan" onClick={onRejectPlan} disabled={streaming} aria-label="Reject plan">
                  ✗ Reject
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
});
