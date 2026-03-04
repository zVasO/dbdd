const STORAGE_KEY = 'dataforge:session';

interface SavedTab {
  id: string;
  title: string;
  sql: string;
  editorVisible: boolean;
  database?: string;
  table?: string;
}

interface SavedSession {
  tabs: SavedTab[];
  activeTabId: string | null;
  connectionId: string | null;
}

export function saveSession(
  tabs: Array<{ id: string; title: string; sql: string; editorVisible: boolean; database?: string; table?: string }>,
  activeTabId: string | null,
  connectionId: string | null,
): void {
  const session: SavedSession = {
    tabs: tabs.map(({ id, title, sql, editorVisible, database, table }) => ({
      id, title, sql, editorVisible, database, table,
    })),
    activeTabId,
    connectionId,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedSession;
    if (!Array.isArray(parsed.tabs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}
