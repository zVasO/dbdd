import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Clock,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Eye,
  GitCompareArrows,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  getVersions,
  deleteVersions,
  formatRelativeTime,
  type QueryVersion,
} from '@/lib/queryVersioning';

interface QueryTimelineProps {
  tabId: string;
  onRestore: (sql: string) => void;
}

export function QueryTimeline({ tabId, onRestore }: QueryTimelineProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [versions, setVersions] = useState<QueryVersion[]>([]);
  const [viewingSql, setViewingSql] = useState<string | null>(null);
  const [selectedForCompare, setSelectedForCompare] = useState<Set<string>>(
    new Set(),
  );
  const [showingDiff, setShowingDiff] = useState(false);

  // Reload versions on mount and when tabId changes
  useEffect(() => {
    setVersions(getVersions(tabId));
  }, [tabId]);

  // Periodically update relative timestamps
  useEffect(() => {
    if (collapsed || versions.length === 0) return;
    const timer = setInterval(() => {
      setVersions(getVersions(tabId));
    }, 30_000);
    return () => clearInterval(timer);
  }, [tabId, collapsed, versions.length]);

  const handleClearAll = useCallback(() => {
    deleteVersions(tabId);
    setVersions([]);
    setSelectedForCompare(new Set());
  }, [tabId]);

  const handleRestore = useCallback(
    (sql: string) => {
      onRestore(sql);
    },
    [onRestore],
  );

  const toggleCompareSelection = useCallback((id: string) => {
    setSelectedForCompare((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        // Max 2 selections
        if (next.size >= 2) {
          const first = next.values().next().value;
          if (first !== undefined) next.delete(first);
        }
        next.add(id);
      }
      return next;
    });
  }, []);

  const compareVersions = useMemo(() => {
    if (selectedForCompare.size !== 2) return null;
    const ids = Array.from(selectedForCompare);
    const left = versions.find((v) => v.id === ids[0]);
    const right = versions.find((v) => v.id === ids[1]);
    if (!left || !right) return null;
    // Sort by timestamp so older is left
    return left.timestamp <= right.timestamp
      ? { left, right }
      : { left: right, right: left };
  }, [selectedForCompare, versions]);

  return (
    <div className="border-t">
      {/* Collapse header */}
      <button
        type="button"
        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent/50 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          <ChevronRight className="size-3.5" />
        ) : (
          <ChevronDown className="size-3.5" />
        )}
        <Clock className="size-3.5 text-muted-foreground" />
        <span className="font-medium">Query History</span>
        {versions.length > 0 && (
          <Badge variant="secondary" className="text-[10px] ml-1">
            {versions.length}
          </Badge>
        )}
      </button>

      {!collapsed && (
        <div className="border-t">
          {/* Toolbar */}
          <div className="flex items-center gap-1.5 px-3 py-1 border-b">
            {selectedForCompare.size === 2 && (
              <Button
                size="xs"
                variant="outline"
                onClick={() => setShowingDiff(true)}
              >
                <GitCompareArrows className="size-3" />
                Compare
              </Button>
            )}
            {selectedForCompare.size > 0 && selectedForCompare.size < 2 && (
              <span className="text-[10px] text-muted-foreground">
                Select one more to compare
              </span>
            )}
            <div className="flex-1" />
            {versions.length > 0 && (
              <Button
                size="xs"
                variant="ghost"
                className="text-destructive"
                onClick={handleClearAll}
              >
                <Trash2 className="size-3" />
                Clear
              </Button>
            )}
          </div>

          {/* Version list */}
          <ScrollArea className="max-h-[200px]">
            <div className="flex flex-col">
              {versions.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-4">
                  No query versions saved for this tab
                </div>
              )}

              {versions.map((version) => {
                const isSelected = selectedForCompare.has(version.id);
                const preview =
                  version.sql.slice(0, 60).replace(/\s+/g, ' ') +
                  (version.sql.length > 60 ? '...' : '');

                return (
                  <div
                    key={version.id}
                    className={cn(
                      'flex items-start gap-2 px-3 py-1.5 border-b last:border-b-0 hover:bg-muted/30',
                      isSelected && 'bg-accent/50',
                    )}
                  >
                    {/* Compare checkbox */}
                    <button
                      type="button"
                      className={cn(
                        'mt-0.5 size-3.5 rounded-sm border shrink-0 flex items-center justify-center',
                        isSelected
                          ? 'bg-primary border-primary'
                          : 'border-input',
                      )}
                      onClick={() => toggleCompareSelection(version.id)}
                      title="Select for comparison"
                    >
                      {isSelected && (
                        <div className="size-1.5 rounded-full bg-primary-foreground" />
                      )}
                    </button>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">
                          {formatRelativeTime(version.timestamp)}
                        </span>
                        {version.rowCount !== null && (
                          <Badge
                            variant="secondary"
                            className="text-[10px]"
                          >
                            {version.rowCount} row
                            {version.rowCount !== 1 ? 's' : ''}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs font-mono text-muted-foreground truncate mt-0.5">
                        {preview}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        className="p-1 rounded-sm hover:bg-accent"
                        onClick={() => setViewingSql(version.sql)}
                        title="View full SQL"
                      >
                        <Eye className="size-3 text-muted-foreground" />
                      </button>
                      <button
                        type="button"
                        className="p-1 rounded-sm hover:bg-accent"
                        onClick={() => handleRestore(version.sql)}
                        title="Restore this version"
                      >
                        <RotateCcw className="size-3 text-muted-foreground" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* View SQL dialog */}
      <Dialog
        open={viewingSql !== null}
        onOpenChange={(val) => {
          if (!val) setViewingSql(null);
        }}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Query Version</DialogTitle>
            <DialogDescription>Full SQL content</DialogDescription>
          </DialogHeader>
          <pre className="text-xs font-mono bg-muted/30 rounded-md border p-3 overflow-auto max-h-[300px] whitespace-pre-wrap">
            {viewingSql}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingSql(null)}>
              Close
            </Button>
            <Button
              onClick={() => {
                if (viewingSql) handleRestore(viewingSql);
                setViewingSql(null);
              }}
            >
              <RotateCcw className="size-3.5" />
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Compare dialog */}
      <Dialog
        open={showingDiff}
        onOpenChange={(val) => {
          if (!val) setShowingDiff(false);
        }}
      >
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>Compare Versions</DialogTitle>
            <DialogDescription>
              Side-by-side SQL comparison
            </DialogDescription>
          </DialogHeader>
          {compareVersions && (
            <div className="flex gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground mb-1">
                  Older ({formatRelativeTime(compareVersions.left.timestamp)})
                </div>
                <pre className="text-xs font-mono bg-red-500/5 border rounded-md p-3 overflow-auto max-h-[300px] whitespace-pre-wrap">
                  {compareVersions.left.sql}
                </pre>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground mb-1">
                  Newer ({formatRelativeTime(compareVersions.right.timestamp)})
                </div>
                <pre className="text-xs font-mono bg-green-500/5 border rounded-md p-3 overflow-auto max-h-[300px] whitespace-pre-wrap">
                  {compareVersions.right.sql}
                </pre>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowingDiff(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
