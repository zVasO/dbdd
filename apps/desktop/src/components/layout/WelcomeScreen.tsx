import { useEffect } from 'react';
import { Database, FileCode, ArrowRight } from 'lucide-react';
import { useConnectionStore } from '@/stores/connectionStore';
import { IS_MACOS } from '@/lib/platform';
import type { SavedConnection } from '@/lib/types';

interface WelcomeScreenProps {
  readonly onNewConnection: () => void;
  readonly onOpenFile: () => void;
}

const DB_TYPE_COLORS: Record<string, string> = {
  mysql: 'bg-blue-500',
  postgres: 'bg-indigo-500',
  sqlite: 'bg-emerald-500',
  mongodb: 'bg-green-600',
};

function ConnectionItem({
  saved,
  onConnect,
}: {
  readonly saved: SavedConnection;
  readonly onConnect: (saved: SavedConnection) => void;
}) {
  const { config } = saved;
  const dotColor = config.color
    ? undefined
    : DB_TYPE_COLORS[config.db_type] ?? 'bg-gray-400';

  return (
    <button
      onClick={() => onConnect(saved)}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted/60 group"
    >
      <span
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotColor ?? ''}`}
        style={config.color ? { backgroundColor: config.color } : undefined}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {config.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {config.host}:{config.port}
          {config.database ? `/${config.database}` : ''}
        </p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

export function WelcomeScreen({ onNewConnection, onOpenFile }: WelcomeScreenProps) {
  const savedConnections = useConnectionStore((s) => s.savedConnections);
  const loadSavedConnections = useConnectionStore((s) => s.loadSavedConnections);
  const connect = useConnectionStore((s) => s.connect);

  useEffect(() => {
    loadSavedConnections();
  }, [loadSavedConnections]);

  const recentConnections = savedConnections
    .slice()
    .sort((a, b) => {
      const aTime = a.last_used_at ?? a.created_at;
      const bTime = b.last_used_at ?? b.created_at;
      return bTime.localeCompare(aTime);
    })
    .slice(0, 5);

  const handleReconnect = (saved: SavedConnection) => {
    connect(saved.config).catch(() => {
      // Error is already stored in connectionStore
    });
  };

  const modKey = IS_MACOS ? '\u2318' : 'Ctrl+';

  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="max-w-md w-full space-y-8 text-center">
        {/* Logo & tagline */}
        <div className="space-y-2">
          <div className="flex justify-center">
            <Database className="w-16 h-16 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">DataForge</h1>
          <p className="text-muted-foreground">Your database, your way</p>
        </div>

        {/* Quick actions */}
        <div className="flex gap-3 justify-center">
          <button
            onClick={onNewConnection}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors flex items-center gap-2"
          >
            <Database className="w-4 h-4" />
            New Connection
          </button>
          <button
            onClick={onOpenFile}
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors flex items-center gap-2"
          >
            <FileCode className="w-4 h-4" />
            Open SQL File
          </button>
        </div>

        {/* Recent connections */}
        {recentConnections.length > 0 && (
          <div className="space-y-2 text-left">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground px-3">
              Recent Connections
            </h2>
            <div className="space-y-0.5">
              {recentConnections.map((saved) => (
                <ConnectionItem
                  key={saved.config.id}
                  saved={saved}
                  onConnect={handleReconnect}
                />
              ))}
            </div>
          </div>
        )}

        {/* Keyboard hint */}
        <p className="text-xs text-muted-foreground">
          Press{' '}
          <kbd className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono text-xs">
            {modKey}K
          </kbd>{' '}
          to open the command palette
        </p>
      </div>
    </div>
  );
}
