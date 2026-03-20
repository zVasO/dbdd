import { create } from 'zustand';

export interface Snippet {
  id: string;
  name: string;
  sql: string;
  description: string;
  variables: string[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'vasodb:snippets';

function loadSnippets(): Snippet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Snippet[];
  } catch {
    return [];
  }
}

function persistSnippets(snippets: Snippet[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
}

function extractVariables(sql: string): string[] {
  const matches = sql.match(/\$[a-zA-Z_][a-zA-Z0-9_]*/g);
  if (!matches) return [];
  return [...new Set(matches)];
}

interface SnippetState {
  snippets: Snippet[];
  createSnippet: (data: {
    name: string;
    sql: string;
    description: string;
    tags: string[];
  }) => Snippet;
  updateSnippet: (
    id: string,
    data: Partial<{
      name: string;
      sql: string;
      description: string;
      tags: string[];
    }>,
  ) => void;
  deleteSnippet: (id: string) => void;
  getSnippets: () => Snippet[];
}

export const useSnippetStore = create<SnippetState>((set, get) => ({
  snippets: loadSnippets(),

  createSnippet: (data) => {
    const now = Date.now();
    const snippet: Snippet = {
      id: crypto.randomUUID(),
      name: data.name,
      sql: data.sql,
      description: data.description,
      variables: extractVariables(data.sql),
      tags: data.tags,
      createdAt: now,
      updatedAt: now,
    };
    const updated = [...get().snippets, snippet];
    set({ snippets: updated });
    persistSnippets(updated);
    return snippet;
  },

  updateSnippet: (id, data) => {
    const updated = get().snippets.map((s) => {
      if (s.id !== id) return s;
      const newSql = data.sql ?? s.sql;
      return {
        ...s,
        ...data,
        variables: extractVariables(newSql),
        updatedAt: Date.now(),
      };
    });
    set({ snippets: updated });
    persistSnippets(updated);
  },

  deleteSnippet: (id) => {
    const updated = get().snippets.filter((s) => s.id !== id);
    set({ snippets: updated });
    persistSnippets(updated);
  },

  getSnippets: () => get().snippets,
}));
