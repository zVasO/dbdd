import React from 'react';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import { ChevronRight, Database } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TableInfo, ColumnInfo } from '@/lib/types';
import { formatBytes, HighlightMatch } from './utils';
import { TableNode } from './TableNode';

export interface DatabaseNodeProps {
  name: string;
  sizeBytes: number | null;
  expanded: boolean;
  onToggle: () => void;
  tables: TableInfo[];
  expandedTables: Set<string>;
  structures: Record<string, { columns: ColumnInfo[] }>;
  structureLoading: Record<string, boolean>;
  dbName: string;
  onToggleTable: (db: string, table: string) => void;
  onTableClick: (db: string, table: string) => void;
  onColumnClick: (column: ColumnInfo) => void;
  selectedColumn: ColumnInfo | null;
  searchQuery: string;
  tableColumnMatches: Set<string>;
  onTruncateTable: (db: string, table: string) => void;
  onDropTable: (db: string, table: string) => void;
  onRenameTable: (db: string, table: string) => void;
  isFavorite?: (table: string) => boolean;
  onToggleFavorite?: (table: string) => void;
  onColumnDoubleClick?: (tableName: string, colName: string) => void;
}

export function DatabaseNode({
  name,
  sizeBytes,
  expanded,
  onToggle,
  tables,
  expandedTables,
  structures,
  structureLoading,
  dbName,
  onToggleTable,
  onTableClick,
  onColumnClick,
  selectedColumn,
  searchQuery,
  tableColumnMatches,
  onTruncateTable,
  onDropTable,
  onRenameTable,
  isFavorite,
  onToggleFavorite,
  onColumnDoubleClick,
}: DatabaseNodeProps) {
  return (
    <Collapsible open={expanded} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <button className="group flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-sm hover:bg-sidebar-accent">
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
              expanded && 'rotate-90',
            )}
          />
          <Database className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate font-medium text-sidebar-foreground">
            <HighlightMatch text={name} query={searchQuery} />
          </span>
          {sizeBytes != null && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {formatBytes(sizeBytes)}
            </span>
          )}
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        {tables.length === 0 ? (
          <p className="py-1 pl-9 text-[11px] text-muted-foreground">No tables</p>
        ) : (
          tables.map((table) => {
            const key = `${dbName}.${table.name}`;
            const hasColumnMatch = tableColumnMatches.has(key);
            return (
              <TableNode
                key={table.name}
                table={table}
                dbName={dbName}
                expanded={expandedTables.has(key) || (!!searchQuery && hasColumnMatch)}
                loading={structureLoading[key] ?? false}
                columns={structures[key]?.columns}
                onToggle={() => onToggleTable(dbName, table.name)}
                onClick={() => onTableClick(dbName, table.name)}
                onColumnClick={onColumnClick}
                selectedColumn={selectedColumn}
                searchQuery={searchQuery}
                onTruncate={() => onTruncateTable(dbName, table.name)}
                onDrop={() => onDropTable(dbName, table.name)}
                onRename={() => onRenameTable(dbName, table.name)}
                isFavorited={isFavorite?.(table.name)}
                onToggleFavorite={onToggleFavorite ? () => onToggleFavorite(table.name) : undefined}
                onColumnDoubleClick={onColumnDoubleClick ? (colName) => onColumnDoubleClick(table.name, colName) : undefined}
              />
            );
          })
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
