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

/**
 * A selection of `rows` × 2 columns starting at `firstRow`; `stored` sizes the
 * underlying arrays independently of the selection.
 */
function makeSlice(rows: number, stored = rows, firstRow = 0): ColumnarSlice {
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
    rowIndexes: Array.from({ length: rows }, (_, i) => firstRow + i),
  };
}

const onlyWorker = () => FakeWorker.instances[0];

/** Runs an export through the worker and settles it, returning what was posted. */
async function postedRequest(slice: ColumnarSlice): Promise<ExportWorkerRequest> {
  const pending = runExport(slice, 'csv');
  const msg = onlyWorker().posted[onlyWorker().posted.length - 1];
  onlyWorker().respond({ type: 'format-result', id: msg.id, content: '' });
  await pending;
  return msg;
}

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

    onlyWorker().respond({ type: 'format-result', id: msg.id, content: 'INSERT ...' });
    await expect(pending).resolves.toBe('INSERT ...');
  });
});

describe('runExport slice compaction', () => {
  it('posts only the selected cells, not the full columnar arrays', async () => {
    const rows = SYNC_THRESHOLD / 2;
    const slice = makeSlice(rows, 60_000, 10_000);
    const posted = (await postedRequest(slice)).slice;

    expect(posted).not.toBe(slice);
    expect(posted.data).toHaveLength(2);
    for (const col of posted.data) expect(col.values).toHaveLength(rows);
    expect(posted.data[0].kind).toBe('Integers');
    expect(posted.data[1].kind).toBe('Strings');
    // Values come from the selected rows, not from the head of the arrays.
    expect(posted.data[0].values[0]).toBe(10_000);
    expect(posted.data[1].values[0]).toBe('n10000');
    // The source arrays are untouched.
    expect(slice.data[0].values).toHaveLength(60_000);
  });

  it('remaps rowIndexes and colIndexes onto the compacted arrays', async () => {
    const rows = SYNC_THRESHOLD / 2;
    const posted = (await postedRequest(makeSlice(rows, 60_000, 10_000))).slice;

    expect(posted.rowIndexes).toEqual(Array.from({ length: rows }, (_, i) => i));
    expect(posted.colIndexes).toEqual([0, 1]);
  });

  it('drops unselected columns and renumbers the remaining ones', async () => {
    const slice = makeSlice(SYNC_THRESHOLD, 20_000, 5_000);
    slice.data.push({ kind: 'Strings', values: Array.from({ length: 20_000 }, () => 'unselected') });
    slice.colIndexes = [1];
    slice.columns = [slice.columns[1]];
    const posted = (await postedRequest(slice)).slice;

    expect(posted.data).toHaveLength(1);
    expect(posted.colIndexes).toEqual([0]);
    expect(posted.data[0].values[0]).toBe('n5000');
  });

  it('compaction does not change what the formatter produces', async () => {
    const slice = makeSlice(SYNC_THRESHOLD / 2, 60_000, 10_000);
    const posted = (await postedRequest(slice)).slice;

    expect(formatColumnar(posted, 'csv')).toBe(formatColumnar(slice, 'csv'));
    expect(formatColumnar(posted, 'json')).toBe(formatColumnar(slice, 'json'));
  });

  it('keeps the columns metadata as-is', async () => {
    const slice = makeSlice(SYNC_THRESHOLD / 2, 60_000);
    expect((await postedRequest(slice)).slice.columns).toBe(slice.columns);
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
