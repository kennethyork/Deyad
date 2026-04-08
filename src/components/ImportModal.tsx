import { useState, useRef, useEffect } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface ImportModalProps {
  onClose: () => void;
  onImport: (name: string) => void;
}

export default function ImportModal({ onClose, onImport }: ImportModalProps) {
  const trapRef = useFocusTrap();
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onImport(trimmed);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={trapRef} className="modal" role="dialog" aria-modal="true" aria-label="Import Project" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Import Project</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Give your imported project a name, then choose the folder to import.
          </p>
          <div className="form-field">
            <label>Project Name</label>
            <input
              ref={inputRef}
              type="text"
              placeholder="My Imported App"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
          </div>
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!name.trim()} onClick={handleSubmit}>
            Choose Folder & Import
          </button>
        </div>
      </div>
    </div>
  );
}
