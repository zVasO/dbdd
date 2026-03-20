import { useConnectionStore } from '@/stores/connectionStore';
import type { SavedConnection } from '@/lib/types';
import { ConnectionCard } from './ConnectionCard';

interface Props {
  onEdit?: (connection: SavedConnection) => void;
}

export function ConnectionList({ onEdit }: Props) {
  const savedConnections = useConnectionStore((s) => s.savedConnections);

  if (savedConnections.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No saved connections. Create one to get started.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {savedConnections.map((conn) => (
        <ConnectionCard key={conn.config.id} connection={conn} onEdit={onEdit} />
      ))}
    </div>
  );
}
