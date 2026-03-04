import { useChangeStore } from '@/stores/changeStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { ipc } from '@/lib/ipc';
import { useQueryStore } from '@/stores/queryStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { Play, Save, Eye, Undo2, Redo2, Trash2, Loader2 } from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';

interface Props {
  isExecuting: boolean;
  onRun: () => void;
}

export function EditorToolbar({ isExecuting, onRun }: Props) {
  const pendingCount = useChangeStore((s) => s.pendingCount());
  const hasPending = pendingCount > 0;
  const undo = useChangeStore((s) => s.undo);
  const redo = useChangeStore((s) => s.redo);
  const discard = useChangeStore((s) => s.discard);
  const setPreviewOpen = useChangeStore((s) => s.setPreviewOpen);
  const generateSql = useChangeStore((s) => s.generateSql);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const [isCommitting, setIsCommitting] = useState(false);

  const handleCommit = useCallback(async () => {
    if (!activeConnectionId || !hasPending) return;
    setIsCommitting(true);
    try {
      const statements = generateSql();
      await ipc.executeBatch(activeConnectionId, statements);
      useChangeStore.getState().discard();
      // Re-execute the active query to refresh the grid
      const { activeTabId, executeQuery } = useQueryStore.getState();
      if (activeTabId) {
        executeQuery(activeConnectionId, activeTabId);
      }
    } catch (err) {
      console.error('Commit failed:', err);
    } finally {
      setIsCommitting(false);
    }
  }, [activeConnectionId, hasPending, generateSql]);

  // Listen for Ctrl+S commit event from AppLayout
  useEffect(() => {
    const handler = () => { handleCommit(); };
    document.addEventListener('dataforge:commit', handler);
    return () => document.removeEventListener('dataforge:commit', handler);
  }, [handleCommit]);

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex items-center gap-1 border-b border-border bg-muted px-2"
        style={{ height: 'var(--toolbar-height)' }}
      >
        {/* Run button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              onClick={onRun}
              disabled={isExecuting}
              className="gap-1.5 text-xs"
            >
              {isExecuting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Run
            </Button>
          </TooltipTrigger>
          <TooltipContent>Run query (Ctrl+Enter)</TooltipContent>
        </Tooltip>

        <div className="mx-1 h-4 w-px bg-border" />

        {/* Undo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" onClick={undo} className="h-7 w-7">
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
        </Tooltip>

        {/* Redo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" onClick={redo} className="h-7 w-7">
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo (Ctrl+Shift+Z)</TooltipContent>
        </Tooltip>

        <div className="flex-1" />

        {/* Pending changes indicator + actions */}
        {hasPending && (
          <div className="flex items-center gap-1">
            <Badge variant="secondary" className="gap-1 text-[10px]">
              {pendingCount} pending
            </Badge>

            {/* Preview SQL */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPreviewOpen(true)}
                  className="gap-1 text-xs"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Preview
                </Button>
              </TooltipTrigger>
              <TooltipContent>Preview SQL (Ctrl+Shift+P)</TooltipContent>
            </Tooltip>

            {/* Discard */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={discard}
                  className="gap-1 text-xs text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Discard
                </Button>
              </TooltipTrigger>
              <TooltipContent>Discard all changes</TooltipContent>
            </Tooltip>

            {/* Commit */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={handleCommit}
                  disabled={isCommitting}
                  className="gap-1 text-xs"
                >
                  {isCommitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  Commit
                </Button>
              </TooltipTrigger>
              <TooltipContent>Commit changes (Ctrl+S)</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
