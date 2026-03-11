/// <reference lib="webworker" />

interface FilterMessage {
  type: 'filter';
  data: { kind: string; values: (string | number | boolean | null | unknown)[] }[];
  filterText: string;
}

interface SortMessage {
  type: 'sort';
  data: { kind: string; values: (string | number | boolean | null | unknown)[] }[];
  sortColumns: { colIndex: number; direction: 'asc' | 'desc' }[];
  inputIndices?: number[];
}

type WorkerMessage = FilterMessage | SortMessage;

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  if (msg.type === 'filter') {
    const { data, filterText } = msg;
    if (!filterText) {
      self.postMessage({ type: 'filter-result', indices: null });
      return;
    }

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

    self.postMessage({ type: 'filter-result', indices });
  }

  if (msg.type === 'sort') {
    const { data, sortColumns, inputIndices } = msg;
    const rowCount = data[0]?.values.length ?? 0;
    const indices = inputIndices ? [...inputIndices] : Array.from({ length: rowCount }, (_, i) => i);

    indices.sort((a, b) => {
      for (const { colIndex, direction } of sortColumns) {
        const colData = data[colIndex];
        if (!colData) continue;

        const valA = colData.values[a];
        const valB = colData.values[b];

        // Nulls last
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

    self.postMessage({ type: 'sort-result', indices });
  }
};
