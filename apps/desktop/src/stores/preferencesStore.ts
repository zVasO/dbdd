import { create } from 'zustand';

export type CopyFormat = 'json' | 'csv' | 'tsv' | 'markdown' | 'insert';

export type DarkModeScheduleMode = 'manual' | 'system' | 'schedule';

export interface DarkModeSchedule {
  mode: DarkModeScheduleMode;
  lightFrom?: string; // "07:00"
  darkFrom?: string;  // "19:00"
}

export interface Preferences {
  theme: 'light' | 'dark';
  editorFontSize: number;
  editorShowLineNumbers: boolean;
  editorWordWrap: boolean;
  autoUppercaseKeywords: boolean;
  defaultPageSize: number;
  alternatingRowColors: boolean;
  safeModeLevel: 'silent' | 'alert' | 'alert_select' | 'password' | 'password_select';
  defaultCopyFormat: CopyFormat;
  darkModeSchedule: DarkModeSchedule;
  notifyOnLongQueries: boolean;
  longQueryThreshold: number; // ms
}

const STORAGE_KEY = 'dataforge:preferences';

const DEFAULTS: Preferences = {
  theme: 'dark',
  editorFontSize: 13,
  editorShowLineNumbers: true,
  editorWordWrap: true,
  autoUppercaseKeywords: false,
  defaultPageSize: 100,
  alternatingRowColors: false,
  safeModeLevel: 'alert',
  defaultCopyFormat: 'json',
  darkModeSchedule: { mode: 'manual' },
  notifyOnLongQueries: true,
  longQueryThreshold: 5000,
};

function loadFromStorage(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveToStorage(prefs: Preferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

interface PreferencesState extends Preferences {
  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
}

export const usePreferencesStore = create<PreferencesState>((set, get) => {
  const initial = loadFromStorage();
  applyTheme(initial.theme);

  return {
    ...initial,

    setPreference: (key, value) => {
      set({ [key]: value } as Partial<PreferencesState>);
      const state = get();
      const prefs: Preferences = {
        theme: state.theme,
        editorFontSize: state.editorFontSize,
        editorShowLineNumbers: state.editorShowLineNumbers,
        editorWordWrap: state.editorWordWrap,
        autoUppercaseKeywords: state.autoUppercaseKeywords,
        defaultPageSize: state.defaultPageSize,
        alternatingRowColors: state.alternatingRowColors,
        safeModeLevel: state.safeModeLevel,
        defaultCopyFormat: state.defaultCopyFormat,
        darkModeSchedule: state.darkModeSchedule,
        notifyOnLongQueries: state.notifyOnLongQueries,
        longQueryThreshold: state.longQueryThreshold,
      };
      if (key === 'theme') applyTheme(value as 'light' | 'dark');
      saveToStorage(prefs);
    },
  };
});
