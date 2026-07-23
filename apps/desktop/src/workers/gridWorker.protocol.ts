import type { ColumnData } from '@/lib/types';

export interface SortColumn {
  colIndex: number;
  direction: 'asc' | 'desc';
}

/**
 * Messages sent to the grid worker. The worker keeps the dataset in its own
 * state, so `filter`/`sort` carry only parameters — the columnar data is
 * synced once via `setData` and grown via `appendData`, never re-sent per
 * keystroke.
 */
export type GridWorkerRequest =
  | { type: 'setData'; columns: ColumnData[] }
  | { type: 'appendData'; columns: ColumnData[] }
  | { type: 'filter'; filterText: string }
  | { type: 'sort'; sortColumns: SortColumn[]; useFilteredInput: boolean };

export type GridWorkerResponse =
  | { type: 'filter-result'; indices: number[] | null }
  | { type: 'sort-result'; indices: number[] | null };
