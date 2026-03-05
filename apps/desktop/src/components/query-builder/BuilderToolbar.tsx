import { useCallback, useState } from 'react';
import { Plus, Trash2, Copy, Play, CheckSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useQueryBuilderStore } from '@/stores/queryBuilderStore';
import { useSchemaStore } from '@/stores/schemaStore';
import { useQueryStore } from '@/stores/queryStore';
import { useConnectionStore } from '@/stores/connectionStore';

export function BuilderToolbar() {
  const [copied, setCopied] = useState(false);

  const tables = useSchemaStore((s) => s.tables);
  const structures = useSchemaStore((s) => s.structures);
  const databases = useSchemaStore((s) => s.databases);

  const addTable = useQueryBuilderStore((s) => s.addTable);
  const reset = useQueryBuilderStore((s) => s.reset);
  const generateSQL = useQueryBuilderStore((s) => s.generateSQL);
  const distinct = useQueryBuilderStore((s) => s.distinct);
  const setDistinct = useQueryBuilderStore((s) => s.setDistinct);
  const limit = useQueryBuilderStore((s) => s.limit);
  const setLimit = useQueryBuilderStore((s) => s.setLimit);
  const nodes = useQueryBuilderStore((s) => s.nodes);

  const createTab = useQueryStore((s) => s.createTab);
  const updateSql = useQueryStore((s) => s.updateSql);
  const executeQuery = useQueryStore((s) => s.executeQuery);
  const setActiveTab = useQueryStore((s) => s.setActiveTab);

  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);

  const handleAddTable = useCallback(
    (database: string, tableName: string) => {
      // Get columns from structure cache
      const key = `${database}.${tableName}`;
      const structure = structures[key];

      const columns = (structure?.columns ?? []).map((col) => ({
        name: col.name,
        type: col.data_type,
        isPK: col.is_primary_key,
        nullable: col.nullable,
      }));

      addTable(database, tableName, columns);
    },
    [structures, addTable]
  );

  const handleCopySQL = useCallback(async () => {
    const sql = generateSQL();
    if (!sql) return;
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [generateSQL]);

  const handleRunQuery = useCallback(() => {
    const sql = generateSQL();
    if (!sql || !activeConnectionId) return;

    const tabId = createTab('Query Builder');
    updateSql(tabId, sql);
    setActiveTab(tabId);

    // Execute after a tick to let state settle
    setTimeout(() => {
      executeQuery(activeConnectionId, tabId);
    }, 50);
  }, [generateSQL, activeConnectionId, createTab, updateSql, setActiveTab, executeQuery]);

  const handleLimitChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value.trim();
      if (val === '') {
        setLimit(null);
      } else {
        const num = parseInt(val, 10);
        if (!isNaN(num) && num >= 0) {
          setLimit(num);
        }
      }
    },
    [setLimit]
  );

  const handleDistinctToggle = useCallback(() => {
    setDistinct(!distinct);
  }, [distinct, setDistinct]);

  // Build the database -> tables structure for the dropdown
  const dbTableList = databases.map((db) => ({
    database: db.name,
    tables: tables[db.name] ?? [],
  }));

  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2">
      {/* Add Table dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Plus className="size-3.5" />
            Add Table
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[400px] overflow-y-auto">
          {dbTableList.length === 0 && (
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              No databases loaded
            </DropdownMenuLabel>
          )}
          {dbTableList.map(({ database, tables: dbTables }) => {
            if (dbTables.length === 0) return null;

            // If there's only one database, list tables directly
            if (dbTableList.length === 1) {
              return (
                <DropdownMenuGroup key={database}>
                  <DropdownMenuLabel>{database}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {dbTables
                    .filter((t) => t.table_type === 'Table' || t.table_type === 'View')
                    .map((t) => (
                      <DropdownMenuItem
                        key={t.name}
                        onClick={() => handleAddTable(database, t.name)}
                      >
                        {t.name}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuGroup>
              );
            }

            // Multiple databases: use sub-menus
            return (
              <DropdownMenuSub key={database}>
                <DropdownMenuSubTrigger>{database}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-[300px] overflow-y-auto">
                  {dbTables
                    .filter((t) => t.table_type === 'Table' || t.table_type === 'View')
                    .map((t) => (
                      <DropdownMenuItem
                        key={t.name}
                        onClick={() => handleAddTable(database, t.name)}
                      >
                        {t.name}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Separator */}
      <div className="h-5 w-px bg-border" />

      {/* Distinct checkbox */}
      <label className="flex items-center gap-1.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={distinct}
          onChange={handleDistinctToggle}
          className="size-3.5 accent-primary cursor-pointer"
        />
        <span className="text-xs font-medium text-muted-foreground">DISTINCT</span>
      </label>

      {/* Limit input */}
      <div className="flex items-center gap-1.5">
        <Label className="text-xs text-muted-foreground">LIMIT</Label>
        <Input
          type="number"
          value={limit ?? ''}
          onChange={handleLimitChange}
          placeholder="none"
          className="h-7 w-20 text-xs"
          min={0}
        />
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Table count */}
      {nodes.length > 0 && (
        <span className="text-xs text-muted-foreground">
          {nodes.length} table{nodes.length !== 1 ? 's' : ''}
        </span>
      )}

      {/* Clear All */}
      <Button
        variant="ghost"
        size="sm"
        onClick={reset}
        disabled={nodes.length === 0}
        className="text-muted-foreground"
      >
        <Trash2 className="size-3.5" />
        Clear
      </Button>

      {/* Copy SQL */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleCopySQL}
        disabled={nodes.length === 0}
      >
        {copied ? (
          <>
            <CheckSquare className="size-3.5 text-green-500" />
            <span className="text-green-600">Copied</span>
          </>
        ) : (
          <>
            <Copy className="size-3.5" />
            Copy SQL
          </>
        )}
      </Button>

      {/* Run Query */}
      <Button
        size="sm"
        onClick={handleRunQuery}
        disabled={nodes.length === 0 || !activeConnectionId}
      >
        <Play className="size-3.5" />
        Run Query
      </Button>
    </div>
  );
}
