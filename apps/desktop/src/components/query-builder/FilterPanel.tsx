import { useCallback, useMemo } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useQueryBuilderStore } from '@/stores/queryBuilderStore';
import type { WhereFilter, OrderByEntry } from '@/stores/queryBuilderStore';

const OPERATORS: WhereFilter['operator'][] = [
  '=', '!=', '>', '<', '>=', '<=', 'LIKE', 'NOT LIKE', 'IN', 'IS NULL', 'IS NOT NULL',
];

const UNARY_OPERATORS = new Set<string>(['IS NULL', 'IS NOT NULL']);

// === WHERE Filters Section ===

function FilterRow({ filter }: { filter: WhereFilter }) {
  const nodes = useQueryBuilderStore((s) => s.nodes);
  const updateWhereFilter = useQueryBuilderStore((s) => s.updateWhereFilter);
  const removeWhereFilter = useQueryBuilderStore((s) => s.removeWhereFilter);

  // Build list of all columns from all added tables
  const tableColumns = useMemo(() => {
    const result: { nodeId: string; tableName: string; column: string }[] = [];
    for (const node of nodes) {
      for (const col of node.data.columns) {
        result.push({
          nodeId: node.id,
          tableName: node.data.tableName,
          column: col.name,
        });
      }
    }
    return result;
  }, [nodes]);

  const handleTableColumnChange = useCallback(
    (value: string) => {
      // value format: "nodeId::columnName"
      const [nodeId, column] = value.split('::');
      const node = nodes.find((n) => n.id === nodeId);
      updateWhereFilter(filter.id, {
        nodeId,
        column,
        tableName: node?.data.tableName ?? '',
      });
    },
    [filter.id, nodes, updateWhereFilter]
  );

  const handleOperatorChange = useCallback(
    (value: string) => {
      updateWhereFilter(filter.id, {
        operator: value as WhereFilter['operator'],
      });
    },
    [filter.id, updateWhereFilter]
  );

  const handleValueChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateWhereFilter(filter.id, { value: e.target.value });
    },
    [filter.id, updateWhereFilter]
  );

  const handleEnabledToggle = useCallback(() => {
    updateWhereFilter(filter.id, { enabled: !filter.enabled });
  }, [filter.id, filter.enabled, updateWhereFilter]);

  const handleRemove = useCallback(() => {
    removeWhereFilter(filter.id);
  }, [filter.id, removeWhereFilter]);

  const isUnary = UNARY_OPERATORS.has(filter.operator);
  const currentValue = filter.nodeId ? `${filter.nodeId}::${filter.column}` : '';

  return (
    <div className={cn(
      'flex items-center gap-2 py-1.5',
      !filter.enabled && 'opacity-50'
    )}>
      {/* Enabled checkbox */}
      <input
        type="checkbox"
        checked={filter.enabled}
        onChange={handleEnabledToggle}
        className="size-3.5 accent-primary cursor-pointer shrink-0"
      />

      {/* Table.Column selector */}
      <Select value={currentValue} onValueChange={handleTableColumnChange}>
        <SelectTrigger size="sm" className="w-[180px] text-xs">
          <SelectValue placeholder="Select column" />
        </SelectTrigger>
        <SelectContent>
          {nodes.map((node) => (
            <div key={node.id}>
              <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {node.data.tableName}
              </div>
              {node.data.columns.map((col) => (
                <SelectItem
                  key={`${node.id}::${col.name}`}
                  value={`${node.id}::${col.name}`}
                  className="text-xs"
                >
                  {node.data.tableName}.{col.name}
                </SelectItem>
              ))}
            </div>
          ))}
        </SelectContent>
      </Select>

      {/* Operator */}
      <Select value={filter.operator} onValueChange={handleOperatorChange}>
        <SelectTrigger size="sm" className="w-[110px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPERATORS.map((op) => (
            <SelectItem key={op} value={op} className="text-xs">
              {op}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Value input */}
      {!isUnary && (
        <Input
          value={filter.value}
          onChange={handleValueChange}
          placeholder="Value..."
          className="h-8 flex-1 text-xs min-w-[100px]"
        />
      )}
      {isUnary && <div className="flex-1" />}

      {/* Delete */}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={handleRemove}
        className="shrink-0 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-3" />
      </Button>
    </div>
  );
}

