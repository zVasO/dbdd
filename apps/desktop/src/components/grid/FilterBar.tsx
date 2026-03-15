import { useFilterStore, type FilterOperator, type RowFilter } from '@/stores/filterStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, X, Filter, Code2, Trash2 } from 'lucide-react';
import type { ColumnMeta } from '@/lib/types';

interface FilterBarProps {
  columns: ColumnMeta[];
  onApply: (whereClause: string) => void;
  dbType?: string;
}

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: '=', label: '=' },
  { value: '!=', label: '!=' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
  { value: 'LIKE', label: 'LIKE' },
  { value: 'NOT LIKE', label: 'NOT LIKE' },
  { value: 'IS NULL', label: 'IS NULL' },
  { value: 'IS NOT NULL', label: 'IS NOT NULL' },
  { value: 'IN', label: 'IN' },
  { value: 'BETWEEN', label: 'BETWEEN' },
];

const NO_VALUE_OPS: FilterOperator[] = ['IS NULL', 'IS NOT NULL'];

export function FilterBar({ columns, onApply, dbType = 'mysql' }: FilterBarProps) {
  const filters = useFilterStore((s) => s.rowFilters);
  const addFilter = useFilterStore((s) => s.addFilter);
  const updateFilter = useFilterStore((s) => s.updateFilter);
  const removeFilter = useFilterStore((s) => s.removeFilter);
  const toggleFilter = useFilterStore((s) => s.toggleFilter);
  const clearFilters = useFilterStore((s) => s.clearFilters);
  const generateWhereClause = useFilterStore((s) => s.generateWhereClause);
  const filterBarOpen = useFilterStore((s) => s.filterBarOpen);

  if (!filterBarOpen) return null;

  const handleApply = () => {
    const where = generateWhereClause(dbType);
    onApply(where);
  };

  const handleApplySingle = (filter: RowFilter) => {
    // Enable only this filter, apply
    if (!filter.enabled) {
      toggleFilter(filter.id);
    }
    const where = generateWhereClause(dbType);
    onApply(where);
  };

  return (
    <div className="border-b border-border bg-muted/50 px-2 py-1.5 space-y-1">
      {/* Filter header */}
      <div className="flex items-center gap-2">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Filters</span>
        <div className="flex-1" />
        <Button variant="ghost" size="xs" onClick={() => addFilter()} className="gap-1 text-xs">
          <Plus className="h-3 w-3" /> Add
        </Button>
        <Button variant="ghost" size="xs" onClick={handleApply} className="text-xs">
          Apply All
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            const w = generateWhereClause(dbType);
            if (w) navigator.clipboard.writeText(w);
          }}
          className="text-xs"
        >
          <Code2 className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="xs" onClick={clearFilters} className="text-xs text-destructive">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Filter rows */}
      {filters.map((filter) => (
        <FilterRow
          key={filter.id}
          filter={filter}
          columns={columns}
          onUpdate={(updates) => updateFilter(filter.id, updates)}
          onRemove={() => removeFilter(filter.id)}
          onToggle={() => toggleFilter(filter.id)}
          onApply={() => handleApplySingle(filter)}
        />
      ))}

      {filters.length === 0 && (
        <p className="text-xs text-muted-foreground py-1 pl-5">
          No filters. Click &quot;Add&quot; to create one.
        </p>
      )}
    </div>
  );
}

interface FilterRowProps {
  filter: RowFilter;
  columns: ColumnMeta[];
  onUpdate: (updates: Partial<Omit<RowFilter, 'id'>>) => void;
  onRemove: () => void;
  onToggle: () => void;
  onApply: () => void;
}

function FilterRow({ filter, columns, onUpdate, onRemove, onToggle, onApply }: FilterRowProps) {
  const needsValue = !NO_VALUE_OPS.includes(filter.operator);
  const needsValue2 = filter.operator === 'BETWEEN';

  return (
    <div className="flex items-center gap-1.5 pl-5">
      {/* Enable/disable checkbox */}
      <input
        type="checkbox"
        checked={filter.enabled}
        onChange={onToggle}
        className="h-3 w-3 rounded border-border"
      />

      {/* Column select */}
      <Select value={filter.column} onValueChange={(v) => onUpdate({ column: v })}>
        <SelectTrigger className="h-7 w-[140px] text-xs">
          <SelectValue placeholder="Column..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__raw__">Raw SQL</SelectItem>
          {columns.map((col) => (
            <SelectItem key={col.name} value={col.name}>
              {col.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Operator select */}
      {filter.column !== '__raw__' && (
        <Select value={filter.operator} onValueChange={(v) => onUpdate({ operator: v as FilterOperator })}>
          <SelectTrigger className="h-7 w-[110px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPERATORS.map((op) => (
              <SelectItem key={op.value} value={op.value}>
                {op.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Value input */}
      {needsValue && (
        <Input
          value={filter.value}
          onChange={(e) => onUpdate({ value: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') onApply(); }}
          placeholder={filter.column === '__raw__' ? 'WHERE condition...' : 'Value...'}
          className="h-7 w-[160px] text-xs"
        />
      )}

      {/* Second value for BETWEEN */}
      {needsValue2 && (
        <>
          <span className="text-xs text-muted-foreground">and</span>
          <Input
            value={filter.value2 || ''}
            onChange={(e) => onUpdate({ value2: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') onApply(); }}
            placeholder="Value 2..."
            className="h-7 w-[120px] text-xs"
          />
        </>
      )}

      {/* Remove button */}
      <Button variant="ghost" size="icon-xs" onClick={onRemove}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
