import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CellValue = string | number | boolean | null;

export interface CellEdit {
  type: 'edit';
  id: string;
  table: string;
  database: string;
  rowIndex: number;
  primaryKeys: Record<string, CellValue>;
  column: string;
  oldValue: CellValue;
  newValue: CellValue;
}

export interface RowInsert {
  type: 'insert';
  id: string;
  table: string;
  database: string;
  values: Record<string, CellValue>;
}

export interface RowDelete {
  type: 'delete';
  id: string;
  table: string;
  database: string;
  rowIndex: number;
  primaryKeys: Record<string, CellValue>;
  originalRow: Record<string, CellValue>;
}

export type Change = CellEdit | RowInsert | RowDelete;

export type SafeModeLevel =
  | 'silent'
  | 'alert'
  | 'alert_select'
  | 'password'
  | 'password_select';

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

export function sqlValue(val: CellValue): string {
  if (val === null) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  // Escape single quotes by doubling them
  return `'${String(val).replace(/'/g, "''")}'`;
}

function escapeId(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``;
}

function whereClause(primaryKeys: Record<string, CellValue>): string {
  return Object.entries(primaryKeys)
    .map(([col, val]) => `${escapeId(col)} = ${sqlValue(val)}`)
    .join(' AND ');
}

function generateSqlForChange(change: Change): string {
  switch (change.type) {
    case 'edit':
      return `UPDATE ${escapeId(change.table)} SET ${escapeId(change.column)} = ${sqlValue(change.newValue)} WHERE ${whereClause(change.primaryKeys)};`;

    case 'insert': {
      const cols = Object.keys(change.values);
      const vals = Object.values(change.values);
      return `INSERT INTO ${escapeId(change.table)} (${cols.map(escapeId).join(', ')}) VALUES (${vals.map(sqlValue).join(', ')});`;
    }

    case 'delete':
      return `DELETE FROM ${escapeId(change.table)} WHERE ${whereClause(change.primaryKeys)};`;
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface ChangeState {
  pending: Change[];
  undone: Change[];
  safeModeLevel: SafeModeLevel;
  previewOpen: boolean;

  addChange: (change: Omit<CellEdit, 'id'> | Omit<RowInsert, 'id'> | Omit<RowDelete, 'id'>) => void;
  undo: () => void;
  redo: () => void;
  discard: () => void;
  discardByTable: (database: string, table: string) => void;
  removeChange: (id: string) => void;
  setPreviewOpen: (open: boolean) => void;
  setSafeModeLevel: (level: SafeModeLevel) => void;
  getPendingForTable: (database: string, table: string) => Change[];
  generateSql: () => string[];
  hasPendingChanges: () => boolean;
  pendingCount: () => number;
}

/**
 * Check whether two primary-key maps are structurally equal.
 */
function primaryKeysEqual(
  a: Record<string, CellValue>,
  b: Record<string, CellValue>,
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

export const useChangeStore = create<ChangeState>((set, get) => ({
  pending: [],
  undone: [],
  safeModeLevel: 'alert_select',
  previewOpen: false,

  addChange: (change) => {
    // Reject edits/deletes without primary keys
    if ((change.type === 'edit' || change.type === 'delete') && Object.keys(change.primaryKeys).length === 0) {
      return;
    }

    const id = crypto.randomUUID();
    const full = { ...change, id } as Change;

    set((s) => {
      const next = s.pending;

      // Dedup logic: if editing the same cell again, replace/remove the old edit
      if (full.type === 'edit') {
        const existingIdx = next.findIndex(
          (c) =>
            c.type === 'edit' &&
            c.table === full.table &&
            c.database === full.database &&
            c.column === full.column &&
            primaryKeysEqual(c.primaryKeys, full.primaryKeys),
        );

        if (existingIdx !== -1) {
          const existing = next[existingIdx] as CellEdit;

          // If reverting to the original value, remove the change entirely
          if (existing.oldValue === full.newValue) {
            return {
              pending: next.filter((_, i) => i !== existingIdx),
              undone: [], // clear redo stack on new change
            };
          }

          // Otherwise replace, preserving the original oldValue
          const replaced: CellEdit = {
            ...full,
            oldValue: existing.oldValue,
          };
          return {
            pending: next.map((c, i) => (i === existingIdx ? replaced : c)),
            undone: [],
          };
        }
      }

      return {
        pending: [...next, full],
        undone: [], // clear redo stack on new change
      };
    });
  },

  undo: () => {
    set((s) => {
      if (s.pending.length === 0) return s;
      const last = s.pending[s.pending.length - 1];
      return {
        pending: s.pending.slice(0, -1),
        undone: [...s.undone, last],
      };
    });
  },

  redo: () => {
    set((s) => {
      if (s.undone.length === 0) return s;
      const last = s.undone[s.undone.length - 1];
      return {
        pending: [...s.pending, last],
        undone: s.undone.slice(0, -1),
      };
    });
  },

  discard: () => {
    set({ pending: [], undone: [] });
  },

  discardByTable: (database, table) => {
    set((s) => ({
      pending: s.pending.filter(
        (c) => !(c.database === database && c.table === table),
      ),
      undone: s.undone.filter(
        (c) => !(c.database === database && c.table === table),
      ),
    }));
  },

  removeChange: (id) => {
    set((s) => ({
      pending: s.pending.filter((c) => c.id !== id),
    }));
  },

  setPreviewOpen: (open) => set({ previewOpen: open }),

  setSafeModeLevel: (level) => set({ safeModeLevel: level }),

  getPendingForTable: (database, table) => {
    return get().pending.filter(
      (c) => c.database === database && c.table === table,
    );
  },

  generateSql: () => {
    return get().pending.map(generateSqlForChange);
  },

  hasPendingChanges: () => {
    return get().pending.length > 0;
  },

  pendingCount: () => {
    return get().pending.length;
  },
}));
