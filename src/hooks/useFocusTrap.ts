import { useEffect, useRef, useCallback } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input:not([disabled]),select,[tabindex]:not([tabindex="-1"])';

export function useFocusTrap<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const el = ref.current;
    if (!el) return;

    if (e.key === 'Escape') {
      // Find and click the modal close button
      const close = el.querySelector<HTMLElement>('.modal-close,[data-dismiss]');
      close?.click();
      return;
    }

    if (e.key !== 'Tab') return;

    const focusable = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Focus first focusable element on mount
    const focusable = el.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusable.length > 0) {
      // Prefer autofocus element if present
      const autoFocus = el.querySelector<HTMLElement>('[autofocus]');
      (autoFocus ?? focusable[0])?.focus();
    }

    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return ref;
}
