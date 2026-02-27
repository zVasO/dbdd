import { useQueryStore } from '@/stores/queryStore';

export function QueryHistory() {
  const history = useQueryStore((s) => s.history);

  if (history.length === 0) {
    return (
      <div className="p-4 text-center text-xs" style={{ color: 'var(--color-text-disabled)' }}>
        No query history
      </div>
    );
  }

  return (
    <div className="overflow-y-auto">
      {history.map((entry) => (
        <div
          key={entry.id}
          className="border-b px-3 py-2"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-xs"
              style={{
                color: entry.status === 'Success' ? 'var(--color-success)' : 'var(--color-error)',
              }}
            >
              {entry.status}
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-disabled)' }}>
              {entry.duration_ms}ms
            </span>
          </div>
          <pre
            className="mt-1 truncate text-xs"
            style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}
          >
            {entry.sql}
          </pre>
        </div>
      ))}
    </div>
  );
}
