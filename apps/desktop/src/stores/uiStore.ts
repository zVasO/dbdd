import { create } from 'zustand';

interface UIState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  theme: 'light' | 'dark';
  commandPaletteOpen: boolean;
  openAnythingOpen: boolean;

  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  toggleTheme: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setOpenAnythingOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  sidebarWidth: 260,
  theme: 'dark',
  commandPaletteOpen: false,
  openAnythingOpen: false,

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  toggleTheme: () =>
    set((s) => {
      const next = s.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', next === 'dark');
      return { theme: next };
    }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setOpenAnythingOpen: (open) => set({ openAnythingOpen: open }),
}));
