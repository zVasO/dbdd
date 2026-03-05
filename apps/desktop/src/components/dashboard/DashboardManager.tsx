import { useState, useRef, useEffect } from 'react';
import {
  LayoutDashboard, Plus, Trash2, Check, X, Pencil,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useDashboardStore } from '@/stores/dashboardStore';

export function DashboardManager() {
  const dashboards = useDashboardStore((s) => s.dashboards);
  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId);
  const createDashboard = useDashboardStore((s) => s.createDashboard);
  const deleteDashboard = useDashboardStore((s) => s.deleteDashboard);
  const renameDashboard = useDashboardStore((s) => s.renameDashboard);
  const setActiveDashboard = useDashboardStore((s) => s.setActiveDashboard);

  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreating) {
      createInputRef.current?.focus();
    }
  }, [isCreating]);

  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    createDashboard(name);
    setNewName('');
    setIsCreating(false);
  };

  const handleRename = (id: string) => {
    const name = renameValue.trim();
    if (!name) return;
    renameDashboard(id, name);
    setRenamingId(null);
    setRenameValue('');
  };

  const handleDelete = (id: string) => {
    if (deletingId === id) {
      deleteDashboard(id);
      setDeletingId(null);
    } else {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
    }
  };

  const activeDashboard = dashboards.find((d) => d.id === activeDashboardId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <LayoutDashboard className="size-3.5" />
          <span className="max-w-[150px] truncate">
            {activeDashboard?.name ?? 'Dashboards'}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Dashboards</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          {dashboards.length === 0 && (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
              No dashboards yet
            </div>
          )}

          {dashboards.map((d) => (
            <div key={d.id} className="group relative">
              {renamingId === d.id ? (
                <div className="flex items-center gap-1 px-1 py-0.5">
                  <Input
                    ref={renameInputRef}
                    className="h-7 text-xs"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(d.id);
                      if (e.key === 'Escape') {
                        setRenamingId(null);
                        setRenameValue('');
                      }
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleRename(d.id)}
                  >
                    <Check className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => { setRenamingId(null); setRenameValue(''); }}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              ) : (
                <DropdownMenuItem
                  className={cn(
                    'pr-1',
                    d.id === activeDashboardId && 'bg-accent',
                  )}
                  onSelect={() => setActiveDashboard(d.id)}
                >
                  <LayoutDashboard className="size-3.5 shrink-0" />
                  <span className="flex-1 truncate">{d.name}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                    {d.widgets.length}
                  </span>
                  <div
                    className="ml-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setRenamingId(d.id);
                        setRenameValue(d.name);
                      }}
                    >
                      <Pencil className="size-2.5" />
                    </Button>
                    <Button
                      variant={deletingId === d.id ? 'destructive' : 'ghost'}
                      size="icon-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        handleDelete(d.id);
                      }}
                    >
                      <Trash2 className="size-2.5" />
                    </Button>
                  </div>
                </DropdownMenuItem>
              )}
            </div>
          ))}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {isCreating ? (
          <div className="flex items-center gap-1 px-1 py-1">
            <Input
              ref={createInputRef}
              className="h-7 text-xs"
              placeholder="Dashboard name..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') {
                  setIsCreating(false);
                  setNewName('');
                }
              }}
            />
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleCreate}
              disabled={!newName.trim()}
            >
              <Check className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => { setIsCreating(false); setNewName(''); }}
            >
              <X className="size-3" />
            </Button>
          </div>
        ) : (
          <DropdownMenuItem onSelect={() => setIsCreating(true)}>
            <Plus className="size-3.5" />
            New Dashboard
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
