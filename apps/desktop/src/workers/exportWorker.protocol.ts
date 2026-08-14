import type { ColumnarSlice, CopyFormat, FormatColumnarOptions } from '@/lib/columnarFormat';

/**
 * Messages sent to the export worker. Unlike the grid worker, the export worker
 * keeps no state: every request carries the slice it formats, so the worker can
 * be spawned on demand and dropped once idle.
 */
export interface ExportWorkerRequest {
  type: 'format';
  id: number;
  slice: ColumnarSlice;
  format: CopyFormat;
  options?: FormatColumnarOptions;
}

export type ExportWorkerResponse =
  | { type: 'format-result'; id: number; content: string }
  | { type: 'format-error'; id: number; error: string };
