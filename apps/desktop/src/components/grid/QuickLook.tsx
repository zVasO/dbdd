import { useState, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Copy, Check, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CellValue } from '@/lib/types';

interface QuickLookProps {
  open: boolean;
  onClose: () => void;
  cell: CellValue | null;
  columnName: string;
  columnType: string;
}

export function QuickLook({ open, onClose, cell, columnName, columnType }: QuickLookProps) {
  const [copied, setCopied] = useState(false);

  const rawValue = useMemo(() => {
    if (!cell) return '';
    return getRawValue(cell);
  }, [cell]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(rawValue).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [rawValue]);

  if (!cell) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="sm:max-w-[500px] max-h-[60vh] flex flex-col gap-0 p-0 overflow-hidden"
        onKeyDown={(e) => e.stopPropagation()}
      >
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground shrink-0" />
            <DialogTitle className="text-sm font-semibold truncate">
              {columnName}
            </DialogTitle>
            <Badge variant="secondary" className="h-4 rounded px-1.5 py-0 text-[10px] font-normal shrink-0">
              {columnType}
            </Badge>
            <div className="ml-auto shrink-0">
              <button
                onClick={handleCopy}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors',
                  copied
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                )}
              >
                {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
              </button>
            </div>
          </div>
          <DialogDescription className="sr-only">
            Quick look at the value of column {columnName}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto px-4 py-3 min-h-0">
          <CellContent cell={cell} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CellContent({ cell }: { cell: CellValue }) {
  switch (cell.type) {
    case 'Null':
      return (
        <div className="flex items-center justify-center py-8">
          <span className="rounded-md bg-muted px-3 py-1.5 text-sm font-mono italic text-muted-foreground">
            NULL
          </span>
        </div>
      );
    case 'Integer':
      return (
        <div className="flex items-center justify-center py-6">
          <span className="text-2xl font-mono tabular-nums text-foreground">
            {cell.value.toLocaleString()}
          </span>
        </div>
      );
    case 'Float':
      return (
        <div className="flex items-center justify-center py-6">
          <span className="text-2xl font-mono tabular-nums text-foreground">
            {cell.value.toLocaleString(undefined, { maximumFractionDigits: 20 })}
          </span>
        </div>
      );
    case 'Boolean':
      return (
        <div className="flex items-center justify-center py-6">
          <Badge
            variant={cell.value ? 'default' : 'secondary'}
            className={cn(
              'text-sm px-4 py-1.5 font-mono',
              cell.value ? 'bg-green-600 hover:bg-green-600 text-white' : 'bg-muted text-muted-foreground',
            )}
          >
            {cell.value ? 'true' : 'false'}
          </Badge>
        </div>
      );
    case 'Text':
      return (
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
          {cell.value}
        </pre>
      );
    case 'Json':
      return (
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
          {JSON.stringify(cell.value, null, 2)}
        </pre>
      );
    case 'DateTime':
    case 'Date':
    case 'Time':
      return (
        <div className="flex items-center justify-center py-6">
          <span className="font-mono text-lg text-foreground">{cell.value}</span>
        </div>
      );
    case 'Uuid':
      return (
        <div className="flex items-center justify-center py-6">
          <span className="font-mono text-sm text-foreground select-all">{cell.value}</span>
        </div>
      );
    case 'Bytes':
      return (
        <div className="space-y-3">
          <Badge variant="secondary" className="text-[10px]">{cell.value.size} bytes</Badge>
          <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-muted-foreground bg-muted/50 rounded-md p-3">
            {cell.value.preview}
          </pre>
        </div>
      );
    case 'Array':
      return (
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
          {JSON.stringify(cell.value.map(cellToJsonFriendly), null, 2)}
        </pre>
      );
    default:
      return <span className="text-xs text-muted-foreground italic">Unsupported type</span>;
  }
}

function cellToJsonFriendly(cell: CellValue): unknown {
  switch (cell.type) {
    case 'Null': return null;
    case 'Integer':
    case 'Float': return cell.value;
    case 'Boolean': return cell.value;
    case 'Text':
    case 'DateTime':
    case 'Date':
    case 'Time':
    case 'Uuid': return cell.value;
    case 'Json': return cell.value;
    case 'Bytes': return `[${cell.value.size} bytes]`;
    case 'Array': return cell.value.map(cellToJsonFriendly);
    default: return null;
  }
}

function getRawValue(cell: CellValue): string {
  switch (cell.type) {
    case 'Null': return 'NULL';
    case 'Integer':
    case 'Float': return String(cell.value);
    case 'Boolean': return cell.value ? 'true' : 'false';
    case 'Text':
    case 'DateTime':
    case 'Date':
    case 'Time':
    case 'Uuid': return cell.value;
    case 'Json': return JSON.stringify(cell.value, null, 2);
    case 'Bytes': return cell.value.preview;
    case 'Array': return JSON.stringify(cell.value.map(cellToJsonFriendly), null, 2);
    default: return '';
  }
}
