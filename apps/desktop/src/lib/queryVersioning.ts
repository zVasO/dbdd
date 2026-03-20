export interface QueryVersion {
  id: string;
  sql: string;
  timestamp: number;
  rowCount: number | null;
}

const MAX_VERSIONS_PER_TAB = 50;
const STORAGE_PREFIX = 'vasodb:query-versions:';

function getStorageKey(tabId: string): string {
  return `${STORAGE_PREFIX}${tabId}`;
}

export function saveVersion(
  tabId: string,
  sql: string,
  rowCount: number | null,
): QueryVersion {
  const version: QueryVersion = {
    id: crypto.randomUUID(),
    sql,
    timestamp: Date.now(),
    rowCount,
  };

  const existing = getVersions(tabId);
  const updated = [version, ...existing].slice(0, MAX_VERSIONS_PER_TAB);

  try {
    localStorage.setItem(getStorageKey(tabId), JSON.stringify(updated));
  } catch {
    // localStorage might be full; drop oldest entries and retry
    const trimmed = updated.slice(0, Math.floor(MAX_VERSIONS_PER_TAB / 2));
    localStorage.setItem(getStorageKey(tabId), JSON.stringify(trimmed));
  }

  return version;
}

export function getVersions(tabId: string): QueryVersion[] {
  try {
    const raw = localStorage.getItem(getStorageKey(tabId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueryVersion[];
    return parsed.sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}

export function deleteVersions(tabId: string): void {
  localStorage.removeItem(getStorageKey(tabId));
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`;
  if (diffDay < 30) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;

  return new Date(timestamp).toLocaleDateString();
}
