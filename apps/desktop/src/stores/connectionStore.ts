import { create } from 'zustand';
import { ipc, extractErrorMessage } from '../lib/ipc';
import type { SavedConnection, ConnectionConfig } from '../lib/types';

export interface ActiveConnection {
  connectionId: string;
  config: ConnectionConfig;
  connectedAt: Date;
}

interface ConnectionState {
  savedConnections: SavedConnection[];
  /** All currently open connections */
  activeConnections: ActiveConnection[];
  /** The currently focused connection */
  activeConnectionId: string | null;
  activeConfig: ConnectionConfig | null;
  connecting: boolean;
  error: string | null;

  loadSavedConnections: () => Promise<void>;
  connect: (config: ConnectionConfig, password?: string) => Promise<string>;
  disconnect: () => Promise<void>;
  disconnectById: (connectionId: string) => Promise<void>;
  /** Switch focus to a different already-open connection */
  switchConnection: (connectionId: string) => void;
  testConnection: (config: ConnectionConfig, password?: string) => Promise<string>;
  deleteConnection: (id: string) => Promise<void>;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  savedConnections: [],
  activeConnections: [],
  activeConnectionId: null,
  activeConfig: null,
  connecting: false,
  error: null,

  loadSavedConnections: async () => {
    const connections = await ipc.listSavedConnections();
    set({ savedConnections: connections });
  },

  connect: async (config, password) => {
    set({ connecting: true, error: null });
    try {
      const connectionId = await ipc.connect(config, password);
      const activeConn: ActiveConnection = {
        connectionId,
        config,
        connectedAt: new Date(),
      };
      set((s) => ({
        // Prevent duplicates: remove any existing entry for the same config id or connection id
        activeConnections: [
          ...s.activeConnections.filter(
            (c) => c.connectionId !== connectionId && c.config.id !== config.id,
          ),
          activeConn,
        ],
        activeConnectionId: connectionId,
        activeConfig: config,
        connecting: false,
      }));
      await get().loadSavedConnections();
      return connectionId;
    } catch (e) {
      set({ connecting: false, error: extractErrorMessage(e) });
      throw e;
    }
  },

  disconnect: async () => {
    const { activeConnectionId } = get();
    if (activeConnectionId) {
      await get().disconnectById(activeConnectionId);
    }
  },

  disconnectById: async (connectionId) => {
    try {
      await ipc.disconnect(connectionId);
    } catch {
      // Ignore disconnect errors
    }
    set((s) => {
      const remaining = s.activeConnections.filter((c) => c.connectionId !== connectionId);
      const wasActive = s.activeConnectionId === connectionId;
      if (wasActive) {
        // Switch to the most recent remaining connection, or null
        const next = remaining.length > 0 ? remaining[remaining.length - 1] : null;
        return {
          activeConnections: remaining,
          activeConnectionId: next?.connectionId ?? null,
          activeConfig: next?.config ?? null,
        };
      }
      return { activeConnections: remaining };
    });
  },

  switchConnection: (connectionId) => {
    const { activeConnections } = get();
    const target = activeConnections.find((c) => c.connectionId === connectionId);
    if (target) {
      set({
        activeConnectionId: target.connectionId,
        activeConfig: target.config,
      });
    }
  },

  testConnection: async (config, password) => {
    return ipc.testConnection(config, password);
  },

  deleteConnection: async (id) => {
    await ipc.deleteSavedConnection(id);
    await get().loadSavedConnections();
  },
}));
