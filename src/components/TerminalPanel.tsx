import { useState, useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

// simple toolbar above the terminal
const toolbarStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  padding: '4px',
  zIndex: 10,
};

const buttonStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.1)',
  border: 'none',
  color: '#fff',
  padding: '2px 6px',
  cursor: 'pointer',
  marginLeft: '4px',
};

interface Props {
  appId?: string;
}

export default function TerminalPanel({ appId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showToolbar, setShowToolbar] = useState(true);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [termId, setTermId] = useState<string | null>(null);

  // initialise terminal once
  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({ cursorBlink: true, fontSize: 13, scrollback: 1000 });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const handleResize = () => {
      fit.fit();
      if (termId) {
        window.deyad.terminalResize(termId, term.cols, term.rows);
      }
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);

    // focus so keystrokes go to terminal
    term.focus();

    // paste shortcut
    term.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && e.key === 'v') {
        navigator.clipboard.readText().then(text => term.write(text));
        return false;
      }
      return true;
    });

    // right-click context menu
    const handleContext = (e: MouseEvent) => {
      e.preventDefault();
      const { Menu, clipboard } = window.require('electron');
      const menu = Menu.buildFromTemplate([
        {
          label: 'Copy',
          click: () => {
            const sel = term.getSelection();
            if (sel) clipboard.writeText(sel);
          },
        },
        {
          label: 'Paste',
          click: () => clipboard.readText().then(t => term.write(t)),
        },
        { type: 'separator' },
        {
          label: 'Clear',
          click: clearTerminal,
        },
      ]);
      menu.popup({ window: window.require('electron').remote.getCurrentWindow() });
    };
    containerRef.current.addEventListener('contextmenu', handleContext);

    // cleanup
    return () => {
      observer.disconnect();
      term.dispose();
      containerRef.current?.removeEventListener('contextmenu', handleContext);
    };

    return () => {
      observer.disconnect();
      term.dispose();
    };
  }, []);

  // create pty when terminal object ready

  const clearTerminal = () => {
    if (termRef.current) termRef.current.clear();
  };
  useEffect(() => {
    if (termRef.current && !termId) {
      window.deyad.createTerminal(appId).then((id) => {
        setTermId(id);
      });
    }
  }, [appId, termId]);

  // wire data events
  useEffect(() => {
    if (!termId || !termRef.current) return;
    const term = termRef.current;
    const fit = fitRef.current!;

    const dataHandler = (payload: { id: string; data: string }) => {
      if (payload.id === termId) term.write(payload.data);
    };
    const exitHandler = (payload: { id: string; exitCode: number; signal: number }) => {
      if (payload.id === termId) {
        term.write(`\r\n
process exited (${payload.exitCode})\r\n`);
      }
    };

    const termListener = (_: any, payload: { id: string; data: string }) => dataHandler(payload);
    const exitListener = (_: any, payload: { id: string; exitCode: number; signal: number }) => exitHandler(payload);
    window.deyad.onTerminalData(dataHandler);
    window.deyad.onTerminalExit(exitHandler);

    term.onData((d) => {
      window.deyad.terminalWrite(termId, d);
    });

    // initial resize
    fit.fit();
    window.deyad.terminalResize(termId, term.cols, term.rows);

    return () => {
      // remove listeners by returning cleanup functions from expose? already returned above but we didn't store them
    };
  }, [termId]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {showToolbar && (
        <div style={toolbarStyle}>
          <button style={buttonStyle} onClick={clearTerminal}>Clear</button>
          <button style={buttonStyle} onClick={() => setShowToolbar(s => !s)}>
            {showToolbar ? 'Hide' : 'Show'}
          </button>
        </div>
      )}
      <div className="terminal-panel" ref={containerRef} style={{ width: '100%', height: '100%', background: '#000' }} />
    </div>
  );
}
