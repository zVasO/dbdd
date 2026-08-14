/// <reference lib="webworker" />

import { formatColumnar } from '@/lib/columnarFormat';
import type { ExportWorkerRequest, ExportWorkerResponse } from './exportWorker.protocol';

self.onmessage = (e: MessageEvent<ExportWorkerRequest>) => {
  const { id, slice, format, options } = e.data;
  const reply = (msg: ExportWorkerResponse) => self.postMessage(msg);
  try {
    reply({ type: 'format-result', id, content: formatColumnar(slice, format, options) });
  } catch (err) {
    reply({ type: 'format-error', id, error: String(err) });
  }
};
