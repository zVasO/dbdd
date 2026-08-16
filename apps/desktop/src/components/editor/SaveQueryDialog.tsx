import { useCallback, useEffect, useRef, useState } from 'react';
import { Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSavedQueryStore } from '@/stores/savedQueryStore';
import { useSchemaStore } from '@/stores/schemaStore';
import { useUIStore } from '@/stores/uiStore';
import { showSuccessToast, showErrorToast } from '@/stores/toastStore';
import { extractErrorMessage } from '@/lib/ipc';
import type { SavedQuery } from '@/lib/types';

/** Radix Select has no empty-string value, so the connection-wide option needs a sentinel. */
const ALL_DATABASES = '__all__';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string | null;
  sql: string;
  /** Existing query to update — omit to create a new one */
  query?: SavedQuery | null;
  /** Database pre-selected when creating */
  defaultDatabase?: string | null;
  onSaved?: (query: SavedQuery) => void;
}

export function SaveQueryDialog({
  open,
  onOpenChange,
  connectionId,
  sql,
  query,
  defaultDatabase,
  onSaved,
}: Props) {
  const databases = useSchemaStore((s) => s.databases);
  const pushModal = useUIStore((s) => s.pushModal);
  const popModal = useUIStore((s) => s.popModal);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [database, setDatabase] = useState<string>(ALL_DATABASES);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const isEditing = !!query;

  useEffect(() => {
    if (open) {
      pushModal('saveQuery');
      return () => popModal('saveQuery');
    }
  }, [open, pushModal, popModal]);

  // Seed the form each time it opens — the same instance serves every tab.
  useEffect(() => {
    if (!open) return;
    setName(query?.name ?? '');
    setDescription(query?.description ?? '');
    setDatabase(query?.database ?? defaultDatabase ?? ALL_DATABASES);
  }, [open, query, defaultDatabase]);

  const handleSave = useCallback(async () => {
    // The Enter path bypasses the disabled button, so held keys would otherwise
    // mint a fresh id per repeat and save the query several times over. The
    // guard is a ref because repeats can re-enter before `saving` re-renders.
    if (!connectionId || !name.trim() || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await useSavedQueryStore.getState().save({
        id: query?.id ?? crypto.randomUUID(),
        connection_id: connectionId,
        database: database === ALL_DATABASES ? null : database,
        name: name.trim(),
        description: description.trim() || null,
        sql,
        created_at: query?.created_at,
      });
      showSuccessToast(`"${saved.name}" ${isEditing ? 'updated' : 'saved'}`);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (e) {
      showErrorToast(`Save failed: ${extractErrorMessage(e)}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [connectionId, name, description, database, sql, query, isEditing, onSaved, onOpenChange]);

  // A query saved against a database that is not in the list (not yet loaded,
  // or dropped) still needs its own option or the Select would show blank.
  const databaseNames = databases.map((d) => d.name);
  const selectedDatabase = database !== ALL_DATABASES ? database : null;
  if (selectedDatabase && !databaseNames.includes(selectedDatabase)) {
    databaseNames.unshift(selectedDatabase);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Update Saved Query' : 'Save Query'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the name, description or database of this saved query.'
              : 'Name this query to find it again from the command palette.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="saved-query-name">Name</Label>
            <Input
              id="saved-query-name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
              }}
              placeholder="e.g. Daily active users"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="saved-query-description">Description</Label>
            <Input
              id="saved-query-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="saved-query-database">Database</Label>
            <Select value={database} onValueChange={setDatabase}>
              <SelectTrigger id="saved-query-database" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_DATABASES}>All databases</SelectItem>
                {databaseNames.map((db) => (
                  <SelectItem key={db} value={db}>
                    {db}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="size-3.5" />
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || !connectionId || saving}>
            <Save className="size-3.5" />
            {isEditing ? 'Update' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
