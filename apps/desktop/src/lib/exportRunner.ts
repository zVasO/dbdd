import { formatColumnar, type ColumnarSlice, type CopyFormat, type FormatColumnarOptions } from './columnarFormat';
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

/** Test seam: pass null to restore the real worker. */
export function setExportWorkerFactory(next: WorkerFactory | null): void {
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
  const request: ExportWorkerRequest = { type: 'format', id, slice, format, options };
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    target.postMessage(request);
  });
}
