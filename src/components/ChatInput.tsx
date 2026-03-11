import { useRef } from 'react';

interface Props {
  input: string;
  setInput: (v: string) => void;
  streaming: boolean;
  agentMode: boolean;
  imageAttachment: string | null;
  setImageAttachment: (v: string | null) => void;
  onSend: () => void;
  onImagePaste: (e: React.ClipboardEvent) => void;
}

export default function ChatInput({
  input,
  setInput,
  streaming,
  agentMode,
  imageAttachment,
  setImageAttachment,
  onSend,
  onImagePaste,
}: Props) {
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImageAttachment(reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <div className="chat-input-area">
      {imageAttachment && (
        <div className="image-preview">
          <img src={imageAttachment} alt="Attached" />
          <button className="btn-remove-image" onClick={() => setImageAttachment(null)}>✕</button>
        </div>
      )}
      <div className="chat-input-row">
        <button
          className="btn-attach-image"
          onClick={() => imageInputRef.current?.click()}
          title="Attach image (or paste screenshot)"
        >
          📎
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleImageUpload}
        />
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={onImagePaste}
          rows={2}
          placeholder={streaming ? 'AI is responding…' : imageAttachment ? 'Describe what to build from this image…' : 'Describe what you want to build…'}
          disabled={streaming}
        />
        <button className="btn-send" onClick={onSend} disabled={streaming || !input.trim()}>
          {agentMode ? '⚡' : '↑'}
        </button>
      </div>
    </div>
  );
}
