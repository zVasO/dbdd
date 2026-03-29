import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Hash, Link2, ShieldCheck, Loader2, Key } from 'lucide-react';
import { useSchemaStore } from '@/stores/schemaStore';
import { useConnectionStore } from '@/stores/connectionStore';
import type { ColumnInfo, IndexInfo, ForeignKeyInfo, ConstraintInfo, QueryResult, ColumnMeta, Row, CellValue } from '@/lib/types';
import { DataGrid } from '@/components/grid/DataGrid';

// Helper — builds a QueryResult from column names and raw cell values
function makeResult(columnNames: string[], rows: (string | number | boolean | null)[][]): QueryResult {
  const columns: ColumnMeta[] = columnNames.map(name => ({
    name,
    data_type: 'Text',
    native_type: 'text',
    nullable: true,
    is_primary_key: false,
    max_length: null,
  }));
  const resultRows: Row[] = rows.map(cells => ({
    cells: cells.map((cell): CellValue => {
      if (cell === null || cell === undefined || cell === '') return { type: 'Null' };
      if (typeof cell === 'boolean') return { type: 'Boolean', value: cell };
      if (typeof cell === 'number') return { type: 'Integer', value: cell };
      return { type: 'Text', value: cell };
    }),
  }));
  return {
    query_id: '',
    columns,
    rows: resultRows,
    total_rows: resultRows.length,
    affected_rows: null,
    execution_time_ms: 0,
    warnings: [],
    result_type: 'Select',
  };
}

function columnsResult(columns: ColumnInfo[]): QueryResult {
  return makeResult(
    ['#', 'Name', 'Type', 'Nullable', 'Default', 'Comment'],
    columns.map(col => [
      col.ordinal_position,
      col.name,
      String(col.data_type),
      col.nullable,
      col.default_value,
      col.comment,
    ]),
  );
}

function indexesResult(indexes: IndexInfo[]): QueryResult {
  return makeResult(
    ['Name', 'Columns', 'Type', 'Unique', 'Primary'],
    indexes.map(idx => [
      idx.name,
      idx.columns.join(', '),
      idx.index_type,
      idx.is_unique,
      idx.is_primary,
    ]),
  );
}

function foreignKeysResult(foreignKeys: ForeignKeyInfo[]): QueryResult {
  return makeResult(
    ['Name', 'Columns', 'References', 'On Update', 'On Delete'],
    foreignKeys.map(fk => [
      fk.name,
      fk.columns.join(', '),
      `${fk.referenced_table.table}(${fk.referenced_columns.join(', ')})`,
      fk.on_update,
      fk.on_delete,
    ]),
  );
}

function constraintsResult(constraints: ConstraintInfo[]): QueryResult {
  return makeResult(
    ['Name', 'Type', 'Columns', 'Definition'],
    constraints.map(c => [
      c.name,
      c.constraint_type,
      c.columns.join(', '),
      c.definition,
    ]),
  );
}

type StructureTab = 'columns' | 'indexes' | 'foreign_keys' | 'constraints';

interface Props {
  database: string;
  table: string;
}

const tabs: { key: StructureTab; label: string; icon: React.ReactNode }[] = [
  { key: 'columns', label: 'Columns', icon: <Hash className="h-3.5 w-3.5" /> },
  { key: 'indexes', label: 'Indexes', icon: <Key className="h-3.5 w-3.5" /> },
  { key: 'foreign_keys', label: 'Foreign Keys', icon: <Link2 className="h-3.5 w-3.5" /> },
  { key: 'constraints', label: 'Constraints', icon: <ShieldCheck className="h-3.5 w-3.5" /> },
];

export function TableStructureView({ database, table }: Props) {
  const [activeTab, setActiveTab] = useState<StructureTab>('columns');
  const connectionId = useConnectionStore((s) => s.activeConnectionId);
  const structures = useSchemaStore((s) => s.structures);
  const structureLoading = useSchemaStore((s) => s.structureLoading);
  const loadTableStructure = useSchemaStore((s) => s.loadTableStructure);

  const key = `${database}.${table}`;
  const structure = structures[key] ?? null;
  const loading = structureLoading[key] ?? false;

  useEffect(() => {
    if (connectionId && !structure && !loading) {
      loadTableStructure(connectionId, { database, schema: null, table });
    }
  }, [connectionId, database, table, structure, loading, loadTableStructure]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        <span className="text-sm">Loading structure...</span>
      </div>
    );
  }

  if (!structure) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <span className="text-sm">Structure not available</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-border bg-muted px-2 py-1">
        {tabs.map((t) => {
          const count =
            t.key === 'columns' ? structure.columns.length :
            t.key === 'indexes' ? structure.indexes.length :
            t.key === 'foreign_keys' ? structure.foreign_keys.length :
            structure.constraints.length;

          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cn(
                'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors',
                activeTab === t.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.icon}
              {t.label}
              <span className={cn(
                'ml-0.5 rounded-full px-1.5 py-0 text-[10px]',
                activeTab === t.key ? 'bg-primary/10 text-primary' : 'bg-muted-foreground/10',
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'columns' && <DataGrid result={columnsResult(structure.columns)} />}
        {activeTab === 'indexes' && <DataGrid result={indexesResult(structure.indexes)} />}
        {activeTab === 'foreign_keys' && <DataGrid result={foreignKeysResult(structure.foreign_keys)} />}
        {activeTab === 'constraints' && <DataGrid result={constraintsResult(structure.constraints)} />}
      </div>

      {/* Footer */}
      {structure.comment && (
        <div className="border-t border-border bg-muted px-3 py-1.5 text-[11px] text-muted-foreground">
          {structure.comment}
        </div>
      )}
    </div>
  );
}

