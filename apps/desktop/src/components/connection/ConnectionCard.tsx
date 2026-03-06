import { useState } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';
import type { SavedConnection } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

interface Props {
  connection: SavedConnection;
}

export function ConnectionCard({ connection }: Props) {
  const { connect, deleteConnection } = useConnectionStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');

  const handleConnect = async (pw?: string) => {
    setLoading(true);
    setError(null);
    try {
      await connect(connection.config, pw || undefined);
    } catch (e) {
      const msg = String(e);
      setError(msg);
      // Show password prompt on auth-related errors
      if (msg.includes('denied') || msg.includes('password') || msg.includes('auth')) {
        setShowPassword(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleConnect(password);
  };

  return (
    <Card
      className="cursor-pointer py-0 transition-colors hover:bg-accent/50"
      onClick={() => handleConnect()}
      style={{
        borderLeftColor: connection.config.color || undefined,
        borderLeftWidth: connection.config.color ? '3px' : undefined,
      }}
    >
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
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
              onClick={(e) => { e.stopPropagation(); handleConnect(); }}
              disabled={loading}
            >
              {loading ? 'Connecting...' : 'Connect'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive-foreground hover:bg-destructive"
              onClick={(e) => { e.stopPropagation(); deleteConnection(connection.config.id); }}
            >
              Delete
            </Button>
          </div>
        </div>
        {error && (
          <div className="mt-2 text-xs text-destructive">{error}</div>
        )}
        {showPassword && (
          <form onSubmit={handlePasswordSubmit} className="mt-2 flex gap-2">
            <Input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-7 text-xs"
              autoFocus
            />
            <Button type="submit" size="sm" variant="secondary" disabled={loading} className="h-7 text-xs">
              Retry
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
