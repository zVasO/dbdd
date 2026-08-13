import React from 'react';
import { Separator } from '@/components/ui/separator';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ColumnInfo } from '@/lib/types';
import { formatDataType } from './utils';

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