function WhereFiltersSection() {
  const whereFilters = useQueryBuilderStore((s) => s.whereFilters);
  const addWhereFilter = useQueryBuilderStore((s) => s.addWhereFilter);
  const nodes = useQueryBuilderStore((s) => s.nodes);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          WHERE Filters
        </h4>
        <Button
          variant="ghost"
          size="xs"
          onClick={addWhereFilter}
          disabled={nodes.length === 0}
          className="text-xs"
        >
          <Plus className="size-3" />
          Add Filter
        </Button>
      </div>

      {whereFilters.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 py-2">
          No filters added. Click "Add Filter" to add a WHERE condition.
        </p>
      ) : (
        <div className="space-y-0.5">
          {whereFilters.map((filter, idx) => (
            <div key={filter.id} className="flex items-center gap-1">
              {idx > 0 && (
                <span className="text-[10px] font-medium text-blue-400 w-6 text-center shrink-0">
                  AND
                </span>
              )}
              {idx === 0 && <span className="w-6 shrink-0" />}
              <div className="flex-1">
                <FilterRow filter={filter} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// === GROUP BY Section ===

function GroupBySection() {
  const nodes = useQueryBuilderStore((s) => s.nodes);
  const groupByColumns = useQueryBuilderStore((s) => s.groupByColumns);
  const setGroupBy = useQueryBuilderStore((s) => s.setGroupBy);

  // All selected columns across all tables
  const availableColumns = useMemo(() => {
    const result: { label: string; value: string }[] = [];
    for (const node of nodes) {
      for (const colName of node.data.selectedColumns) {
        result.push({
          label: `${node.data.tableName}.${colName}`,
          value: `${node.data.tableName}.${colName}`,
        });
      }
    }
    return result;
  }, [nodes]);

  const handleToggleGroupBy = useCallback(
    (value: string) => {
      if (groupByColumns.includes(value)) {
        setGroupBy(groupByColumns.filter((c) => c !== value));
      } else {
        setGroupBy([...groupByColumns, value]);
      }
    },
    [groupByColumns, setGroupBy]
  );

  const handleClearAll = useCallback(() => {
    setGroupBy([]);
  }, [setGroupBy]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          GROUP BY
        </h4>
        {groupByColumns.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            onClick={handleClearAll}
            className="text-xs text-muted-foreground"
          >
            Clear
          </Button>
        )}
      </div>

      {availableColumns.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">
          Select columns first to enable grouping
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {availableColumns.map((col) => {
            const isActive = groupByColumns.includes(col.value);
            return (
              <button
                key={col.value}
                onClick={() => handleToggleGroupBy(col.value)}
                className={cn(
                  'rounded-md border px-2 py-0.5 text-[11px] font-mono transition-colors cursor-pointer',
                  isActive
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground'
                )}
              >
                {col.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// === ORDER BY Section ===

function OrderBySection() {
  const nodes = useQueryBuilderStore((s) => s.nodes);
  const orderByColumns = useQueryBuilderStore((s) => s.orderByColumns);
  const addOrderBy = useQueryBuilderStore((s) => s.addOrderBy);
  const removeOrderBy = useQueryBuilderStore((s) => s.removeOrderBy);

  // All selected columns across all tables
  const availableColumns = useMemo(() => {
    const result: { table: string; column: string; label: string }[] = [];
    for (const node of nodes) {
      for (const colName of node.data.selectedColumns) {
        result.push({
          table: node.data.tableName,
          column: colName,
          label: `${node.data.tableName}.${colName}`,
        });
      }
    }
    return result;
  }, [nodes]);

  const handleAddOrderBy = useCallback(
    (value: string) => {
      // value format: "tableName::columnName"
      const [table, column] = value.split('::');
      addOrderBy(table, column, 'ASC');
    },
    [addOrderBy]
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          ORDER BY
        </h4>
        <Select onValueChange={handleAddOrderBy} value="">
          <SelectTrigger size="sm" className="w-[160px] text-xs h-6">
            <SelectValue placeholder="+ Add column" />
          </SelectTrigger>
          <SelectContent>
            {availableColumns.map((col) => (
              <SelectItem
                key={col.label}
                value={`${col.table}::${col.column}`}
                className="text-xs"
              >
                {col.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {orderByColumns.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">
          No ordering specified
        </p>
      ) : (
        <div className="space-y-1">
          {orderByColumns.map((entry, idx) => (
            <OrderByRow key={`${entry.table}.${entry.column}-${idx}`} entry={entry} index={idx} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrderByRow({ entry, index }: { entry: OrderByEntry; index: number }) {
  const removeOrderBy = useQueryBuilderStore((s) => s.removeOrderBy);
  const orderByColumns = useQueryBuilderStore((s) => s.orderByColumns);

  const handleDirectionToggle = useCallback(() => {
    // We need to update via the store - remove and re-add with opposite direction
    const newDirection = entry.direction === 'ASC' ? 'DESC' : 'ASC';
    const store = useQueryBuilderStore.getState();
    // Update by replacing the orderByColumns array
    const updated = [...orderByColumns];
    updated[index] = { ...entry, direction: newDirection };
    // Use setGroupBy-like pattern: directly set the state
    useQueryBuilderStore.setState({ orderByColumns: updated });
  }, [entry, index, orderByColumns]);

  const handleRemove = useCallback(() => {
    removeOrderBy(index);
  }, [index, removeOrderBy]);

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1">
      <span className="text-xs text-muted-foreground font-mono">
        {index + 1}.
      </span>
      <span className="flex-1 text-xs font-mono truncate">
        {entry.table}.{entry.column}
      </span>
      <button
        onClick={handleDirectionToggle}
        className={cn(
          'rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors cursor-pointer',
          entry.direction === 'ASC'
            ? 'bg-blue-500/10 text-blue-500'
            : 'bg-orange-500/10 text-orange-500'
        )}
        title={`Click to toggle direction (currently ${entry.direction})`}
      >
        {entry.direction === 'ASC' ? (
          <span className="flex items-center gap-0.5">
            <ArrowUp className="size-2.5" />
            ASC
          </span>
        ) : (
          <span className="flex items-center gap-0.5">
            <ArrowDown className="size-2.5" />
            DESC
          </span>
        )}
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={handleRemove}
        className="shrink-0 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-3" />
      </Button>
    </div>
  );
}

// === Combined FilterPanel ===

export function FilterPanel() {
  return (
    <div className="h-full overflow-y-auto p-3 space-y-4">
      <WhereFiltersSection />
      <div className="h-px bg-border" />
      <GroupBySection />
      <div className="h-px bg-border" />
      <OrderBySection />
    </div>
  );
}
