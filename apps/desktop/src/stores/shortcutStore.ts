import { create } from 'zustand';
import { IS_MACOS } from '@/lib/platform';

// === Types ===

export type Modifier = 'ctrl' | 'shift' | 'alt' | 'meta';

export interface ShortcutBinding {
  key: string;
  modifiers: Modifier[];
}

export type ShortcutCategory = 'global' | 'editor' | 'grid';

export interface ShortcutDef {
  id: string;
  label: string;
  category: ShortcutCategory;
  default: ShortcutBinding;
}

// === Definitions ===

export const SHORTCUT_DEFS: ShortcutDef[] = [
  // Global
  { id: 'global.newTab', label: 'New Query Tab', category: 'global', default: { key: 'n', modifiers: ['ctrl'] } },
  { id: 'global.openAnything', label: 'Open Anything', category: 'global', default: { key: 'p', modifiers: ['ctrl'] } },
  { id: 'global.commandPalette', label: 'Command Palette', category: 'global', default: { key: 'k', modifiers: ['ctrl'] } },
  { id: 'global.toggleSidebar', label: 'Toggle Sidebar', category: 'global', default: { key: 'b', modifiers: ['ctrl'] } },
  { id: 'global.closeTab', label: 'Close Tab', category: 'global', default: { key: 'w', modifiers: ['ctrl'] } },
  { id: 'global.save', label: 'Save / Commit', category: 'global', default: { key: 's', modifiers: ['ctrl'] } },
  { id: 'global.redo', label: 'Redo', category: 'global', default: { key: 'z', modifiers: ['ctrl', 'shift'] } },
  { id: 'global.undo', label: 'Undo', category: 'global', default: { key: 'z', modifiers: ['ctrl'] } },
  { id: 'global.previewChanges', label: 'Preview Changes', category: 'global', default: { key: 'p', modifiers: ['ctrl', 'shift'] } },
  { id: 'global.columnFilter', label: 'Column Filter', category: 'global', default: { key: 'f', modifiers: ['ctrl', 'alt'] } },
  { id: 'global.searchFilter', label: 'Search / Filter', category: 'global', default: { key: 'f', modifiers: ['ctrl'] } },
  { id: 'global.preferences', label: 'Preferences', category: 'global', default: { key: ',', modifiers: ['ctrl'] } },
  { id: 'global.openFile', label: 'Open SQL File', category: 'global', default: { key: 'o', modifiers: ['ctrl'] } },
  { id: 'global.saveFile', label: 'Save SQL File', category: 'global', default: { key: 's', modifiers: ['ctrl', 'shift'] } },
  { id: 'global.aiAssistant', label: 'AI Assistant', category: 'global', default: { key: 'j', modifiers: ['ctrl'] } },
  { id: 'global.insertSnippet', label: 'Insert Snippet', category: 'global', default: { key: 'i', modifiers: ['ctrl', 'shift'] } },
  { id: 'global.export', label: 'Export', category: 'global', default: { key: 'e', modifiers: ['ctrl', 'shift'] } },
  { id: 'global.dataGenerator', label: 'Data Generator', category: 'global', default: { key: 'g', modifiers: ['ctrl', 'shift'] } },
  { id: 'global.fullscreen', label: 'Toggle Full Screen', category: 'global', default: { key: 'f', modifiers: ['ctrl', 'meta'] } },
  { id: 'global.themeSwitcher', label: 'Theme Switcher', category: 'global', default: { key: 'y', modifiers: ['ctrl', 'shift'] } },
  { id: 'global.splitView', label: 'Split View', category: 'global', default: { key: '\\', modifiers: ['ctrl'] } },
  { id: 'global.refresh', label: 'Refresh Query', category: 'global', default: { key: 'r', modifiers: ['ctrl'] } },

  // Editor
  { id: 'editor.execute', label: 'Execute Query', category: 'editor', default: { key: 'Enter', modifiers: ['ctrl'] } },
  { id: 'editor.format', label: 'Format SQL', category: 'editor', default: { key: 'i', modifiers: ['ctrl'] } },
  { id: 'editor.toggleComment', label: 'Toggle Comment', category: 'editor', default: { key: '/', modifiers: ['ctrl'] } },

  // Grid
  { id: 'grid.copy', label: 'Copy Selection', category: 'grid', default: { key: 'c', modifiers: ['ctrl'] } },
  { id: 'grid.selectAll', label: 'Select All', category: 'grid', default: { key: 'a', modifiers: ['ctrl'] } },
  { id: 'grid.paste', label: 'Paste Rows', category: 'grid', default: { key: 'v', modifiers: ['ctrl'] } },
  { id: 'grid.duplicate', label: 'Duplicate Row', category: 'grid', default: { key: 'd', modifiers: ['ctrl'] } },
  { id: 'grid.quickLook', label: 'Quick Look', category: 'grid', default: { key: ' ', modifiers: [] } },
];

const SHORTCUT_MAP = new Map(SHORTCUT_DEFS.map((d) => [d.id, d]));

// === Store ===

const STORAGE_KEY = 'vasodb:shortcuts';

interface ShortcutState {
  overrides: Record<string, ShortcutBinding>;
  getBinding: (id: string) => ShortcutBinding;
  setBinding: (id: string, binding: ShortcutBinding) => void;
  resetBinding: (id: string) => void;
  resetAll: () => void;
  isModified: (id: string) => boolean;
  findConflict: (binding: ShortcutBinding, excludeId?: string) => ShortcutDef | null;
}

