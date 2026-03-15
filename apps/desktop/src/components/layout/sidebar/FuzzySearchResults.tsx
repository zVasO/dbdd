import React from 'react';
import { Columns3, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScoredItem } from '@/lib/fuzzy-search-bridge';
import type { ColumnInfo } from '@/lib/types';
import { HighlightFuzzy } from './utils';

export interface FuzzySearchResultsProps {
  results: ScoredItem[];
  searchQuery: string;
  onTableClick: (db: string, table: string) => void;
  onColumnClick: (column: ColumnInfo) => void;
  selectedColumn: ColumnInfo | null;
}

export function FuzzySearchResults({
  results,
  searchQuery,
  onTableClick,
  onColumnClick,
  selectedColumn,
}: FuzzySearchResultsProps) {
  const tableResults = results.filter((item) => item.type === 'table');
  const columnResults = results.filter((item) => item.type === 'column');

  if (tableResults.length === 0 && columnResults.length === 0) {
    return (
      <p className="px-3 py-4 text-center text-xs text-muted-foreground">
        No results for &ldquo;{searchQuery}&rdquo;
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {/* Tables section */}
      {tableResults.length > 0 && (
        <div>
          <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Tables
            <span className="ml-1 font-normal">({tableResults.length})</span>
          </div>
          {tableResults.map((item) => {
            const db = item.database ?? '';
            return (
              <button
                key={`${db}.${item.name}`}
                onClick={() => onTableClick(db, item.name)}
                className="flex w-full items-center gap-1.5 rounded-sm px-3 py-1 text-left text-xs hover:bg-sidebar-accent"
              >
                <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-sidebar-foreground">
                  <HighlightFuzzy text={item.name} matches={item.matches} />
                </span>
                {db && (
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{db}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Columns section */}
      {columnResults.length > 0 && (
        <div>
          <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Columns
            <span className="ml-1 font-normal">({columnResults.length})</span>
          </div>
          {columnResults.map((item) => {
            const isSelected =
              selectedColumn?.name === item.name &&
              item.table !== undefined &&
              selectedColumn !== null;
            return (
              <button
                key={`${item.database ?? ''}.${item.table ?? ''}.${item.name}`}
                onClick={() =>
                  onColumnClick({
                    name: item.name,
                    data_type: item.columnType ?? '',
                    mapped_type: item.columnType ?? '',
                    nullable: false,
                    is_primary_key: false,
                    ordinal_position: 0,
                    default_value: null,
                    comment: null,
                  })
                }
                className={cn(
                  'flex w-full items-center gap-1.5 rounded-sm px-3 py-0.5 text-left text-[11px] hover:bg-sidebar-accent',
                  isSelected && 'bg-sidebar-accent',
                )}
              >
                <Columns3 className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate italic text-muted-foreground">
                  <HighlightFuzzy text={item.name} matches={item.matches} />
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                  {item.columnType && <span>{item.columnType}</span>}
                  {item.table && <span className="text-muted-foreground/50">{item.table}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
