import { useState, useEffect, useRef, memo } from 'react';

export interface Command {
  id: string;
  name: string;
  icon: string;
  shortcut?: string;
  run: () => void;
}

interface Props {
  commands: Command[];
  onClose: () => void;
}

export default memo(function CommandPalette({ commands, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = query
    ? commands.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
    : commands;

  // Reset selection when results change
  useEffect(() => {
    setSelected(0);
  }, [query]);

  const execute = (cmd: Command) => {
    onClose();
    cmd.run();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter' && filtered[selected]) {
      execute(filtered[selected]);
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selected] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="command-palette-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command…"
          autoComplete="off"
          spellCheck={false}
        />
        <div ref={listRef} className="command-palette-list">
          {filtered.length === 0 && (
            <div className="command-palette-empty">No matching commands</div>
          )}
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              className={`command-palette-item${i === selected ? ' selected' : ''}`}
              onClick={() => execute(cmd)}
              onMouseEnter={() => setSelected(i)}
            >
              <span className="command-palette-icon">{cmd.icon}</span>
              <span className="command-palette-label">{cmd.name}</span>
              {cmd.shortcut && (
                <span className="command-palette-shortcut">{cmd.shortcut}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});
