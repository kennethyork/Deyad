import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface Props {
  appId?: string;
}

interface TermTab {
  id: string;        // unique tab key
  termId: string;    // pty id from main process
  label: string;
  term: Terminal;
  fit: FitAddon;
}

let tabCounter = 0;

export default function TerminalPanel({ appId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tabs, setTabs] = useState<TermTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const tabsRef = useRef<TermTab[]>([]);

  // keep ref in sync
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);

  // global listeners for pty data/exit (shared across all tabs)
  useEffect(() => {
    const unsubData = window.deyad.onTerminalData(({ id, data }) => {
      const tab = tabsRef.current.find(t => t.termId === id);
      if (tab) tab.term.write(data);
    });
    const unsubExit = window.deyad.onTerminalExit(({ id, exitCode }) => {
      const tab = tabsRef.current.find(t => t.termId === id);
      if (tab) tab.term.write(`\r\n\x1b[90mprocess exited (${exitCode})\x1b[0m\r\n`);
    });
    const removeClear = window.deyad.onTerminalClear(() => {
      const tab = tabsRef.current.find(t => t.id === activeIdRef.current);
      if (tab) tab.term.clear();
    });
    return () => { unsubData(); unsubExit(); removeClear(); };
  }, []);

  const activeIdRef = useRef<string | null>(null);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  // create a new terminal tab
  const createTab = useCallback(async () => {
    if (!containerRef.current) return;

    const term = new Terminal({ cursorBlink: true, fontSize: 13, scrollback: 5000 });
    const fit = new FitAddon();
    term.loadAddon(fit);

    // create a hidden wrapper div for this terminal's DOM
    const wrapper = document.createElement('div');
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    wrapper.style.display = 'none';
    containerRef.current.appendChild(wrapper);

    term.open(wrapper);
    fit.fit();

    // start pty
    const termId = await window.deyad.createTerminal(appId);

    // forward keystrokes to pty
    term.onData((d) => window.deyad.terminalWrite(termId, d));

    // paste shortcut
    term.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && e.key === 'v') {
        navigator.clipboard.readText().then(text => window.deyad.terminalWrite(termId, text));
        return false;
      }
      return true;
    });

    // initial resize
    window.deyad.terminalResize(termId, term.cols, term.rows);

    tabCounter++;
    const tab: TermTab = {
      id: `tab-${Date.now()}-${tabCounter}`,
      termId,
      label: `Terminal ${tabCounter}`,
      term,
      fit,
    };

    // Tag wrapper with tab id for reliable DOM lookup
    wrapper.dataset.termTab = tab.id;

    setTabs(prev => [...prev, tab]);
    setActiveId(tab.id);
  }, [appId]);

  // auto-create first tab on mount; reset tab counter
  useEffect(() => {
    tabCounter = 0;
    if (tabs.length === 0) {
      createTab();
    }
     
  }, []);

  // show/hide terminal DOM wrappers + fit when active tab changes
  useEffect(() => {
    if (!containerRef.current) return;
    tabs.forEach((tab) => {
      const wrapper = containerRef.current!.querySelector<HTMLDivElement>(`[data-term-tab="${tab.id}"]`);
      if (!wrapper) return;
      if (tab.id === activeId) {
        wrapper.style.display = 'block';
        tab.fit.fit();
        tab.term.focus();
        window.deyad.terminalResize(tab.termId, tab.term.cols, tab.term.rows);
      } else {
        wrapper.style.display = 'none';
      }
    });
  }, [activeId, tabs]);

  // resize observer to auto-fit
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(() => {
      const tab = tabsRef.current.find(t => t.id === activeIdRef.current);
      if (tab) {
        tab.fit.fit();
        window.deyad.terminalResize(tab.termId, tab.term.cols, tab.term.rows);
      }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // right-click context menu
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      window.deyad.showContextMenu('terminal');
    };
    el.addEventListener('contextmenu', handler, { capture: true });
    return () => el.removeEventListener('contextmenu', handler);
  }, []);

  // cleanup all terminals on unmount
  useEffect(() => {
    return () => {
      for (const tab of tabsRef.current) {
        window.deyad.terminalKill(tab.termId).catch((err) => console.warn('terminalKill:', err));
        tab.term.dispose();
      }
    };
  }, []);

  // close a tab
  const closeTab = useCallback((tabId: string) => {
    const tab = tabsRef.current.find(t => t.id === tabId);
    if (!tab) return;

    window.deyad.terminalKill(tab.termId).catch((err) => console.warn('terminalKill:', err));
    tab.term.dispose();

    // remove the DOM wrapper
    if (containerRef.current) {
      const wrapper = containerRef.current.querySelector<HTMLDivElement>(`[data-term-tab="${tabId}"]`);
      if (wrapper) wrapper.remove();
    }

    setTabs(prev => {
      const next = prev.filter(t => t.id !== tabId);
      // if closing the active tab, switch to neighbor
      if (activeIdRef.current === tabId && next.length > 0) {
        const idx = prev.findIndex(t => t.id === tabId);
        const newActive = next[Math.min(idx, next.length - 1)];
        setActiveId(newActive.id);
      } else if (next.length === 0) {
        setActiveId(null);
      }
      return next;
    });
  }, []);

  return (
    <div className="terminal-multi-wrapper">
      {/* Tab bar */}
      <div className="terminal-tab-bar">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`terminal-tab ${tab.id === activeId ? 'active' : ''}`}
            onClick={() => setActiveId(tab.id)}
          >
            <span className="terminal-tab-label">{tab.label}</span>
            {tabs.length > 1 && (
              <button
                className="terminal-tab-close"
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                title="Close terminal"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button className="terminal-tab-add" onClick={createTab} title="New terminal">
          +
        </button>
      </div>

      {/* Terminal container */}
      <div
        className="terminal-panel"
        ref={containerRef}
        style={{ width: '100%', flex: 1, background: '#000' }}
      />
    </div>
  );
}
