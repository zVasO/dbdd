import { formatColumnar, type ColumnarSlice, type CopyFormat, type FormatColumnarOptions } from './columnarFormat';
import type { ColumnData } from './types';
import type { ExportWorkerRequest, ExportWorkerResponse } from '@/workers/exportWorker.protocol';

/**
 * Cells (selected rows × selected columns) at or above which formatting moves
 * off the main thread. Below it the worker's spawn + structured-clone cost
 * dominates the formatting itself, and clipboard gestures on small selections
 * must stay immediate.
 */
export const SYNC_THRESHOLD = 10_000;

export function sliceCellCount(slice: ColumnarSlice): number {
  return slice.rowIndexes.length * slice.colIndexes.length;
}

type WorkerFactory = () => Worker;

const defaultFactory: WorkerFactory = () =>
  new Worker(new URL('../workers/export.worker.ts', import.meta.url), { type: 'module' });

let factory: WorkerFactory = defaultFactory;

/** Test seam: pass null to restore the real worker. Drops any worker the previous factory made. */
export function setExportWorkerFactory(next: WorkerFactory | null): void {
  const orphaned = new Error('Export worker replaced');
  for (const entry of pending.values()) entry.reject(orphaned);
  pending.clear();
  disposeWorker();
  factory = next ?? defaultFactory;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (content: string) => void; reject: (error: Error) => void }>();

function disposeWorker(): void {
  worker?.terminate();
  worker = null;
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const spawned = factory();
  spawned.onmessage = (e: MessageEvent<ExportWorkerResponse>) => {
    const msg = e.data;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.type === 'format-result') entry.resolve(msg.content);
    else entry.reject(new Error(msg.error));
    // The worker holds a structured clone of every slice it was sent; drop it once idle.
    if (pending.size === 0) disposeWorker();
  };
  spawned.onerror = () => {
    const failure = new Error('Export worker failed');
    for (const entry of pending.values()) entry.reject(failure);
    pending.clear();
    disposeWorker();
  };
  worker = spawned;
  return spawned;
}

/**
 * `postMessage` structured-clones everything the slice references, and `data`
 * holds the FULL columnar arrays — posting a 500-row selection out of a 100k-row
 * result would clone the entire dataset to format 10k cells. Compacting first
 * makes the transfer O(selected cells) and leaves the source arrays untouched;
 * the all-rows export case is a straight copy, still a large net win. The
 * compacted slice addresses its own arrays, so both index lists are renumbered.
 */
function compactSlice(slice: ColumnarSlice): ColumnarSlice {
  const { columns, colIndexes, data, rowIndexes } = slice;
  const compacted = colIndexes.map((ci) => {
    const col = data[ci];
    const kind = col?.kind ?? 'Strings';
    const values = rowIndexes.map((r) => col?.values[r] ?? null);
    return { kind, values } as ColumnData;
  });
  return {
    columns,
    colIndexes: compacted.map((_, i) => i),
    data: compacted,
    rowIndexes: rowIndexes.map((_, i) => i),
  };
}

export function runExport(
  slice: ColumnarSlice,
  format: CopyFormat,
  options?: FormatColumnarOptions,
): Promise<string> {
  if (sliceCellCount(slice) < SYNC_THRESHOLD) {
    return Promise.resolve(formatColumnar(slice, format, options));
  }

  let target: Worker;
  try {
    target = ensureWorker();
  } catch {
    return Promise.resolve(formatColumnar(slice, format, options));
  }

  const id = nextId++;
  const request: ExportWorkerRequest = { type: 'format', id, slice: compactSlice(slice), format, options };
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    target.postMessage(request);
  });
}

/**
 * Clipboard writes must be issued inside the user gesture. WKWebView (the macOS
 * webview this app ships on) does not carry user activation across a task
 * boundary, and the worker's reply arrives in a later task — so awaiting the
 * formatted text before writing would lose the gesture on exactly the large
 * selections the worker path exists for. `ClipboardItem` takes a promise, which
 * lets the write start synchronously while formatting finishes off-thread.
 * Where that API is missing, formatting stays inline so the write is fully
 * synchronous.
 *
 * Call this directly from the event handler: anything awaited beforehand
 * reintroduces the boundary this avoids.
 */
export function copyFormatted(
  slice: ColumnarSlice,
  format: CopyFormat,
  options?: FormatColumnarOptions,
): Promise<void> {
  const asyncClipboard =
    typeof ClipboardItem !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.clipboard?.write;

  if (!asyncClipboard) {
    return navigator.clipboard.writeText(formatColumnar(slice, format, options));
  }

  const text = runExport(slice, format, options).then((content) => new Blob([content], { type: 'text/plain' }));
  return navigator.clipboard.write([new ClipboardItem({ 'text/plain': text })]);
}
