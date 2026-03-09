import { useEffect, useState } from 'react';
import type { AppProject } from '../App';

interface TableInfo {
  name: string;
  columns: string[];
}

interface Props {
  app: AppProject;
}

export default function DatabasePanel({ app }: Props) {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (app.appType !== 'fullstack') return;
    setLoading(true);
    window.deyad.dbDescribe(app.id)
      .then((res) => {
        setTables(res.tables);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [app]);

  if (app.appType !== 'fullstack') {
    return <div className="db-panel">Database info is available only for full-stack apps.</div>;
  }

  return (
    <div className="db-panel" style={{ padding: 12, overflowY: 'auto', height: '100%' }}>
      {loading && <p>Loading schema…</p>}
      {error && <p className="text-danger">Error: {error}</p>}
      {!loading && tables.length === 0 && <p>No tables found in schema.</p>}
      {tables.map((t) => (
        <div key={t.name} className="db-table">
          <div className="db-table-name">{t.name}</div>
          <ul className="db-table-cols">
            {t.columns.map((c) => (<li key={c}>{c}</li>))}
          </ul>
        </div>
      ))}
    </div>
  );
}
