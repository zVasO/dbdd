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
}

export const useUIStore = create<UIState>((set) => ({
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
}));
