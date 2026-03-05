import { useState, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Key, Hash, Link2, ShieldCheck, Loader2 } from 'lucide-react';
import { useSchemaStore } from '@/stores/schemaStore';
import { useConnectionStore } from '@/stores/connectionStore';
import type { TableStructure, ColumnInfo, IndexInfo, ForeignKeyInfo, ConstraintInfo } from '@/lib/types';

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
      <div className="flex-1 overflow-auto">
        {activeTab === 'columns' && <ColumnsTable columns={structure.columns} />}
        {activeTab === 'indexes' && <IndexesTable indexes={structure.indexes} />}
        {activeTab === 'foreign_keys' && <ForeignKeysTable foreignKeys={structure.foreign_keys} />}
        {activeTab === 'constraints' && <ConstraintsTable constraints={structure.constraints} />}
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

function ColumnsTable({ columns }: { columns: ColumnInfo[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="sticky top-0 bg-muted text-left text-[10px] uppercase tracking-wider text-muted-foreground">
          <th className="px-3 py-2 font-semibold">#</th>
          <th className="px-3 py-2 font-semibold">Name</th>
          <th className="px-3 py-2 font-semibold">Type</th>
          <th className="px-3 py-2 font-semibold">Nullable</th>
          <th className="px-3 py-2 font-semibold">Default</th>
          <th className="px-3 py-2 font-semibold">Comment</th>
        </tr>
      </thead>
      <tbody>
        {columns.map((col, i) => (
          <tr
            key={col.name}
            className={cn(
              'border-b border-border/30',
              i % 2 === 1 && 'bg-muted/30',
            )}
          >
            <td className="px-3 py-1.5 text-muted-foreground">{col.ordinal_position}</td>
            <td className="px-3 py-1.5 font-medium">
              <span className="flex items-center gap-1.5">
                {col.is_primary_key && <Key className="h-3 w-3 text-primary" />}
                {col.name}
              </span>
            </td>
            <td className="px-3 py-1.5">
              <span className="rounded bg-accent/50 px-1.5 py-0.5 text-[11px]">{col.data_type}</span>
            </td>
            <td className="px-3 py-1.5">
              {col.nullable ? (
                <span className="text-muted-foreground">YES</span>
              ) : (
                <span className="font-medium text-foreground">NO</span>
              )}
            </td>
            <td className="px-3 py-1.5 text-muted-foreground">
              {col.default_value ?? <span className="italic text-muted-foreground/50">none</span>}
            </td>
            <td className="max-w-[200px] truncate px-3 py-1.5 text-muted-foreground">
              {col.comment ?? ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function IndexesTable({ indexes }: { indexes: IndexInfo[] }) {
  if (indexes.length === 0) {
    return <EmptyState text="No indexes" />;
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="sticky top-0 bg-muted text-left text-[10px] uppercase tracking-wider text-muted-foreground">
          <th className="px-3 py-2 font-semibold">Name</th>
          <th className="px-3 py-2 font-semibold">Columns</th>
          <th className="px-3 py-2 font-semibold">Type</th>
          <th className="px-3 py-2 font-semibold">Unique</th>
          <th className="px-3 py-2 font-semibold">Primary</th>
        </tr>
      </thead>
      <tbody>
        {indexes.map((idx, i) => (
          <tr
            key={idx.name}
            className={cn(
              'border-b border-border/30',
              i % 2 === 1 && 'bg-muted/30',
            )}
          >
            <td className="px-3 py-1.5 font-medium">{idx.name}</td>
            <td className="px-3 py-1.5">
              <span className="text-muted-foreground">{idx.columns.join(', ')}</span>
            </td>
            <td className="px-3 py-1.5">
              <span className="rounded bg-accent/50 px-1.5 py-0.5 text-[11px]">{idx.index_type}</span>
            </td>
            <td className="px-3 py-1.5">
              {idx.is_unique && <span className="text-primary">YES</span>}
            </td>
            <td className="px-3 py-1.5">
              {idx.is_primary && <Key className="h-3 w-3 text-primary" />}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ForeignKeysTable({ foreignKeys }: { foreignKeys: ForeignKeyInfo[] }) {
  if (foreignKeys.length === 0) {
    return <EmptyState text="No foreign keys" />;
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="sticky top-0 bg-muted text-left text-[10px] uppercase tracking-wider text-muted-foreground">
          <th className="px-3 py-2 font-semibold">Name</th>
          <th className="px-3 py-2 font-semibold">Columns</th>
          <th className="px-3 py-2 font-semibold">References</th>
          <th className="px-3 py-2 font-semibold">On Update</th>
          <th className="px-3 py-2 font-semibold">On Delete</th>
        </tr>
      </thead>
      <tbody>
        {foreignKeys.map((fk, i) => (
          <tr
            key={fk.name}
            className={cn(
              'border-b border-border/30',
              i % 2 === 1 && 'bg-muted/30',
            )}
          >
            <td className="px-3 py-1.5 font-medium">{fk.name}</td>
            <td className="px-3 py-1.5 text-muted-foreground">{fk.columns.join(', ')}</td>
            <td className="px-3 py-1.5">
              <span className="text-primary">{fk.referenced_table.table}</span>
              <span className="text-muted-foreground">({fk.referenced_columns.join(', ')})</span>
            </td>
            <td className="px-3 py-1.5">
              <span className="rounded bg-accent/50 px-1.5 py-0.5 text-[11px]">{fk.on_update}</span>
            </td>
            <td className="px-3 py-1.5">
              <span className="rounded bg-accent/50 px-1.5 py-0.5 text-[11px]">{fk.on_delete}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConstraintsTable({ constraints }: { constraints: ConstraintInfo[] }) {
  if (constraints.length === 0) {
    return <EmptyState text="No constraints" />;
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="sticky top-0 bg-muted text-left text-[10px] uppercase tracking-wider text-muted-foreground">
          <th className="px-3 py-2 font-semibold">Name</th>
          <th className="px-3 py-2 font-semibold">Type</th>
          <th className="px-3 py-2 font-semibold">Columns</th>
          <th className="px-3 py-2 font-semibold">Definition</th>
        </tr>
      </thead>
      <tbody>
        {constraints.map((c, i) => (
          <tr
            key={c.name}
            className={cn(
              'border-b border-border/30',
              i % 2 === 1 && 'bg-muted/30',
            )}
          >
            <td className="px-3 py-1.5 font-medium">{c.name}</td>
            <td className="px-3 py-1.5">
              <span className="rounded bg-accent/50 px-1.5 py-0.5 text-[11px]">{c.constraint_type}</span>
            </td>
            <td className="px-3 py-1.5 text-muted-foreground">{c.columns.join(', ')}</td>
            <td className="max-w-[300px] truncate px-3 py-1.5 text-muted-foreground">
              {c.definition ?? ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
