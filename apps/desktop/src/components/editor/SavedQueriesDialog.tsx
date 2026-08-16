import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bookmark, Check, Pencil, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { usePersistentConnectionId } from '@/stores/connectionStore';
import { useQueryStore } from '@/stores/queryStore';
import { groupByDatabase, useSavedQueryStore } from '@/stores/savedQueryStore';
import { useUIStore } from '@/stores/uiStore';
import { showSuccessToast, showErrorToast } from '@/stores/toastStore';
import { extractErrorMessage } from '@/lib/ipc';
import type { SavedQuery } from '@/lib/types';

const NO_QUERIES: SavedQuery[] = [];

export function SavedQueriesDialog() {
  const open = useSavedQueryStore((s) => s.manageOpen);
  const setOpen = useSavedQueryStore((s) => s.setManageOpen);
  const connectionId = usePersistentConnectionId();
  const queries = useSavedQueryStore(
    (s) => (connectionId ? s.byConnection[connectionId] : undefined) ?? NO_QUERIES,
  );
  const pushModal = useUIStore((s) => s.pushModal);
  const popModal = useUIStore((s) => s.popModal);

  const [search, setSearch] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      pushModal('savedQueries');
      return () => popModal('savedQueries');
    }
  }, [open, pushModal, popModal]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setRenamingId(null);
      setConfirmDeleteId(null);
      return;
    }
    if (connectionId) void useSavedQueryStore.getState().load(connectionId);
  }, [open, connectionId]);

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matching = needle
      ? queries.filter((q) =>
          [q.name, q.description ?? '', q.sql].some((f) => f.toLowerCase().includes(needle)),
        )
      : queries;
    return groupByDatabase(matching);
  }, [queries, search]);

  const handleOpenQuery = useCallback(
    (query: SavedQuery) => {
      useQueryStore.getState().openSavedQuery(query);
      setOpen(false);
    },
    [setOpen],
  );

  const handleRename = useCallback(async (query: SavedQuery, next: string) => {
    setRenamingId(null);
    const name = next.trim();
    if (!name || name === query.name) return;
    try {
      await useSavedQueryStore.getState().save({
        id: query.id,
        connection_id: query.connection_id,
        database: query.database,
        name,
        description: query.description,
        sql: query.sql,
        created_at: query.created_at,
      });
      showSuccessToast(`Renamed to "${name}"`);
    } catch (e) {
      showErrorToast(`Rename failed: ${extractErrorMessage(e)}`);
    }
  }, []);

  const handleDelete = useCallback(async (query: SavedQuery) => {
    setConfirmDeleteId(null);
    try {
      await useSavedQueryStore.getState().remove(query.id, query.connection_id);
      showSuccessToast(`"${query.name}" deleted`);
    } catch (e) {
      showErrorToast(`Delete failed: ${extractErrorMessage(e)}`);
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Saved Queries</DialogTitle>
          <DialogDescription>
            Open, rename or delete the queries saved on this connection.
          </DialogDescription>
        </DialogHeader>

        <Input
          value={search}
          autoFocus
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search saved queries..."
        />

        <div className="max-h-80 overflow-y-auto">
          {groups.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">
              {queries.length === 0
                ? 'No saved queries on this connection yet.'
                : 'No saved query matches your search.'}
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.database ?? '__all__'} className="mb-2">
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {group.database ?? 'All databases'}
                </div>
                {group.queries.map((query) => (
                  <div
                    key={query.id}
                    className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50"
                  >
                    <Bookmark className="size-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      {renamingId === query.id ? (
                        <Input
                          value={renameValue}
                          autoFocus
                          className="h-7 text-sm"
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRename(query, renameValue);
                            if (e.key === 'Escape') {
                              e.stopPropagation();
                              setRenamingId(null);
                            }
                          }}
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm">{query.name}</span>
                          {query.database && (
                            <Badge variant="secondary" className="shrink-0 text-[10px]">
                              {query.database}
                            </Badge>
                          )}
                        </div>
                      )}
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {query.sql.replace(/\s+/g, ' ')}
                      </p>
                    </div>

                    {renamingId === query.id ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label="Confirm rename"
                          onClick={() => handleRename(query, renameValue)}
                        >
                          <Check className="size-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label="Cancel rename"
                          onClick={() => setRenamingId(null)}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    ) : confirmDeleteId === query.id ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="text-xs text-muted-foreground">Delete?</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-destructive hover:text-destructive"
                          onClick={() => handleDelete(query)}
                        >
                          <Check className="size-3.5" />
                          Yes
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => handleOpenQuery(query)}
                        >
                          Open
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label={`Rename ${query.name}`}
                          onClick={() => {
                            setRenameValue(query.name);
                            setConfirmDeleteId(null);
                            setRenamingId(query.id);
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-destructive hover:text-destructive"
                          aria-label={`Delete ${query.name}`}
                          onClick={() => {
                            setRenamingId(null);
                            setConfirmDeleteId(query.id);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
