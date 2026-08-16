import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionConfig } from '../../lib/types';

const ipcMock = {
  connect: vi.fn(),
};

vi.mock('../../lib/ipc', () => ({
  ipc: ipcMock,
  extractErrorMessage: (e: unknown) => String(e),
}));

const { useConnectionStore, getPersistentConnectionId } = await import('../connectionStore');

function config(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'conn-a',
    name: 'Test DB',
    db_type: 'postgres',
    host: 'localhost',
    port: 5432,
    username: 'user',
    database: 'db',
    ssl_mode: 'disable',
    ssh_tunnel: null,
    color: null,
    environment: null,
    pool_size: null,
    query_timeout_ms: null,
    ...overrides,
  };
}

describe('connectionStore.connect', () => {
  beforeEach(() => {
    useConnectionStore.setState({
      savedConnections: [],
      activeConnections: [],
      activeConnectionId: null,
      activeConfig: null,
      connecting: false,
      error: null,
      lostConnectionIds: [],
    });
    ipcMock.connect.mockReset();
  });

  it('upserts a brand-new connection into savedConnections without an IPC reload', async () => {
    // ipcMock only defines `connect` — if the store still called
    // ipc.listSavedConnections() this would throw, proving no reload round-trip.
    ipcMock.connect.mockResolvedValue('runtime-id-1');
    const cfg = config();

    await useConnectionStore.getState().connect(cfg);

    const { savedConnections } = useConnectionStore.getState();
    expect(savedConnections).toHaveLength(1);
    expect(savedConnections[0].config).toEqual(cfg);
    expect(ipcMock.connect).toHaveBeenCalledTimes(1);
  });

  it('updates the existing saved entry in place on reconnect, preserving created_at/sort_order', async () => {
    const cfg = config();
    useConnectionStore.setState({
      savedConnections: [
        { config: cfg, created_at: '2020-01-01T00:00:00.000Z', last_used_at: null, sort_order: 3 },
      ],
    });
    ipcMock.connect.mockResolvedValue('runtime-id-2');

    await useConnectionStore.getState().connect({ ...cfg, name: 'Renamed' });

    const { savedConnections } = useConnectionStore.getState();
    expect(savedConnections).toHaveLength(1);
    expect(savedConnections[0].config.name).toBe('Renamed');
    expect(savedConnections[0].created_at).toBe('2020-01-01T00:00:00.000Z');
    expect(savedConnections[0].sort_order).toBe(3);
  });

  it('exposes the saved config id, not the per-connect runtime handle, as the persistent id', async () => {
    // Anything stored across sessions (saved queries, history) must key on the
    // config id: the backend mints a fresh connection id on every connect and
    // cascades its own deletes on the config id.
    ipcMock.connect.mockResolvedValue('runtime-handle-1');

    await useConnectionStore.getState().connect(config({ id: 'config-a' }));

    expect(useConnectionStore.getState().activeConnectionId).toBe('runtime-handle-1');
    expect(getPersistentConnectionId()).toBe('config-a');

    ipcMock.connect.mockResolvedValue('runtime-handle-2');
    await useConnectionStore.getState().connect(config({ id: 'config-a' }));

    expect(useConnectionStore.getState().activeConnectionId).toBe('runtime-handle-2');
    expect(getPersistentConnectionId()).toBe('config-a');
  });
});
