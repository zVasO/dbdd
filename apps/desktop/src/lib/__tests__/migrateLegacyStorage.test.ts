import { describe, it, expect, beforeEach } from 'vitest';
import { migrateLegacyStorage } from '../migrateLegacyStorage';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    clear: () => data.clear(),
  };
}

describe('migrateLegacyStorage', () => {
  let storage: Storage;
  beforeEach(() => { storage = memoryStorage(); });

  it('moves every vasodb: key to spool:', () => {
    storage.setItem('vasodb:themes', '[1]');
    storage.setItem('vasodb:query-versions:abc', '{"v":2}');
    expect(migrateLegacyStorage(storage)).toBe(2);
    expect(storage.getItem('spool:themes')).toBe('[1]');
    expect(storage.getItem('spool:query-versions:abc')).toBe('{"v":2}');
    expect(storage.getItem('vasodb:themes')).toBeNull();
  });

  it('keeps a value already saved under the new name', () => {
    storage.setItem('vasodb:active-theme', 'dracula');
    storage.setItem('spool:active-theme', 'loom');
    migrateLegacyStorage(storage);
    expect(storage.getItem('spool:active-theme')).toBe('loom');
    expect(storage.getItem('vasodb:active-theme')).toBeNull();
  });

  it('leaves unrelated keys alone and is a no-op the second time', () => {
    storage.setItem('other', 'x');
    storage.setItem('vasodb:notes', 'n');
    migrateLegacyStorage(storage);
    expect(migrateLegacyStorage(storage)).toBe(0);
    expect(storage.getItem('other')).toBe('x');
    expect(storage.getItem('spool:notes')).toBe('n');
  });
});
