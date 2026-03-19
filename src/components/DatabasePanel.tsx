import { useEffect, useState } from 'react';
import type { AppProject } from '../App';

interface TableInfo {
  name: string;
  columns: string[];
}

type ViewMode = 'tables' | 'schema';

interface Props {
  app: AppProject;
}

export default function DatabasePanel({ app }: Props) {
  const [schemaInfo, setSchemaInfo] = useState<TableInfo[]>([]);
  const [tableList, setTableList] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('tables');
  const [dbMissing, setDbMissing] = useState(false);

  // Load table list and schema info when app changes
  useEffect(() => {
    if (app.appType !== 'fullstack') return;
    setLoading(true);
    setError(null);
    setDbMissing(false);

    Promise.all([
      window.deyad.dbTables(app.id),
      window.deyad.dbDescribe(app.id),
    ])
      .then(([tables, schema]) => {
        setTableList(tables);
        setSchemaInfo(schema.tables);
        if (tables.length === 0 && schema.tables.length === 0) {
          setDbMissing(true);
        }
        // Auto-select first table
        if (tables.length > 0 && !selectedTable) {
          setSelectedTable(tables[0]);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [app.id, app.appType]);

  // Load rows when a table is selected
  useEffect(() => {
    if (!selectedTable) { setRows([]); return; }
    setLoading(true);
    const safeName = selectedTable.replace(/[^a-zA-Z0-9_]/g, '');
    window.deyad.dbQuery(app.id, `SELECT * FROM "${safeName}" LIMIT 200`)
      .then((data) => setRows(data))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [selectedTable, app.id]);

  if (app.appType !== 'fullstack') {
    return <div className="db-panel">Database info is available only for full-stack apps.</div>;
  }

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div className="db-panel">
      {/* Toolbar */}
      <div className="db-toolbar">
        <div className="db-toolbar-tabs">
          <button
            className={`db-toolbar-tab ${view === 'tables' ? 'active' : ''}`}
            onClick={() => setView('tables')}
          >
            Tables
          </button>
          <button
            className={`db-toolbar-tab ${view === 'schema' ? 'active' : ''}`}
            onClick={() => setView('schema')}
          >
            Schema
          </button>
        </div>
        <div className="db-toolbar-status">
          <span className="db-status-dot running" />
          SQLite
        </div>
      </div>

      {/* Tables view */}
      {view === 'tables' && (
        <div className="db-tables-view">
          {dbMissing ? (
            <div className="db-gui-placeholder">
              <div className="db-gui-placeholder-icon">📂</div>
              <h3>Database not created yet</h3>
              <p>Run <code>npx prisma db push</code> in the terminal to create the SQLite database.</p>
            </div>
          ) : loading && tableList.length === 0 ? (
            <p className="db-schema-loading">Loading tables…</p>
          ) : error ? (
            <p className="db-schema-error">Error: {error}</p>
          ) : (
            <div className="db-browse-layout">
              <div className="db-table-list">
                {tableList.map((t) => (
                  <button
                    key={t}
                    className={`db-table-list-item ${selectedTable === t ? 'active' : ''}`}
                    onClick={() => setSelectedTable(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="db-table-data">
                {selectedTable && (
                  <>
                    <div className="db-table-header">
                      <strong>{selectedTable}</strong>
                      <span className="db-row-count">{rows.length} row{rows.length !== 1 ? 's' : ''}</span>
                    </div>
                    {rows.length === 0 ? (
                      <p className="db-schema-empty">No rows in this table.</p>
                    ) : (
                      <div className="db-data-scroll">
                        <table className="db-data-table">
                          <thead>
                            <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
                          </thead>
                          <tbody>
                            {rows.map((row, i) => (
                              <tr key={i}>
                                {columns.map((c) => (
                                  <td key={c}>{row[c] == null ? <em>null</em> : String(row[c])}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Schema view */}
      {view === 'schema' && (
        <div className="db-schema-view">
          {loading && <p className="db-schema-loading">Loading schema…</p>}
          {error && <p className="db-schema-error">Error: {error}</p>}
          {!loading && !error && schemaInfo.length === 0 && <p className="db-schema-empty">No tables found in schema.</p>}
          {schemaInfo.map((t) => (
            <div key={t.name} className="db-table">
              <div className="db-table-name">{t.name}</div>
              <ul className="db-table-cols">
                {t.columns.map((c) => (<li key={c}>{c}</li>))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
