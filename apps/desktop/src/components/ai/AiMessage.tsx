import { useState, useCallback } from 'react';
import { User, Bot, Copy, Play, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { ChatMessage } from '@/stores/aiStore';

interface AiMessageProps {
  message: ChatMessage;
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

function SqlCodeBlock({ sql, onInsertSQL }: { sql: string; onInsertSQL?: (sql: string) => void }) {
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
    <div className="group relative my-2 rounded-md border bg-muted/50 overflow-hidden">
      <div className="flex items-center justify-between border-b bg-muted/80 px-3 py-1">
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

export function AiMessage({ message, onInsertSQL }: AiMessageProps) {
  const isUser = message.role === 'user';
  const segments = parseContent(message.content);

  return (
    <div
      className={cn(
        'flex gap-3 px-4 py-3',
        isUser ? 'bg-transparent' : 'bg-muted/30',
      )}
    >
      <div
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-md',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary text-secondary-foreground',
        )}
      >
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>

      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="mb-1 text-xs text-muted-foreground">
          {isUser ? 'You' : 'AI Assistant'}
        </div>

        <div className="text-sm leading-relaxed">
          {segments.length === 0 && message.generating && (
            <span className="inline-block h-4 w-1.5 animate-pulse bg-foreground/70 rounded-sm" />
          )}

          {segments.map((segment, i) => {
            if (segment.type === 'sql') {
              return (
                <SqlCodeBlock
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

          {message.generating && segments.length > 0 && (
            <span className="inline-block h-4 w-1.5 animate-pulse bg-foreground/70 rounded-sm ml-0.5" />
          )}
        </div>
      </div>
    </div>
  );
}
