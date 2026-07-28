import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColumnarResult, ColumnMeta, StreamMeta } from '../../lib/types';

const ipcMock = {
  listenToStream: vi.fn(),
  executeQueryStream: vi.fn(),
  executeQueryColumnar: vi.fn(),
  executeBatch: vi.fn(),
  cancelQuery: vi.fn(),
};

vi.mock('../../lib/ipc', () => ({
  ipc: ipcMock,
  extractErrorMessage: (e: unknown) => String(e),
  isCancellationError: (e: unknown) =>
    !!e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'QUERY_CANCELLED',
}));

// The real store reads localStorage and touches the DOM on creation.
vi.mock('../preferencesStore', () => ({
  usePreferencesStore: {
    getState: () => ({ notifyOnLongQueries: false, longQueryThreshold: 5000 }),
  },
}));

vi.mock('../../lib/sessionRecovery', () => ({ saveSession: vi.fn() }));

const { useQueryStore } = await import('../queryStore');
const { useResultStore } = await import('../resultStore');
const { useConnectionStore } = await import('../connectionStore');

type StreamCallbacks = Parameters<typeof import('../../lib/ipc').ipc.listenToStream>[1];

const CONNECTION_ID = 'conn-1';
const STREAMING_SQL = 'SELECT * FROM big_table';

const COLUMN: ColumnMeta = {
  name: 'id',
  data_type: 'integer',
  native_type: 'int4',
  nullable: false,
  is_primary_key: true,
  max_length: null,
};

function streamMeta(queryId: string): StreamMeta {
  return { query_id: queryId, columns: [COLUMN], result_type: 'Select', warnings: [] };
}

function columnarResult(queryId: string): ColumnarResult {
  return {
    query_id: queryId,
    columns: [COLUMN],
    data: [{ kind: 'Integers', values: [1, 2] }],
    row_count: 2,
    affected_rows: null,
    execution_time_ms: 4,
    warnings: [],
    result_type: 'Select',
  };
}

/** Run a streaming query and hand back its listener callbacks and teardown spy. */
async function startStream(): Promise<{
  tabId: string;
  queryId: string;
  callbacks: StreamCallbacks;
  dispose: ReturnType<typeof vi.fn>;
}> {
  const dispose = vi.fn();
  let callbacks: StreamCallbacks | null = null;
  ipcMock.listenToStream.mockImplementation(async (_id: string, cb: StreamCallbacks) => {
    callbacks = cb;
    return dispose;
  });
  ipcMock.executeQueryStream.mockResolvedValue('ok');

  const tabId = useQueryStore.getState().createTab();
  useQueryStore.getState().updateSql(tabId, STREAMING_SQL);
  await useQueryStore.getState().executeQuery(CONNECTION_ID, tabId);

  const queryId = useQueryStore.getState().allTabs.find((t) => t.id === tabId)!.activeQueryId!;
  return { tabId, queryId, callbacks: callbacks!, dispose };
}

/** Start a single-shot query that stays in flight until `finish()` is called. */
function startSingleShot(): { tabId: string; queryId: string; finish: () => Promise<void> } {
  let answer: (r: ColumnarResult) => void = () => {};
  ipcMock.executeQueryColumnar.mockImplementation(
    () => new Promise<ColumnarResult>((resolve) => { answer = resolve; }),
  );

  const tabId = useQueryStore.getState().createTab();
  useQueryStore.getState().updateSql(tabId, 'SELECT * FROM t LIMIT 10');
  const running = useQueryStore.getState().executeQuery(CONNECTION_ID, tabId);
  const queryId = useQueryStore.getState().allTabs.find((t) => t.id === tabId)!.activeQueryId!;

  return {
    tabId,
    queryId,
    finish: async () => {
      answer(columnarResult(queryId));
      await running;
    },
  };
}

