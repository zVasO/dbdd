import { create } from 'zustand';
import { quoteIdentifier } from '@/lib/sql-utils';

export type FilterOperator =
  | '='
  | '!='
  | '>'
  | '<'
  | '>='
  | '<='
  | 'LIKE'
  | 'NOT LIKE'
  | 'IS NULL'
  | 'IS NOT NULL'
  | 'IN'
  | 'BETWEEN';

export interface RowFilter {
  id: string;
  column: string;       // column name or '__raw__' for raw SQL
  operator: FilterOperator;
  value: string;
  value2?: string;       // for BETWEEN
  enabled: boolean;
}

export interface ColumnVisibility {
  [columnName: string]: boolean;
}

interface FilterState {
  // Row filters
  rowFilters: RowFilter[];
  filterBarOpen: boolean;

  // Column visibility
  columnVisibility: ColumnVisibility;
  columnFilterOpen: boolean;

  // Row filter actions
  addFilter: (column?: string, value?: string) => void;
  updateFilter: (id: string, updates: Partial<Omit<RowFilter, 'id'>>) => void;
  removeFilter: (id: string) => void;
  toggleFilter: (id: string) => void;
  clearFilters: () => void;
  setFilterBarOpen: (open: boolean) => void;

  // Column visibility actions
  setColumnVisibility: (col: string, visible: boolean) => void;
  resetColumnVisibility: () => void;
  setColumnFilterOpen: (open: boolean) => void;

  // Helpers
  getActiveFilters: () => RowFilter[];
  generateWhereClause: (dbType?: string) => string;
}

export const useFilterStore = create<FilterState>((set, get) => ({
  rowFilters: [],
  filterBarOpen: false,
  columnVisibility: {},
  columnFilterOpen: false,

  addFilter: (column, value) => {
    const filter: RowFilter = {
      id: crypto.randomUUID(),
      column: column || '',
      operator: '=',
      value: value || '',
      enabled: true,
    };
    set((s) => ({ rowFilters: [...s.rowFilters, filter] }));
  },

  updateFilter: (id, updates) => {
    set((s) => ({
      rowFilters: s.rowFilters.map((f) => (f.id === id ? { ...f, ...updates } : f)),
    }));
  },

  removeFilter: (id) => {
    set((s) => ({ rowFilters: s.rowFilters.filter((f) => f.id !== id) }));
  },

  toggleFilter: (id) => {
    set((s) => ({
      rowFilters: s.rowFilters.map((f) =>
        f.id === id ? { ...f, enabled: !f.enabled } : f
      ),
    }));
  },

  clearFilters: () => set({ rowFilters: [] }),

  setFilterBarOpen: (open) => set({ filterBarOpen: open }),

  setColumnVisibility: (col, visible) => {
    set((s) => ({
      columnVisibility: { ...s.columnVisibility, [col]: visible },
    }));
  },

  resetColumnVisibility: () => set({ columnVisibility: {} }),

  setColumnFilterOpen: (open) => set({ columnFilterOpen: open }),

  getActiveFilters: () => get().rowFilters.filter((f) => f.enabled),

  generateWhereClause: (dbType = 'mysql') => {
    const active = get().rowFilters.filter((f) => f.enabled && f.column);
    if (active.length === 0) return '';

    const conditions = active.map((f) => {
      if (f.column === '__raw__') return f.value;
      const col = quoteIdentifier(f.column, dbType);

      switch (f.operator) {
        case 'IS NULL': return `${col} IS NULL`;
        case 'IS NOT NULL': return `${col} IS NOT NULL`;
        case 'BETWEEN': return `${col} BETWEEN '${esc(f.value)}' AND '${esc(f.value2 || '')}'`;
        case 'IN': return `${col} IN (${f.value})`;
        case 'LIKE':
        case 'NOT LIKE': return `${col} ${f.operator} '${esc(f.value)}'`;
        default: return `${col} ${f.operator} '${esc(f.value)}'`;
      }
    });
    return conditions.join(' AND ');
  },
}));

function esc(val: string): string {
  return val.replace(/'/g, "''");
}
