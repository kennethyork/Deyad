import { useState, useCallback, useRef } from 'react';

interface SearchResult {
  file: string;
  line: number;
  text: string;
}

interface Props {
  appId: string;
  onSelectFile: (file: string) => void;
}

export default function SearchPanel({ appId, onSelectFile }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setSearching(true);
    try {
      const res = await window.dyad.searchFiles(appId, q.trim());
      setResults(res);
      setSearched(true);
    } catch (err) {
      console.error('Search failed:', err);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [appId]);

  const handleInput = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      doSearch(query);
    }
  };

  // Group results by file
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.file] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="search-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '8px', borderBottom: '1px solid var(--border)' }}>
        <input
          type="text"
          className="search-input"
          placeholder="Search across all files… (regex supported)"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          style={{
            width: '100%',
            padding: '6px 10px',
            borderRadius: '4px',
            border: '1px solid var(--border)',
            background: 'var(--bg-input)',
            color: 'var(--text)',
            fontSize: '13px',
          }}
        />
        {searching && <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>Searching…</div>}
        {searched && !searching && (
          <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>
            {results.length} result{results.length !== 1 ? 's' : ''}{results.length >= 200 ? ' (limit reached)' : ''}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {Object.entries(grouped).map(([file, matches]) => (
          <div key={file} style={{ marginBottom: '4px' }}>
            <div
              style={{
                padding: '4px 10px',
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              onClick={() => onSelectFile(file)}
              title={file}
            >
              <span style={{ opacity: 0.6 }}>📄</span>
              {file}
              <span style={{ marginLeft: 'auto', fontSize: '10px', opacity: 0.5 }}>{matches.length}</span>
            </div>
            {matches.map((m, i) => (
              <div
                key={`${m.line}-${i}`}
                onClick={() => onSelectFile(file)}
                style={{
                  padding: '2px 10px 2px 28px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'baseline',
                }}
                className="search-result-line"
              >
                <span style={{ color: 'var(--text-dim)', minWidth: '32px', textAlign: 'right', fontSize: '11px' }}>
                  {m.line}
                </span>
                <span style={{ color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.text}
                </span>
              </div>
            ))}
          </div>
        ))}

        {searched && !searching && results.length === 0 && (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
            No results found
          </div>
        )}
      </div>
    </div>
  );
}
