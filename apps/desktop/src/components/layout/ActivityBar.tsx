import { useActivityStore, type ActivityEntry } from '@/stores/activityStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import {
  ChevronUp,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Terminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export function ActivityBar() {
  const { entries, expanded, toggleExpanded, clear } = useActivityStore();

  const lastEntry = entries[0];
  const runningCount = entries.filter((e) => e.status === 'running').length;
  const errorCount = entries.filter((e) => e.status === 'error').length;

  return (
    <Collapsible open={expanded} onOpenChange={toggleExpanded}>
      {/* Collapsed summary bar — always visible */}
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center gap-2 border-t border-border bg-muted/50 px-3 py-1 text-[11px] text-muted-foreground hover:bg-muted/80">
          <Terminal className="h-3 w-3 shrink-0" />
          <span className="font-medium">Activity</span>

          {entries.length > 0 && (
            <Badge variant="secondary" className="h-3.5 px-1 text-[9px]">
              {entries.length}
            </Badge>
          )}

          {runningCount > 0 && (
            <span className="flex items-center gap-1 text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
              {runningCount} running
            </span>
          )}

          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-destructive">
              <XCircle className="h-3 w-3" />
              {errorCount} error{errorCount > 1 ? 's' : ''}
            </span>
          )}

          {/* Preview of last entry */}
          {lastEntry && !expanded && (
            <span className="ml-1 flex-1 truncate text-left">
              <StatusIcon entry={lastEntry} />
              {' '}
              <span className="text-muted-foreground">{formatTime(lastEntry.timestamp)}</span>
              {' — '}
              <span className="text-foreground/70">{truncateSql(lastEntry.sql)}</span>
              {lastEntry.durationMs != null && (
                <span className="text-muted-foreground"> ({lastEntry.durationMs}ms)</span>
              )}
            </span>
          )}

          <ChevronUp
            className={cn(
              'ml-auto h-3 w-3 shrink-0 transition-transform duration-200',
              !expanded && 'rotate-180',
            )}
          />
        </button>
      </CollapsibleTrigger>

      {/* Expanded panel */}
      <CollapsibleContent>
        <div className="border-t border-border bg-muted/30" style={{ maxHeight: '200px' }}>
          <div className="flex items-center justify-between border-b border-border/50 px-3 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Query Log
            </span>
            {entries.length > 0 && (
              <Button
                variant="ghost"
                size="xs"
                onClick={(e) => {
                  e.stopPropagation();
                  clear();
                }}
                className="h-5 gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </Button>
            )}
          </div>

          <ScrollArea style={{ maxHeight: '168px' }}>
            {entries.length === 0 ? (
              <p className="px-3 py-3 text-center text-[11px] text-muted-foreground">
                No queries executed yet
              </p>
            ) : (
              <div className="divide-y divide-border/30">
                {entries.map((entry) => (
                  <ActivityRow key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  return (
    <div className="flex items-start gap-2 px-3 py-1.5 text-[11px]">
      <StatusIcon entry={entry} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 text-muted-foreground">{formatTime(entry.timestamp)}</span>
          {entry.durationMs != null && (
            <Badge
              variant={entry.status === 'error' ? 'destructive' : 'secondary'}
              className="h-3.5 px-1 text-[9px]"
            >
              {entry.durationMs}ms
            </Badge>
          )}
          {entry.rowCount != null && (
            <span className="text-muted-foreground">
              {entry.rowCount} row{entry.rowCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <p
          className={cn(
            'mt-0.5 truncate font-mono',
            entry.status === 'error' ? 'text-destructive' : 'text-foreground/80',
          )}
        >
          {entry.sql}
        </p>
        {entry.error && (
          <p className="mt-0.5 truncate text-destructive/80">{entry.error}</p>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ entry }: { entry: ActivityEntry }) {
  if (entry.status === 'running') {
    return <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-primary" />;
  }
  if (entry.status === 'error') {
    return <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />;
  }
  return <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-primary" />;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function truncateSql(sql: string): string {
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  return oneLine.length > 80 ? oneLine.slice(0, 77) + '...' : oneLine;
}
