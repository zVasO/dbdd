import { useState } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';
import type { SavedConnection } from '@/lib/types';

interface Props {
  connection: SavedConnection;
}

export function ConnectionCard({ connection }: Props) {
  const { connect, deleteConnection } = useConnectionStore();
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setLoading(true);
    try {
      await connect(connection.config);
    } catch {
      // error handled by store
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex items-center justify-between rounded-lg border p-3"
      style={{
        borderColor: connection.config.color || 'var(--color-border)',
        background: 'var(--color-bg-secondary)',
      }}
    >
      <div>
        <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
          {connection.config.name || 'Unnamed'}
        </div>
        <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          {connection.config.db_type} - {connection.config.host}:{connection.config.port}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleConnect}
          disabled={loading}
          className="rounded px-3 py-1 text-xs font-medium text-white"
          style={{ background: 'var(--color-accent)' }}
        >
          {loading ? 'Connecting...' : 'Connect'}
        </button>
        <button
          onClick={() => deleteConnection(connection.config.id)}
          className="rounded px-3 py-1 text-xs"
          style={{ color: 'var(--color-error)' }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
