/// <reference lib="webworker" />

import type { ColumnData } from '@/lib/types';
import type { GridWorkerRequest, SortColumn } from './gridWorker.protocol';

let data: ColumnData[] = [];
let lastFilterIndices: number[] | null = null;

function computeFilter(filterText: string): number[] | null {
  if (!filterText) return null;

  const lower = filterText.toLowerCase();
  const rowCount = data[0]?.values.length ?? 0;
  const indices: number[] = [];

  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < data.length; col++) {
      const val = data[col].values[row];
      if (val !== null && val !== undefined && String(val).toLowerCase().includes(lower)) {
        indices.push(row);
        break;
      }
    }
  }

  return indices;
}

function computeSort(sortColumns: SortColumn[], inputIndices: number[] | null): number[] {
  const rowCount = data[0]?.values.length ?? 0;
  const indices = inputIndices ? [...inputIndices] : Array.from({ length: rowCount }, (_, i) => i);

  indices.sort((a, b) => {
    for (const { colIndex, direction } of sortColumns) {
      const colData = data[colIndex];
      if (!colData) continue;

      const valA = colData.values[a];
      const valB = colData.values[b];

      if (valA === null && valB !== null) return 1;
      if (valA !== null && valB === null) return -1;
      if (valA === null && valB === null) continue;

      let cmp = 0;
      if (typeof valA === 'number' && typeof valB === 'number') {
        cmp = valA - valB;
      } else {
        cmp = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
      }

      if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
    }
    return 0;
  });

  return indices;
}

self.onmessage = (e: MessageEvent<GridWorkerRequest>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'setData':
      data = msg.columns;
      lastFilterIndices = null;
      return;

    case 'appendData':
      for (let col = 0; col < data.length; col++) {
        const incoming = msg.columns[col];
        if (!incoming) continue;
        const target = data[col].values as unknown[];
        const source = incoming.values as unknown[];
        for (let i = 0; i < source.length; i++) target.push(source[i]);
      }
      return;

    case 'filter':
      lastFilterIndices = computeFilter(msg.filterText);
      self.postMessage({ type: 'filter-result', indices: lastFilterIndices });
      return;

    case 'sort': {
      const input = msg.useFilteredInput ? lastFilterIndices : null;
      self.postMessage({ type: 'sort-result', indices: computeSort(msg.sortColumns, input) });
      return;
    }
  }
};
