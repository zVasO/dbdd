/**
 * Carry localStorage over from before the rename to Spool, when every key was
 * prefixed `vasodb:`. Imported first in main.tsx: the stores read their keys
 * while their modules evaluate, so this has to run before any of them.
 */
export const LEGACY_PREFIX = 'vasodb:';
export const PREFIX = 'spool:';

export function migrateLegacyStorage(storage: Storage): number {
  const legacyKeys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(LEGACY_PREFIX)) legacyKeys.push(key);
  }
  let moved = 0;
  for (const key of legacyKeys) {
    const value = storage.getItem(key);
    const next = PREFIX + key.slice(LEGACY_PREFIX.length);
    // A value already written under the new name is newer: never overwrite it.
    if (value !== null && storage.getItem(next) === null) {
      storage.setItem(next, value);
      moved++;
    }
    storage.removeItem(key);
  }
  return moved;
}

try {
  migrateLegacyStorage(window.localStorage);
} catch {
  // Storage unavailable or full: the app starts with defaults.
}
