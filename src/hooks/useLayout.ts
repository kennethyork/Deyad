import { useState, useEffect, useCallback } from 'react';

export function useLayout() {
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const stored = localStorage.getItem('sidebarWidth');
    const n = stored ? parseInt(stored, 10) : NaN;
    return isNaN(n) ? 220 : n;
  });
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [rightWidth, setRightWidth] = useState<number>(() => {
    const stored = localStorage.getItem('rightWidth');
    const n = stored ? parseInt(stored, 10) : NaN;
    return isNaN(n) ? 340 : n;
  });
  const [mobilePanel, setMobilePanel] = useState<'sidebar' | 'chat' | 'right'>('chat');

  // persist when sizes change and update CSS variables
  useEffect(() => {
    localStorage.setItem('sidebarWidth', sidebarWidth.toString());
    document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem('rightWidth', rightWidth.toString());
    document.documentElement.style.setProperty('--editor-width', `${rightWidth}px`);
  }, [rightWidth]);

  const startDrag = useCallback((type: 'sidebar' | 'right', startX: number) => {
    const initSidebar = sidebarWidth;
    const initRight = rightWidth;
    const move = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      if (type === 'sidebar') {
        setSidebarWidth(Math.max(100, initSidebar + dx));
      } else {
        setRightWidth(Math.max(200, initRight - dx));
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [sidebarWidth, rightWidth]);

  return {
    sidebarWidth, setSidebarWidth,
    sidebarVisible, setSidebarVisible,
    rightWidth, setRightWidth,
    mobilePanel, setMobilePanel,
    startDrag,
  };
}
