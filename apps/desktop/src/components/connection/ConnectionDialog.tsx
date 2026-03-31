import { useState, useEffect, useRef } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useConnectionStore } from '@/stores/connectionStore';
import type { SavedConnection } from '@/lib/types';
import { ConnectionForm } from './ConnectionForm';
import { ConnectionCard } from './ConnectionCard';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Plus, Unplug, ArrowRightLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConnectionDialog({ open, onOpenChange }: Props) {
  const pushModal = useUIStore((s) => s.pushModal);
  const popModal = useUIStore((s) => s.popModal);

  // Register modal when open
  useEffect(() => {
    if (open) {
      pushModal('connectionDialog');
      return () => popModal('connectionDialog');
    }
  }, [open, pushModal, popModal]);

  const [showNewForm, setShowNewForm] = useState(false);
  const [editingConnection, setEditingConnection] = useState<SavedConnection | null>(null);
  const loadSavedConnections = useConnectionStore((s) => s.loadSavedConnections);
  const savedConnections = useConnectionStore((s) => s.savedConnections);
  const activeConnections = useConnectionStore((s) => s.activeConnections);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const switchConnection = useConnectionStore((s) => s.switchConnection);
  const disconnectById = useConnectionStore((s) => s.disconnectById);

  useEffect(() => {
    if (open) {
      loadSavedConnections();
      setShowNewForm(false);
      setEditingConnection(null);
    }
  }, [open, loadSavedConnections]);

  // Close dialog after a new connection succeeds
  const prevCountRef = useRef(activeConnections.length);
  useEffect(() => {
    if (activeConnections.length > prevCountRef.current && open) {
      onOpenChange(false);
    }
    prevCountRef.current = activeConnections.length;
  }, [activeConnections.length, open, onOpenChange]);

  const activeIds = new Set(activeConnections.map((c) => c.connectionId));
  // Saved connections that are NOT currently active
  const inactiveSaved = savedConnections.filter(
    (sc) => !activeConnections.some((ac) => ac.config.id === sc.config.id),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connections</DialogTitle>
          <DialogDescription>
            Manage your database connections. You can have multiple open at once.
          </DialogDescription>
        </DialogHeader>

        {showNewForm ? (
          <ConnectionForm onCancel={() => setShowNewForm(false)} />
        ) : editingConnection ? (
          <ConnectionForm
            initialConfig={editingConnection.config}
            onCancel={() => setEditingConnection(null)}
          />
        ) : (
          <div className="space-y-4">
            {/* Active connections */}
            {activeConnections.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Active ({activeConnections.length})
                </div>
                <div className="space-y-1.5">
                  {activeConnections.map((conn) => {
                    const isCurrent = conn.connectionId === activeConnectionId;
                    const dbLabel =
                      conn.config.db_type === 'mysql' ? 'MySQL'
                        : conn.config.db_type === 'postgres' ? 'PostgreSQL'
                        : conn.config.db_type === 'sqlite' ? 'SQLite'
                        : conn.config.db_type;
                    return (
                      <div
                        key={conn.connectionId}
                        className={cn(
                          'flex items-center gap-3 rounded-md border p-3 transition-colors',
                          isCurrent ? 'border-primary/50 bg-primary/5' : 'border-border',
                        )}
                        style={conn.config.color ? { borderLeftColor: conn.config.color, borderLeftWidth: '3px' } : undefined}
                      >
                        {/* Color dot */}
                        {conn.config.color && (
                          <div
                            className="h-3 w-3 shrink-0 rounded-full"
                            style={{ backgroundColor: conn.config.color }}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium text-sm">
                              {conn.config.name || `${conn.config.host}:${conn.config.port}`}
                            </span>
                            <Badge variant="secondary" className="text-[10px] shrink-0">
                              {dbLabel}
                            </Badge>
                            {conn.config.environment && (
                              <Badge variant="outline" className="text-[9px] shrink-0">
                                {conn.config.environment}
                              </Badge>
                            )}
                            {isCurrent && (
                              <Badge className="text-[9px] shrink-0">Current</Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {conn.config.host}:{conn.config.port}
                            {conn.config.database && ` / ${conn.config.database}`}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {!isCurrent && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 text-xs"
                              onClick={() => {
                                switchConnection(conn.connectionId);
                                onOpenChange(false);
                              }}
                            >
                              <ArrowRightLeft className="h-3 w-3" />
                              Switch
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                            onClick={() => disconnectById(conn.connectionId)}
                          >
                            <Unplug className="h-3 w-3" />
                            Disconnect
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Saved connections (not currently active) */}
            {inactiveSaved.length > 0 && (
              <div>
                {activeConnections.length > 0 && <Separator className="my-3" />}
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Saved ({inactiveSaved.length})
                </div>
                <div className="space-y-1.5">
                  {inactiveSaved.map((conn) => (
                    <ConnectionCard
                      key={conn.config.id}
                      connection={conn}
                      onEdit={(c) => setEditingConnection(c)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* New connection button */}
            <Button
              onClick={() => setShowNewForm(true)}
              variant="outline"
              className="w-full gap-2"
            >
              <Plus className="h-4 w-4" />
              New Connection
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
