import { beforeEach, describe, expect, it } from 'vitest';
import type { AppEvent } from '../../lib/types';
import { applyAppEvent, useActivityStore } from '../activityStore';

function queryCancelled(query_id: string): AppEvent {
  return { event_type: 'QueryCancelled', payload: { query_id } };
}

function queryProgress(query_id: string, rows_fetched: number, elapsed_ms = 0): AppEvent {
  return { event_type: 'QueryProgress', payload: { query_id, rows_fetched, elapsed_ms } };
}

function queryStarted(query_id: string): AppEvent {
  return { event_type: 'QueryStarted', payload: { query_id, sql: 'SELECT 1' } };
}

describe('activityStore applyAppEvent', () => {
  beforeEach(() => {
    useActivityStore.setState({ entries: [], expanded: false, recentTables: [] });
  });

  it('QueryCancelled transitions a still-running linked entry to cancelled with no error text', () => {
    const store = useActivityStore.getState();
    const id = store.logStart('SELECT * FROM big_table', 'conn-1');
    store.attachQueryId(id, 'q-1');

    applyAppEvent(queryCancelled('q-1'));

    const entry = useActivityStore.getState().entries[0];
    expect(entry.status).toBe('cancelled');
    expect(entry.error).toBeNull();
  });

  it('QueryProgress sets the progress text on the linked entry', () => {
    const store = useActivityStore.getState();
    const id = store.logStart('SELECT * FROM big_table', 'conn-1');
    store.attachQueryId(id, 'q-2');

    applyAppEvent(queryProgress('q-2', 4200));

    const entry = useActivityStore.getState().entries[0];
    expect(entry.progress).toBe('4,200 rows');
    expect(entry.status).toBe('running');
  });

  it('an event for an unlinked query_id is a no-op, not a crash', () => {
    const store = useActivityStore.getState();
    store.logStart('SELECT 1', 'conn-1');

    expect(() => applyAppEvent(queryCancelled('unknown-id'))).not.toThrow();
    expect(() => applyAppEvent(queryProgress('unknown-id', 10))).not.toThrow();

    const entry = useActivityStore.getState().entries[0];
    expect(entry.status).toBe('running');
    expect(entry.progress).toBeNull();
  });

  it('does not create a duplicate entry when a started event arrives for an id queryStore already created', () => {
    const store = useActivityStore.getState();
    const id = store.logStart('SELECT * FROM t', 'conn-1');
    store.attachQueryId(id, 'q-3');

    applyAppEvent(queryStarted('q-3'));

    expect(useActivityStore.getState().entries).toHaveLength(1);
    expect(useActivityStore.getState().entries[0].id).toBe(id);
  });

  it('renders the cancelled transition via the status field, independent of color', () => {
    const store = useActivityStore.getState();
    const id = store.logStart('DELETE FROM t', 'conn-1');
    store.attachQueryId(id, 'q-4');

    applyAppEvent(queryCancelled('q-4'));

    const entry = useActivityStore.getState().entries[0];
    expect(entry.status).toBe('cancelled');
    expect(entry.status).not.toBe('error');
  });

  it('a cancelled entry is not downgraded by a racing genuine error', () => {
    const store = useActivityStore.getState();
    const id = store.logStart('SELECT * FROM t', 'conn-1');
    store.attachQueryId(id, 'q-5');

    applyAppEvent(queryCancelled('q-5'));
    store.logError(id, 900, 'connection reset');

    const entry = useActivityStore.getState().entries[0];
    expect(entry.status).toBe('cancelled');
    expect(entry.error).toBeNull();
  });

  it('a cancelled entry is not downgraded by a racing late success', () => {
    const store = useActivityStore.getState();
    const id = store.logStart('SELECT * FROM t', 'conn-1');
    store.attachQueryId(id, 'q-6');

    applyAppEvent(queryCancelled('q-6'));
    store.logSuccess(id, 900, 42);

    const entry = useActivityStore.getState().entries[0];
    expect(entry.status).toBe('cancelled');
    expect(entry.rowCount).toBeNull();
  });

  it('a settled success entry is not flipped by a late cancellation event', () => {
    const store = useActivityStore.getState();
    const id = store.logStart('SELECT * FROM t', 'conn-1');
    store.attachQueryId(id, 'q-7');
    store.logSuccess(id, 120, 7);

    applyAppEvent(queryCancelled('q-7'));

    const entry = useActivityStore.getState().entries[0];
    expect(entry.status).toBe('success');
    expect(entry.rowCount).toBe(7);
    expect(entry.durationMs).toBe(120);
  });

  it('a settled error entry is not flipped by a late cancellation event', () => {
    const store = useActivityStore.getState();
    const id = store.logStart('SELECT * FROM t', 'conn-1');
    store.attachQueryId(id, 'q-8');
    store.logError(id, 340, 'syntax error');

    applyAppEvent(queryCancelled('q-8'));

    const entry = useActivityStore.getState().entries[0];
    expect(entry.status).toBe('error');
    expect(entry.error).toBe('syntax error');
    expect(entry.durationMs).toBe(340);
  });
});
