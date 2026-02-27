import { useConnectionStore } from '@/stores/connectionStore';
import { ConnectionCard } from './ConnectionCard';

export function ConnectionList() {
  const savedConnections = useConnectionStore((s) => s.savedConnections);

  if (savedConnections.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        No saved connections. Create one to get started.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {savedConnections.map((conn) => (
        <ConnectionCard key={conn.config.id} connection={conn} />
      ))}
    </div>
  );
}
