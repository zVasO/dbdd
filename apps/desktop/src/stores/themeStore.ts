import { create } from 'zustand';
import type { Theme, ThemeColors, ThemeTypography, ThemeLayout, ThemeShadows } from '@/lib/themeTypes';
import { applyThemeToDOM, clearThemeFromDOM, importTheme } from '@/lib/themeTypes';
import { BUILT_IN_THEMES, DARK_DEFAULT } from '@/lib/builtInThemes';

const STORAGE_KEY = 'dataforge:themes';
const ACTIVE_KEY = 'dataforge:active-theme';

interface ThemeState {
  themes: Theme[];
  activeThemeId: string;

  // Actions
  setActiveTheme: (id: string) => void;
  createTheme: (name: string, baseThemeId?: string) => string;
  duplicateTheme: (id: string) => string;
  deleteTheme: (id: string) => void;
  updateTheme: (id: string, updates: Partial<Pick<Theme, 'name' | 'isDark' | 'colors' | 'typography' | 'layout' | 'shadows'>>) => void;
  updateThemeColors: (id: string, colors: Partial<ThemeColors>) => void;
  updateThemeTypography: (id: string, typography: Partial<ThemeTypography>) => void;
  updateThemeLayout: (id: string, layout: Partial<ThemeLayout>) => void;
  updateThemeShadows: (id: string, shadows: Partial<ThemeShadows>) => void;
  importThemeFromJSON: (json: string) => string | null;
  exportThemeAsJSON: (id: string) => string | null;
  getActiveTheme: () => Theme;
}

function loadCustomThemes(): Theme[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveCustomThemes(themes: Theme[]) {
  const custom = themes.filter((t) => !t.builtIn);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
}

function loadActiveThemeId(): string {
  return localStorage.getItem(ACTIVE_KEY) || 'dark-default';
}

function saveActiveThemeId(id: string) {
  localStorage.setItem(ACTIVE_KEY, id);
}

function generateId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const customThemes = loadCustomThemes();
  const allThemes = [...BUILT_IN_THEMES, ...customThemes];
  const activeId = loadActiveThemeId();
  const activeTheme = allThemes.find((t) => t.id === activeId) || DARK_DEFAULT;

  // Apply theme on startup
  applyThemeToDOM(activeTheme);

  return {
    themes: allThemes,
    activeThemeId: activeTheme.id,

    setActiveTheme: (id) => {
      const theme = get().themes.find((t) => t.id === id);
      if (!theme) return;
      applyThemeToDOM(theme);
      saveActiveThemeId(id);
      set({ activeThemeId: id });
    },

    createTheme: (name, baseThemeId) => {
      const base = baseThemeId
        ? get().themes.find((t) => t.id === baseThemeId) || DARK_DEFAULT
        : DARK_DEFAULT;
      const id = generateId();
      const newTheme: Theme = {
        ...structuredClone(base),
        id,
        name,
        builtIn: false,
      };
      const themes = [...get().themes, newTheme];
      set({ themes });
      saveCustomThemes(themes);
      return id;
    },

    duplicateTheme: (sourceId) => {
      const source = get().themes.find((t) => t.id === sourceId);
      if (!source) return sourceId;
      const id = generateId();
      const newTheme: Theme = {
        ...structuredClone(source),
        id,
        name: `${source.name} (Copy)`,
        builtIn: false,
      };
      const themes = [...get().themes, newTheme];
      set({ themes });
      saveCustomThemes(themes);
      return id;
    },

    deleteTheme: (id) => {
      const theme = get().themes.find((t) => t.id === id);
      if (!theme || theme.builtIn) return;
      const themes = get().themes.filter((t) => t.id !== id);
      set({ themes });
      saveCustomThemes(themes);
      if (get().activeThemeId === id) {
        get().setActiveTheme('dark-default');
      }
    },

    updateTheme: (id, updates) => {
      const themes = get().themes.map((t) => {
        if (t.id !== id || t.builtIn) return t;
        return { ...t, ...updates };
      });
      set({ themes });
      saveCustomThemes(themes);
      if (get().activeThemeId === id) {
        const updated = themes.find((t) => t.id === id);
        if (updated) applyThemeToDOM(updated);
      }
    },

    updateThemeColors: (id, colors) => {
      const themes = get().themes.map((t) => {
        if (t.id !== id || t.builtIn) return t;
        return { ...t, colors: { ...t.colors, ...colors } };
      });
      set({ themes });
      saveCustomThemes(themes);
      if (get().activeThemeId === id) {
        const updated = themes.find((t) => t.id === id);
        if (updated) applyThemeToDOM(updated);
      }
    },

    updateThemeTypography: (id, typography) => {
      const themes = get().themes.map((t) => {
        if (t.id !== id || t.builtIn) return t;
        return { ...t, typography: { ...t.typography, ...typography } };
      });
      set({ themes });
      saveCustomThemes(themes);
      if (get().activeThemeId === id) {
        const updated = themes.find((t) => t.id === id);
        if (updated) applyThemeToDOM(updated);
      }
    },

    updateThemeLayout: (id, layout) => {
      const themes = get().themes.map((t) => {
        if (t.id !== id || t.builtIn) return t;
        return { ...t, layout: { ...t.layout, ...layout } };
      });
      set({ themes });
      saveCustomThemes(themes);
      if (get().activeThemeId === id) {
        const updated = themes.find((t) => t.id === id);
        if (updated) applyThemeToDOM(updated);
      }
    },

    updateThemeShadows: (id, shadows) => {
      const themes = get().themes.map((t) => {
        if (t.id !== id || t.builtIn) return t;
        return { ...t, shadows: { ...t.shadows, ...shadows } };
      });
      set({ themes });
      saveCustomThemes(themes);
      if (get().activeThemeId === id) {
        const updated = themes.find((t) => t.id === id);
        if (updated) applyThemeToDOM(updated);
      }
    },

    importThemeFromJSON: (json) => {
      const theme = importTheme(json);
      if (!theme) return null;
      // Ensure unique ID
      theme.id = generateId();
      theme.builtIn = false;
      const themes = [...get().themes, theme];
      set({ themes });
      saveCustomThemes(themes);
      return theme.id;
    },

    exportThemeAsJSON: (id) => {
      const theme = get().themes.find((t) => t.id === id);
      if (!theme) return null;
      const { builtIn, ...data } = theme;
      return JSON.stringify(data, null, 2);
    },

    getActiveTheme: () => {
      return get().themes.find((t) => t.id === get().activeThemeId) || DARK_DEFAULT;
    },
  };
});
