import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runExport, setExportWorkerFactory, sliceCellCount, SYNC_THRESHOLD } from '../exportRunner';
import { formatColumnar, type ColumnarSlice } from '../columnarFormat';
import type { ExportWorkerRequest, ExportWorkerResponse } from '../../workers/exportWorker.protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: ExportWorkerRequest[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<ExportWorkerResponse>) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(msg: ExportWorkerRequest): void {
    this.posted.push(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(msg: ExportWorkerResponse): void {
    this.onmessage?.({ data: msg } as MessageEvent<ExportWorkerResponse>);
  }
}

/** A slice of `rows` × 2 columns; `stored` sizes the underlying arrays independently of the selection. */
function makeSlice(rows: number, stored = rows): ColumnarSlice {
  return {
    columns: [
      { name: 'id', data_type: 'int4', nullable: false } as never,
      { name: 'name', data_type: 'text', nullable: true } as never,
    ],
    colIndexes: [0, 1],
    data: [
      { kind: 'Integers', values: Array.from({ length: stored }, (_, i) => i) },
      { kind: 'Strings', values: Array.from({ length: stored }, (_, i) => `n${i}`) },
    ],
    rowIndexes: Array.from({ length: rows }, (_, i) => i),
  };
}

const onlyWorker = () => FakeWorker.instances[0];

beforeEach(() => {
  FakeWorker.instances = [];
  setExportWorkerFactory(() => new FakeWorker() as unknown as Worker);
});

afterEach(() => {
  setExportWorkerFactory(null);
});

describe('sliceCellCount', () => {
  it('counts the selection (rows × columns), not the stored arrays', () => {
    expect(sliceCellCount(makeSlice(3, 50_000))).toBe(6);
  });
});

describe('runExport threshold routing', () => {
  it('formats inline below the threshold without spawning a worker', async () => {
    const slice = makeSlice(SYNC_THRESHOLD / 2 - 1);
    await expect(runExport(slice, 'csv')).resolves.toBe(formatColumnar(slice, 'csv'));
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('stays inline for a small selection over a large dataset', async () => {
    await runExport(makeSlice(3, 50_000), 'csv');
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('posts to the worker at the threshold', async () => {
    const slice = makeSlice(SYNC_THRESHOLD / 2);
    const pending = runExport(slice, 'insert', { tableName: 'users' });

    expect(FakeWorker.instances).toHaveLength(1);
    const [msg] = onlyWorker().posted;
    expect(msg.type).toBe('format');
    expect(msg.format).toBe('insert');
    expect(msg.options).toEqual({ tableName: 'users' });
    expect(msg.slice).toBe(slice);

    onlyWorker().respond({ type: 'format-result', id: msg.id, content: 'INSERT ...' });
    await expect(pending).resolves.toBe('INSERT ...');
  });
});

describe('runExport worker protocol', () => {
  it('rejects with the worker error message', async () => {
    const pending = runExport(makeSlice(SYNC_THRESHOLD), 'csv');
    const { id } = onlyWorker().posted[0];
    onlyWorker().respond({ type: 'format-error', id, error: 'boom' });
    await expect(pending).rejects.toThrow('boom');
  });

  it('matches ids so concurrent exports resolve to their own content', async () => {
    const first = runExport(makeSlice(SYNC_THRESHOLD), 'csv');
    const second = runExport(makeSlice(SYNC_THRESHOLD), 'markdown');

    const [a, b] = onlyWorker().posted;
    expect(a.id).not.toBe(b.id);

    onlyWorker().respond({ type: 'format-result', id: b.id, content: 'second' });
    onlyWorker().respond({ type: 'format-result', id: a.id, content: 'first' });

    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
  });

  it('reuses one worker while requests are in flight and terminates it once idle', async () => {
    const first = runExport(makeSlice(SYNC_THRESHOLD), 'csv');
    const second = runExport(makeSlice(SYNC_THRESHOLD), 'csv');
    expect(FakeWorker.instances).toHaveLength(1);

    const worker = onlyWorker();
    const [a, b] = worker.posted;
    worker.respond({ type: 'format-result', id: a.id, content: 'a' });
    expect(worker.terminated).toBe(false);
    worker.respond({ type: 'format-result', id: b.id, content: 'b' });
    expect(worker.terminated).toBe(true);

    await Promise.all([first, second]);
  });

  it('rejects everything in flight when the worker itself fails', async () => {
    const pending = runExport(makeSlice(SYNC_THRESHOLD), 'csv');
    onlyWorker().onerror?.(new Error('spawn failed'));
    await expect(pending).rejects.toThrow(/worker/i);
    expect(onlyWorker().terminated).toBe(true);
  });

  it('falls back to inline formatting when a worker cannot be constructed', async () => {
    setExportWorkerFactory(() => {
      throw new Error('Worker is not defined');
    });
    const slice = makeSlice(SYNC_THRESHOLD);
    await expect(runExport(slice, 'csv')).resolves.toBe(formatColumnar(slice, 'csv'));
  });
});
