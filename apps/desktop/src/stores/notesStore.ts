import { create } from 'zustand';

export interface Note {
  id: string;
  targetType: 'table' | 'column' | 'query';
  targetKey: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

interface NotesState {
  notes: Note[];
  panelOpen: boolean;
  editingNoteId: string | null;

  addNote: (targetType: Note['targetType'], targetKey: string, content: string) => void;
  updateNote: (id: string, content: string) => void;
  deleteNote: (id: string) => void;
  getNotesFor: (targetKey: string) => Note[];
  hasNotes: (targetKey: string) => boolean;
  setPanelOpen: (open: boolean) => void;
  setEditingNoteId: (id: string | null) => void;
}

const STORAGE_KEY = 'vasodb:notes';

function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Note[];
  } catch {
    return [];
  }
}

function persistNotes(notes: Note[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: loadNotes(),
  panelOpen: false,
  editingNoteId: null,

  addNote: (targetType, targetKey, content) => {
    const now = Date.now();
    const note: Note = {
      id: crypto.randomUUID(),
      targetType,
      targetKey,
      content,
      createdAt: now,
      updatedAt: now,
    };
    const updated = [...get().notes, note];
    set({ notes: updated });
    persistNotes(updated);
  },

  updateNote: (id, content) => {
    const updated = get().notes.map((n) =>
      n.id === id ? { ...n, content, updatedAt: Date.now() } : n,
    );
    set({ notes: updated });
    persistNotes(updated);
  },

  deleteNote: (id) => {
    const updated = get().notes.filter((n) => n.id !== id);
    set({ notes: updated, editingNoteId: get().editingNoteId === id ? null : get().editingNoteId });
    persistNotes(updated);
  },

  getNotesFor: (targetKey) => {
    return get().notes.filter((n) => n.targetKey === targetKey);
  },

  hasNotes: (targetKey) => {
    return get().notes.some((n) => n.targetKey === targetKey);
  },

  setPanelOpen: (open) => {
    set({ panelOpen: open, editingNoteId: open ? get().editingNoteId : null });
  },

  setEditingNoteId: (id) => {
    set({ editingNoteId: id });
  },
}));
