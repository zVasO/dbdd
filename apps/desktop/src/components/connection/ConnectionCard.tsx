import { useState } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';
import type { SavedConnection } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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
    <Card
      className="py-0"
      style={{
        borderLeftColor: connection.config.color || undefined,
        borderLeftWidth: connection.config.color ? '3px' : undefined,
      }}
    >
      <CardContent className="flex items-center justify-between p-3">
        <div className="flex items-center gap-3">
          <div>
            <div className="font-medium text-card-foreground">
              {connection.config.name || 'Unnamed'}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary" className="text-xs">
                {connection.config.db_type}
              </Badge>
              {connection.config.environment && (
                <Badge variant="outline" className="text-[9px]">
                  {connection.config.environment}
                </Badge>
              )}
              <span>{connection.config.host}:{connection.config.port}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={handleConnect}
            disabled={loading}
          >
            {loading ? 'Connecting...' : 'Connect'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive-foreground hover:bg-destructive"
            onClick={() => deleteConnection(connection.config.id)}
          >
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
