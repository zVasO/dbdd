const STORAGE_KEY = 'dataforge:session:v2';
const LEGACY_KEY = 'dataforge:session';

interface SavedTab {
  id: string;
  connectionId: string | null;
  title: string;
  sql: string;
  editorVisible: boolean;
  database?: string;
  table?: string;
}

interface SavedSession {
  tabs: SavedTab[];
  /** Active tab id per connection */
  activeTabIds: Record<string, string>;
}

export function saveSession(
  tabs: Array<{ id: string; connectionId: string | null; title: string; sql: string; editorVisible: boolean; database?: string; table?: string }>,
  activeTabIds: Record<string, string>,
): void {
  const session: SavedSession = {
    tabs: tabs.map(({ id, connectionId, title, sql, editorVisible, database, table }) => ({
      id, connectionId, title, sql, editorVisible, database, table,
    })),
    activeTabIds,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function loadSession(): SavedSession | null {
  try {
    // Try v2 format first
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SavedSession;
      if (Array.isArray(parsed.tabs)) return parsed;
    }

    // Migrate from legacy format
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed.tabs)) {
        const migrated: SavedSession = {
          tabs: parsed.tabs.map((t: Record<string, unknown>) => ({
            ...t,
            connectionId: parsed.connectionId ?? null,
          })),
          activeTabIds: parsed.connectionId && parsed.activeTabId
            ? { [parsed.connectionId]: parsed.activeTabId }
            : {},
        };
        // Save migrated version and clean up legacy
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        localStorage.removeItem(LEGACY_KEY);
        return migrated;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_KEY);
}
