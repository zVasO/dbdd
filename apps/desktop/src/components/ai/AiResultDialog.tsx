import { useState, useCallback } from 'react';
import { Copy, Play, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface AiResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  content: string;
  loading: boolean;
  onInsertSQL?: (sql: string) => void;
}

interface ParsedSegment {
  type: 'text' | 'sql';
  content: string;
}

function parseContent(content: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  const codeBlockRegex = /```sql\s*\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'sql', content: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'text', content: content.slice(lastIndex) });
  }

  return segments;
}

function SqlBlock({ sql, onInsertSQL }: { sql: string; onInsertSQL?: (sql: string) => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [sql]);

  const handleInsert = useCallback(() => {
    onInsertSQL?.(sql);
  }, [sql, onInsertSQL]);

  return (
    <div className="my-3 rounded-md border bg-muted/50 overflow-hidden">
      <div className="flex items-center justify-between border-b bg-muted/80 px-3 py-1.5">
        <span className="text-xs text-muted-foreground font-mono">SQL</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleCopy}
            title="Copy SQL"
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </Button>
          {onInsertSQL && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleInsert}
              title="Insert to Editor"
            >
              <Play className="size-3" />
            </Button>
          )}
        </div>
      </div>
      <pre className="overflow-x-auto p-3 text-sm font-mono leading-relaxed">
        <code>{sql}</code>
      </pre>
    </div>
  );
}

export function AiResultDialog({
  open,
  onOpenChange,
  title,
  content,
  loading,
  onInsertSQL,
}: AiResultDialogProps) {
  const segments = parseContent(content);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            AI-generated analysis of your query
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div
                className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent mb-3"
                style={{
                  borderColor: 'var(--color-accent)',
                  borderTopColor: 'transparent',
                }}
              />
              <p className="text-sm text-muted-foreground">
                Analyzing your query...
              </p>
            </div>
          ) : (
            <div className="text-sm leading-relaxed pb-4">
              {segments.map((segment, i) => {
                if (segment.type === 'sql') {
                  return (
                    <SqlBlock
                      key={i}
                      sql={segment.content}
                      onInsertSQL={onInsertSQL}
                    />
                  );
                }
                return (
                  <span key={i} className="whitespace-pre-wrap break-words">
                    {segment.content}
                  </span>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
