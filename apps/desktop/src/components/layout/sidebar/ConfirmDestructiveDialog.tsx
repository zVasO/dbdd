import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Operation = 'drop' | 'truncate' | 'rename';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operation: Operation;
  tableName: string;
  onConfirm: (newName?: string) => void;
}

export function ConfirmDestructiveDialog({ open, onOpenChange, operation, tableName, onConfirm }: Props) {
  const [typedName, setTypedName] = useState('');
  const [newName, setNewName] = useState(tableName);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setTypedName('');
      setNewName(tableName);
    }
    onOpenChange(next);
  };

  if (operation === 'drop') {
    const confirmed = typedName === tableName;
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Drop table &ldquo;{tableName}&rdquo;</DialogTitle>
            <DialogDescription>
              This action <strong>cannot be undone</strong>. The table and all its data will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <p className="text-sm text-muted-foreground">
              Type <span className="font-mono font-semibold text-foreground">{tableName}</span> to confirm.
            </p>
            <Input
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder={tableName}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={!confirmed}
                onClick={() => { onConfirm(); handleOpenChange(false); }}
              >
                Drop Table
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (operation === 'truncate') {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Truncate table &ldquo;{tableName}&rdquo;</DialogTitle>
            <DialogDescription>
              All rows will be permanently deleted. The table structure will remain intact.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => { onConfirm(); handleOpenChange(false); }}
            >
              Truncate
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // rename
  const trimmedName = newName.trim();
  const canRename = trimmedName.length > 0 && trimmedName !== tableName;
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rename table &ldquo;{tableName}&rdquo;</DialogTitle>
          <DialogDescription>Enter a new name for this table.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canRename) {
                onConfirm(trimmedName);
                handleOpenChange(false);
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
            <Button
              disabled={!canRename}
              onClick={() => { onConfirm(trimmedName); handleOpenChange(false); }}
            >
              Rename
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
