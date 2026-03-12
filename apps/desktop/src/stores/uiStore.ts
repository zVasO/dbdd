import { create } from 'zustand';
import { usePreferencesStore } from './preferencesStore';
import { useThemeStore } from './themeStore';

interface UIState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  commandPaletteOpen: boolean;
  openAnythingOpen: boolean;
  settingsOpen: boolean;

  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  toggleTheme: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setOpenAnythingOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;

  // Modal stack
  modalStack: string[];
  pushModal: (id: string) => void;
  popModal: (id: string) => void;
  isModalOpen: () => boolean;
  topModal: () => string | null;

  // Split view
  splitMode: 'single' | 'horizontal';
  secondaryActiveTabId: string | null;
  setSplitMode: (mode: 'single' | 'horizontal') => void;
  setSecondaryActiveTabId: (id: string | null) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarOpen: true,
  sidebarWidth: 260,
  commandPaletteOpen: false,
  openAnythingOpen: false,
  settingsOpen: false,

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  toggleTheme: () => {
    useThemeStore.getState().toggleDarkMode();
    // Keep prefs store in sync
    const prefs = usePreferencesStore.getState();
    const next = prefs.theme === 'dark' ? 'light' : 'dark';
    prefs.setPreference('theme', next);
  },
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setOpenAnythingOpen: (open) => set({ openAnythingOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  // Modal stack
  modalStack: [],
  pushModal: (id) => set((s) => ({ modalStack: [...s.modalStack, id] })),
  popModal: (id) => set((s) => ({ modalStack: s.modalStack.filter((m) => m !== id) })),
  isModalOpen: () => get().modalStack.length > 0,
  topModal: () => {
    const stack = get().modalStack;
    return stack.length > 0 ? stack[stack.length - 1] : null;
  },

  // Split view
  splitMode: 'single' as const,
  secondaryActiveTabId: null,
  setSplitMode: (mode) => set({ splitMode: mode }),
  setSecondaryActiveTabId: (id) => set({ secondaryActiveTabId: id }),
}));
