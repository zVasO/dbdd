import { create } from 'zustand';
import { ipc } from '../lib/ipc';
import type { SavedConnection, ConnectionConfig } from '../lib/types';

interface ConnectionState {
  savedConnections: SavedConnection[];
  activeConnectionId: string | null;
  activeConfig: ConnectionConfig | null;
  connecting: boolean;
  error: string | null;

  loadSavedConnections: () => Promise<void>;
  connect: (config: ConnectionConfig, password?: string) => Promise<string>;
  disconnect: () => Promise<void>;
  testConnection: (config: ConnectionConfig, password?: string) => Promise<string>;
  deleteConnection: (id: string) => Promise<void>;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  savedConnections: [],
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
      set({
        activeConnectionId: connectionId,
        activeConfig: config,
        connecting: false,
      });
      // Reload saved connections list so the UI reflects the new/updated connection
      await get().loadSavedConnections();
      return connectionId;
    } catch (e) {
      set({ connecting: false, error: String(e) });
      throw e;
    }
  },

  disconnect: async () => {
    const { activeConnectionId } = get();
    if (activeConnectionId) {
      await ipc.disconnect(activeConnectionId);
      set({ activeConnectionId: null, activeConfig: null });
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
