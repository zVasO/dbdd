import React from 'react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { Columns3, Key, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ColumnInfo } from '@/lib/types';
import { formatDataType, HighlightMatch } from './utils';

// ─── Column properties panel ──────────────────────────────────────────────────

export interface ColumnPropertiesProps {
  column: ColumnInfo;
  onClose: () => void;
}

export function ColumnProperties({ column, onClose }: ColumnPropertiesProps) {
  return (
    <div className="border-t border-sidebar-border">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Properties
        </span>
        <button
          onClick={onClose}
          className="rounded-sm p-0.5 hover:bg-sidebar-accent"
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
      <Separator />
      <div className="space-y-1.5 px-3 py-2 text-[11px]">
        <PropertyRow label="Name" value={column.name} highlight />
        <PropertyRow label="Type" value={formatDataType(column.data_type)} />
        <PropertyRow label="Mapped" value={formatDataType(column.mapped_type)} />
        <PropertyRow label="Nullable" value={column.nullable ? 'Yes' : 'No'} />
        <PropertyRow label="Primary Key" value={column.is_primary_key ? 'Yes' : 'No'} />
        <PropertyRow label="Position" value={String(column.ordinal_position)} />
        {column.default_value != null && (
          <PropertyRow label="Default" value={column.default_value} />
        )}
        {column.comment && (
          <PropertyRow label="Comment" value={column.comment} />
        )}
      </div>
    </div>
  );
}

function PropertyRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          'truncate text-right',
          highlight ? 'font-medium text-sidebar-foreground' : 'text-sidebar-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Column node ──────────────────────────────────────────────────────────────

export interface ColumnNodeProps {
  column: ColumnInfo;
  selected: boolean;
  onClick: () => void;
  searchQuery?: string;
}

export function ColumnNode({ column, selected, onClick, searchQuery = '' }: ColumnNodeProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            'flex w-full items-center gap-1.5 px-2 py-0.5 text-left text-[11px] hover:bg-sidebar-accent',
            selected && 'bg-sidebar-accent',
          )}
        >
          {column.is_primary_key ? (
            <Key className="h-3 w-3 shrink-0 text-primary" />
          ) : (
            <Columns3 className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          <span
            className={cn(
              'truncate',
              column.is_primary_key
                ? 'font-medium text-sidebar-foreground'
                : 'text-muted-foreground',
            )}
          >
            <HighlightMatch text={column.name} query={searchQuery} />
          </span>
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
            {formatDataType(column.data_type)}
          </span>
          {column.nullable && (
            <span className="text-[9px] text-muted-foreground/60">?</span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        <p>
          <span className="font-medium">{column.name}</span>{' '}
          <span className="text-muted-foreground">{formatDataType(column.data_type)}</span>
        </p>
        <p className="text-muted-foreground">
          {column.nullable ? 'Nullable' : 'Not null'}
          {column.is_primary_key && ' \u00b7 Primary key'}
          {column.default_value != null && ` \u00b7 Default: ${column.default_value}`}
        </p>
        {column.comment && <p className="mt-1 text-muted-foreground">{column.comment}</p>}
      </TooltipContent>
    </Tooltip>
  );
}
