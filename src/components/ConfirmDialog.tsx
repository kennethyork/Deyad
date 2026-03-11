import { useState, useCallback } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
        </div>
        <div className="modal-body">
          <p>{message}</p>
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button className="btn-primary" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/** Hook for managing a confirm dialog state. */
export function useConfirmDialog() {
  const [state, setState] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ open: false, title: '', message: '', onConfirm: () => {} });

  const confirm = useCallback((title: string, message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        open: true,
        title,
        message,
        onConfirm: () => {
          setState((s) => ({ ...s, open: false }));
          resolve(true);
        },
      });
    });
  }, []);

  const cancel = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
  }, []);

  return { ...state, confirm, cancel };
}
