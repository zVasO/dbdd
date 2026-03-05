import { ShieldCheck, ShieldOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface MaskingToggleProps {
  columnName: string;
  enabled: boolean;
  onToggle: () => void;
}

export function MaskingToggle({
  columnName,
  enabled,
  onToggle,
}: MaskingToggleProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            'inline-flex items-center justify-center size-5 rounded-sm transition-colors',
            enabled
              ? 'text-primary hover:text-primary/80'
              : 'text-muted-foreground hover:text-foreground',
          )}
          aria-label={
            enabled
              ? `Disable masking for ${columnName}`
              : `Enable masking for ${columnName}`
          }
        >
          {enabled ? (
            <ShieldCheck className="size-3.5" />
          ) : (
            <ShieldOff className="size-3.5" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {enabled ? 'Masking active' : 'Enable masking'}: {columnName}
      </TooltipContent>
    </Tooltip>
  );
}
