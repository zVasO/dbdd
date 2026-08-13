import type { CellEdit, Change, RowInsert } from '@/stores/changeStore';

export const editKey = (rowIndex: number, column: string) => `${rowIndex}:${column}`;

export interface PendingIndex {
  edits: Map<string, CellEdit>;
  deletedRows: Set<number>;
  inserts: RowInsert[];
}

export function buildPendingIndex(pending: readonly Change[]): PendingIndex {
  const edits = new Map<string, CellEdit>();
  const deletedRows = new Set<number>();
  const inserts: RowInsert[] = [];
  for (const change of pending) {
    if (change.type === 'edit') {
      const key = editKey(change.rowIndex, change.column);
      if (!edits.has(key)) edits.set(key, change);
    } else if (change.type === 'delete') {
      deletedRows.add(change.rowIndex);
    } else if (change.type === 'insert') {
      inserts.push(change);
    }
  }
  return { edits, deletedRows, inserts };
}
