import { useSchemaStore } from '@/stores/schemaStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useQueryStore } from '@/stores/queryStore';
import { useUIStore } from '@/stores/uiStore';

export function Sidebar() {
  const { sidebarOpen } = useUIStore();
  const { databases, tables, loadTables } = useSchemaStore();
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const activeConfig = useConnectionStore((s) => s.activeConfig);
  const { createTab, updateSql, activeTabId } = useQueryStore();

  if (!sidebarOpen) return null;

  const handleTableClick = (db: string, tableName: string) => {
    const sql = `SELECT * FROM \`${tableName}\` LIMIT 500`;
    if (activeTabId) {
      updateSql(activeTabId, sql);
    } else {
      const id = createTab(tableName);
      updateSql(id, sql);
    }
  };

  const handleDbClick = (dbName: string) => {
    if (activeConnectionId) {
      loadTables(activeConnectionId, dbName);
    }
  };

  return (
    <div
      className="flex flex-col overflow-hidden border-r"
      style={{
        width: 'var(--sidebar-width)',
        background: 'var(--color-bg-sidebar)',
        borderColor: 'var(--color-border)',
      }}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
          {activeConfig?.name || 'Explorer'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {databases.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs" style={{ color: 'var(--color-text-disabled)' }}>
            No databases found
          </p>
        ) : (
          databases.map((db) => (
            <div key={db.name} className="mb-1">
              <button
                onClick={() => handleDbClick(db.name)}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:opacity-80"
                style={{ color: 'var(--color-text-primary)' }}
              >
                <span className="text-xs" style={{ color: 'var(--color-accent)' }}>DB</span>
                <span className="truncate">{db.name}</span>
                {db.size_bytes != null && (
                  <span className="ml-auto text-xs" style={{ color: 'var(--color-text-disabled)' }}>
                    {formatBytes(db.size_bytes)}
                  </span>
                )}
              </button>

              {tables[db.name]?.map((table) => (
                <button
                  key={table.name}
                  onClick={() => handleTableClick(db.name, table.name)}
                  className="flex w-full items-center gap-1.5 rounded px-4 py-0.5 text-left text-xs hover:opacity-80"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  <span style={{ color: table.table_type === 'View' ? 'var(--color-warning)' : 'var(--color-text-tertiary)' }}>
                    {table.table_type === 'View' ? 'V' : 'T'}
                  </span>
                  <span className="truncate">{table.name}</span>
                  {table.row_count_estimate != null && (
                    <span className="ml-auto" style={{ color: 'var(--color-text-disabled)' }}>
                      ~{table.row_count_estimate.toLocaleString()}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
