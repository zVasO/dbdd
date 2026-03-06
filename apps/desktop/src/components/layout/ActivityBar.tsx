import { useState, useCallback } from 'react';
import { useActivityStore, type ActivityEntry } from '@/stores/activityStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  ChevronUp,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Terminal,
  Copy,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type FilterType = 'all' | 'success' | 'error' | 'running';

export function ActivityBar() {
  const { entries, expanded, toggleExpanded, clear } = useActivityStore();
  const [filter, setFilter] = useState<FilterType>('all');

  const lastEntry = entries[0];
  const runningCount = entries.filter((e) => e.status === 'running').length;
  const errorCount = entries.filter((e) => e.status === 'error').length;

  const filteredEntries =
    filter === 'all'
      ? entries
      : entries.filter((e) => e.status === filter);

  return (
    <Collapsible open={expanded} onOpenChange={toggleExpanded}>
      {/* Collapsed summary bar -- always visible */}
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center gap-2 border-t border-border bg-muted px-3 py-1 text-[11px] text-muted-foreground hover:bg-muted/80">
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
              {' \u2014 '}
              <span className="text-foreground/70">{truncateSql(lastEntry.sql)}</span>
              {lastEntry.durationMs != null && (
                <span className="text-muted-foreground"> ({formatDuration(lastEntry.durationMs)})</span>
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
        <div className="flex flex-col border-t border-border bg-muted/30" style={{ maxHeight: '200px' }}>
          <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1">
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mr-2">
                Query Log
              </span>

              {/* Filter buttons */}
              <FilterButton
                label="All"
                count={entries.length}
                active={filter === 'all'}
                onClick={() => setFilter('all')}
              />
              <FilterButton
                label="Success"
                count={entries.filter((e) => e.status === 'success').length}
                active={filter === 'success'}
                onClick={() => setFilter('success')}
                variant="success"
              />
              <FilterButton
                label="Error"
                count={entries.filter((e) => e.status === 'error').length}
                active={filter === 'error'}
                onClick={() => setFilter('error')}
                variant="error"
              />
              <FilterButton
                label="Running"
                count={runningCount}
                active={filter === 'running'}
                onClick={() => setFilter('running')}
                variant="running"
              />
            </div>

            {entries.length > 0 && (
              <Button
                variant="ghost"
                size="xs"
                onClick={(e) => {
                  e.stopPropagation();
                  clear();
                  setFilter('all');
                }}
                className="h-5 gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </Button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredEntries.length === 0 ? (
              <p className="px-3 py-3 text-center text-[11px] text-muted-foreground">
                {entries.length === 0
                  ? 'No queries executed yet'
                  : `No ${filter} queries`}
              </p>
            ) : (
              <div className="divide-y divide-border">
                {filteredEntries.map((entry) => (
                  <ActivityRow key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function FilterButton({
  label,
  count,
  active,
  onClick,
  variant,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  variant?: 'success' | 'error' | 'running';
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors',
        active
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
        variant === 'error' && active && 'text-destructive',
        variant === 'success' && active && 'text-primary',
        variant === 'running' && active && 'text-primary',
      )}
    >
      {label}
      {count > 0 && (
        <span className="text-[9px] opacity-70">{count}</span>
      )}
    </button>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(entry.sql).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [entry.sql]);

  return (
    <div className="group flex items-start gap-2 px-3 py-1.5 text-[11px] hover:bg-muted/50">
      <StatusIcon entry={entry} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 text-muted-foreground">{formatTime(entry.timestamp)}</span>
          {entry.durationMs != null && (
            <Badge
              variant={entry.status === 'error' ? 'destructive' : 'secondary'}
              className="h-3.5 px-1 text-[9px]"
            >
              {formatDuration(entry.durationMs)}
            </Badge>
          )}
          {entry.rowCount != null && (
            <span className="text-muted-foreground">
              {entry.rowCount.toLocaleString()} row{entry.rowCount !== 1 ? 's' : ''}
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

      {/* Copy SQL button */}
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleCopy}
              className={cn(
                'mt-0.5 shrink-0 rounded p-0.5 transition-opacity',
                copied
                  ? 'text-primary opacity-100'
                  : 'text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100',
              )}
            >
              {copied ? (
                <Check className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-[10px]">
            {copied ? 'Copied!' : 'Copy SQL'}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = ((ms % 60_000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

function truncateSql(sql: string): string {
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  return oneLine.length > 80 ? oneLine.slice(0, 77) + '...' : oneLine;
}
