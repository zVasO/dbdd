import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedQuery } from '../../lib/types';

const ipcMock = {
  listSavedQueries: vi.fn(),
  saveSavedQuery: vi.fn(),
  deleteSavedQuery: vi.fn(),
};

vi.mock('../../lib/ipc', () => ({
  ipc: ipcMock,
  extractErrorMessage: (e: unknown) => String(e),
}));

const { useSavedQueryStore, groupByDatabase } = await import('../savedQueryStore');

function query(overrides: Partial<SavedQuery> = {}): SavedQuery {
  return {
    id: 'q-1',
    connection_id: 'conn-a',
    database: 'app',
    name: 'Recent signups',
    description: null,
    sql: 'SELECT 1',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('groupByDatabase', () => {
  it('puts the NULL-database group first and sorts the remaining databases', () => {
    const groups = groupByDatabase([
      query({ id: '1', database: 'sales' }),
      query({ id: '2', database: null }),
      query({ id: '3', database: 'app' }),
    ]);

    expect(groups.map((g) => g.database)).toEqual([null, 'app', 'sales']);
  });

  it('sorts queries by name inside each group', () => {
    const groups = groupByDatabase([
      query({ id: '1', database: 'app', name: 'Zebra' }),
      query({ id: '2', database: 'app', name: 'apple' }),
      query({ id: '3', database: 'app', name: 'Mango' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].queries.map((q) => q.name)).toEqual(['apple', 'Mango', 'Zebra']);
  });

  it('returns no groups for an empty list', () => {
    expect(groupByDatabase([])).toEqual([]);
  });
});

describe('savedQueryStore', () => {
  beforeEach(() => {
    useSavedQueryStore.setState({ byConnection: {}, manageOpen: false });
    ipcMock.listSavedQueries.mockReset();
    ipcMock.saveSavedQuery.mockReset().mockResolvedValue(undefined);
    ipcMock.deleteSavedQuery.mockReset().mockResolvedValue(undefined);
  });

  it('load replaces the slice of one connection without touching the others', async () => {
    const other = query({ id: 'other', connection_id: 'conn-b' });
    useSavedQueryStore.setState({
      byConnection: {
        'conn-a': [query({ id: 'stale' })],
        'conn-b': [other],
      },
    });
    const fresh = [query({ id: 'fresh' })];
    ipcMock.listSavedQueries.mockResolvedValue(fresh);

    await useSavedQueryStore.getState().load('conn-a');

    const { byConnection } = useSavedQueryStore.getState();
    expect(byConnection['conn-a']).toEqual(fresh);
    expect(byConnection['conn-b']).toEqual([other]);
    expect(ipcMock.listSavedQueries).toHaveBeenCalledWith('conn-a');
  });

  it('save stamps updated_at, persists the stamped record and inserts it locally', async () => {
    const before = Date.now();

    const saved = await useSavedQueryStore.getState().save({
      id: 'q-new',
      connection_id: 'conn-a',
      database: 'app',
      name: 'New one',
      description: null,
      sql: 'SELECT 2',
    });

    expect(Date.parse(saved.updated_at)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(saved.created_at)).toBeGreaterThanOrEqual(before);
    expect(ipcMock.saveSavedQuery).toHaveBeenCalledWith(saved);
    expect(useSavedQueryStore.getState().byConnection['conn-a']).toEqual([saved]);
  });

  it('save keeps a supplied created_at and replaces the existing entry in place', async () => {
    const existing = query({ id: 'q-1', name: 'Old name' });
    useSavedQueryStore.setState({
      byConnection: { 'conn-a': [query({ id: 'q-0', name: 'Untouched' }), existing] },
    });

    const saved = await useSavedQueryStore.getState().save({
      id: 'q-1',
      connection_id: 'conn-a',
      database: 'app',
      name: 'New name',
      description: 'now described',
      sql: 'SELECT 3',
      created_at: existing.created_at,
    });

    expect(saved.created_at).toBe(existing.created_at);
    expect(saved.updated_at).not.toBe(existing.updated_at);

    const slice = useSavedQueryStore.getState().byConnection['conn-a'];
    expect(slice.map((q) => q.id)).toEqual(['q-0', 'q-1']);
    expect(slice[1]).toEqual(saved);
  });

  it('remove drops the entry locally and deletes it through ipc', async () => {
    useSavedQueryStore.setState({
      byConnection: { 'conn-a': [query({ id: 'q-1' }), query({ id: 'q-2' })] },
    });

    await useSavedQueryStore.getState().remove('q-1', 'conn-a');

    expect(ipcMock.deleteSavedQuery).toHaveBeenCalledWith('q-1');
    expect(useSavedQueryStore.getState().byConnection['conn-a'].map((q) => q.id)).toEqual(['q-2']);
  });

  it('remove leaves the local slice untouched when the delete fails', async () => {
    useSavedQueryStore.setState({ byConnection: { 'conn-a': [query({ id: 'q-1' })] } });
    ipcMock.deleteSavedQuery.mockRejectedValue(new Error('locked'));

    await expect(useSavedQueryStore.getState().remove('q-1', 'conn-a')).rejects.toThrow('locked');
    expect(useSavedQueryStore.getState().byConnection['conn-a'].map((q) => q.id)).toEqual(['q-1']);
  });
});