describe('queryStore streaming lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ipcMock.cancelQuery.mockResolvedValue(undefined);
    useQueryStore.setState({ allTabs: [], tabs: [], activeTabIds: {}, activeTabId: null });
    useResultStore.setState({ results: {} });
    useConnectionStore.setState({ activeConnectionId: CONNECTION_ID, activeConnections: [] });
  });

  it('requests chunks the size of the frontend flush threshold', async () => {
    const { queryId } = await startStream();

    expect(ipcMock.executeQueryStream).toHaveBeenCalledWith(
      CONNECTION_ID,
      STREAMING_SQL,
      5000,
      queryId,
    );
  });

  it('closing a tab cancels its in-flight stream and drops the listeners', async () => {
    const { tabId, queryId, dispose } = await startStream();

    useQueryStore.getState().closeTab(tabId);

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(ipcMock.cancelQuery).toHaveBeenCalledWith(CONNECTION_ID, queryId);
  });

  it('closing a tab with no in-flight stream cancels nothing', () => {
    const tabId = useQueryStore.getState().createTab();

    useQueryStore.getState().closeTab(tabId);

    expect(ipcMock.cancelQuery).not.toHaveBeenCalled();
  });

  it('a cancelled stream frees the tab, keeps partial rows and can be re-run', async () => {
    const { tabId, queryId, callbacks, dispose } = await startStream();
    callbacks.onMeta(streamMeta(queryId));
    callbacks.onChunk({ query_id: queryId, offset: 0, data: [{ kind: 'Integers', values: [1, 2] }] });

    callbacks.onCancelled({ query_id: queryId, total_rows: 2, execution_time_ms: 12 });

    const tab = useQueryStore.getState().allTabs.find((t) => t.id === tabId)!;
    expect(tab.isExecuting).toBe(false);
    expect(tab.activeQueryId).toBeNull();
    expect(dispose).toHaveBeenCalledTimes(1);

    const result = useResultStore.getState().results[tabId];
    expect(result.rowCount).toBe(2);
    expect(result.isExecuting).toBe(false);
    expect(result.isStale).toBe(true);

    await useQueryStore.getState().executeQuery(CONNECTION_ID, tabId);
    expect(ipcMock.listenToStream).toHaveBeenCalledTimes(2);
  });

  it('closing a tab cancels its in-flight single-shot query', async () => {
    const { tabId, queryId, finish } = startSingleShot();

    useQueryStore.getState().closeTab(tabId);

    expect(ipcMock.cancelQuery).toHaveBeenCalledWith(CONNECTION_ID, queryId);
    await finish();
  });

  it('a single-shot query answered after its tab closed writes no result', async () => {
    const { tabId, finish } = startSingleShot();
    useQueryStore.getState().closeTab(tabId);

    // The backend may answer anyway — cancellation is best-effort.
    await finish();

    expect(useResultStore.getState().results[tabId]).toBeUndefined();
  });

  it('a late terminal event cannot resurrect a closed tab', async () => {
    const { tabId, queryId, callbacks } = await startStream();
    callbacks.onMeta(streamMeta(queryId));

    useQueryStore.getState().closeTab(tabId);
    callbacks.onDone({ query_id: queryId, total_rows: 2, execution_time_ms: 5 });

    expect(useResultStore.getState().results[tabId]).toBeUndefined();
  });

  it('a finished stream is not cancelled when its tab is closed afterwards', async () => {
    const { tabId, queryId, callbacks } = await startStream();
    callbacks.onMeta(streamMeta(queryId));
    callbacks.onDone({ query_id: queryId, total_rows: 0, execution_time_ms: 3 });

    useQueryStore.getState().closeTab(tabId);

    expect(ipcMock.cancelQuery).not.toHaveBeenCalled();
  });

  it('publishes the query id of a single-shot query before awaiting it', async () => {
    let idWhileRunning: string | null = null;
    const tabId = useQueryStore.getState().createTab();
    useQueryStore.getState().updateSql(tabId, 'SELECT * FROM t LIMIT 10');
    ipcMock.executeQueryColumnar.mockImplementation(async (_c: string, _s: string, id: string) => {
      idWhileRunning = useQueryStore.getState().allTabs.find((t) => t.id === tabId)!.activeQueryId;
      return columnarResult(id);
    });

    await useQueryStore.getState().executeQuery(CONNECTION_ID, tabId);

    const [, , passedId] = ipcMock.executeQueryColumnar.mock.calls[0];
    expect(idWhileRunning).toBe(passedId);
    expect(useQueryStore.getState().allTabs.find((t) => t.id === tabId)!.activeQueryId).toBeNull();
  });

  it('a cancelled single-shot query frees the tab without surfacing an error', async () => {
    const tabId = useQueryStore.getState().createTab();
    useQueryStore.getState().updateSql(tabId, 'SELECT * FROM t LIMIT 10');
    ipcMock.executeQueryColumnar.mockRejectedValue({
      code: 'QUERY_CANCELLED',
      message: 'Query cancelled by user',
    });

    await useQueryStore.getState().executeQuery(CONNECTION_ID, tabId);

    const tab = useQueryStore.getState().allTabs.find((t) => t.id === tabId)!;
    expect(tab.isExecuting).toBe(false);
    expect(tab.activeQueryId).toBeNull();
    expect(tab.error).toBeNull();
    expect(useResultStore.getState().results[tabId].error).toBeNull();
  });
});