function loadOverrides(): Record<string, ShortcutBinding> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveOverrides(overrides: Record<string, ShortcutBinding>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

export const useShortcutStore = create<ShortcutState>((set, get) => ({
  overrides: loadOverrides(),

  getBinding: (id) => {
    const def = SHORTCUT_MAP.get(id);
    if (!def) return { key: '', modifiers: [] };
    return get().overrides[id] || def.default;
  },

  setBinding: (id, binding) => {
    const overrides = { ...get().overrides, [id]: binding };
    set({ overrides });
    saveOverrides(overrides);
  },

  resetBinding: (id) => {
    const { [id]: _removed, ...overrides } = get().overrides;
    set({ overrides });
    saveOverrides(overrides);
  },

  resetAll: () => {
    set({ overrides: {} });
    saveOverrides({});
  },

  isModified: (id) => {
    return id in get().overrides;
  },

  findConflict: (binding, excludeId) => {
    if (!binding.key) return null;
    for (const def of SHORTCUT_DEFS) {
      if (def.id === excludeId) continue;
      const current = get().overrides[def.id] || def.default;
      if (bindingsEqual(current, binding)) return def;
    }
    return null;
  },
}));

// === Utilities ===

function bindingsEqual(a: ShortcutBinding, b: ShortcutBinding): boolean {
  if (a.key.toLowerCase() !== b.key.toLowerCase()) return false;
  if (a.modifiers.length !== b.modifiers.length) return false;
  const sortedA = [...a.modifiers].sort();
  const sortedB = [...b.modifiers].sort();
  return sortedA.every((mod, i) => mod === sortedB[i]);
}

const KEY_DISPLAY: Record<string, string> = {
  ' ': 'Space',
  'arrowup': '\u2191',
  'arrowdown': '\u2193',
  'arrowleft': '\u2190',
  'arrowright': '\u2192',
  'enter': '\u21B5',
  'backspace': '\u232B',
  'delete': 'Del',
  'escape': 'Esc',
  'tab': 'Tab',
  ',': ',',
  '.': '.',
  '/': '/',
  '\\': '\\',
  '[': '[',
  ']': ']',
  '-': '-',
  '=': '=',
  '`': '`',
};

export function formatBindingParts(binding: ShortcutBinding): string[] {
  if (!binding.key) return ['None'];
  const parts: string[] = [];

  if (IS_MACOS) {
    const hasBothCtrlAndMeta = binding.modifiers.includes('ctrl') && binding.modifiers.includes('meta');
    if (hasBothCtrlAndMeta) {
      // Both present: ctrl = ⌃ (Control), meta = ⌘ (Command)
      parts.push('\u2303'); // ⌃
    }
    if (binding.modifiers.includes('alt')) parts.push('\u2325');
    if (binding.modifiers.includes('shift')) parts.push('\u21E7');
    if (hasBothCtrlAndMeta) {
      parts.push('\u2318'); // ⌘
    } else if (binding.modifiers.includes('ctrl') || binding.modifiers.includes('meta')) {
      parts.push('\u2318'); // ⌘ (primary mod)
    }
  } else {
    if (binding.modifiers.includes('ctrl')) parts.push('Ctrl');
    if (binding.modifiers.includes('shift')) parts.push('Shift');
    if (binding.modifiers.includes('alt')) parts.push('Alt');
    if (binding.modifiers.includes('meta')) parts.push('Meta');
  }

  const keyDisplay = KEY_DISPLAY[binding.key.toLowerCase()] || binding.key.toUpperCase();
  parts.push(keyDisplay);
  return parts;
}

export function formatBinding(binding: ShortcutBinding): string {
  const parts = formatBindingParts(binding);
  if (parts.length === 1 && parts[0] === 'None') return 'None';
  return parts.join(IS_MACOS ? '' : '+');
}

/** Check if a keyboard event matches a shortcut binding */
export function matchesBinding(e: KeyboardEvent | React.KeyboardEvent, binding: ShortcutBinding): boolean {
  if (!binding.key) return false;
  const wantsCtrl = binding.modifiers.includes('ctrl');
  const wantsShift = binding.modifiers.includes('shift');
  const wantsAlt = binding.modifiers.includes('alt');
  const wantsMeta = binding.modifiers.includes('meta');

  const ctrlPressed = e.ctrlKey || e.metaKey;

  if (wantsCtrl !== ctrlPressed) return false;
  if (wantsShift !== e.shiftKey) return false;
  if (wantsAlt !== e.altKey) return false;
  if (!wantsCtrl && wantsMeta !== e.metaKey) return false;

  return e.key.toLowerCase() === binding.key.toLowerCase();
}

/** Extract a ShortcutBinding from a keyboard event (for recording) */
export function bindingFromEvent(e: KeyboardEvent): ShortcutBinding | null {
  // Ignore standalone modifier presses
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;

  const modifiers: Modifier[] = [];
  if (e.ctrlKey || e.metaKey) modifiers.push('ctrl');
  if (e.shiftKey) modifiers.push('shift');
  if (e.altKey) modifiers.push('alt');

  return { key: e.key, modifiers };
}
