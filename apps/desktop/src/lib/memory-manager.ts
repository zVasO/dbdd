import type { ColumnData } from './types';

const SOFT_CAP_BYTES = 500 * 1024 * 1024; // 500MB
const MIN_KEPT_TABS = 3;

export function estimateTabMemory(data: ColumnData[]): number {
  let bytes = 0;
  for (const col of data) {
    switch (col.kind) {
      case 'Integers':
      case 'Floats':
        bytes += col.values.length * 9; // 8 bytes + 1 null flag
        break;
      case 'Booleans':
        bytes += col.values.length * 2;
        break;
      case 'Strings':
        for (const v of col.values) {
          bytes += v != null ? (v as string).length * 2 + 1 : 1;
        }
        break;
      case 'Json':
        for (const v of col.values) {
          bytes += v != null ? JSON.stringify(v).length * 2 + 1 : 1;
        }
        break;
    }
  }
  return bytes;
}

export interface TabMemoryEntry {
  tabId: string;
  bytes: number;
  lastAccessed: number; // Date.now()
  pinned: boolean;
}

export function selectEvictionCandidates(
  entries: TabMemoryEntry[],
  activeTabId: string | null,
  adjacentTabIds: string[],
): string[] {
  const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  if (totalBytes <= SOFT_CAP_BYTES) return [];

  const pinned = new Set(
    [activeTabId, ...adjacentTabIds].filter((id): id is string => id != null),
  );
  const candidates = entries
    .filter((e) => !pinned.has(e.tabId) && !e.pinned)
    .sort((a, b) => a.lastAccessed - b.lastAccessed);

  const toEvict: string[] = [];
  let currentTotal = totalBytes;
  const keptCount = entries.length - candidates.length;

  for (const candidate of candidates) {
    if (currentTotal <= SOFT_CAP_BYTES) break;
    if (keptCount + (candidates.length - toEvict.length) <= MIN_KEPT_TABS) break;
    toEvict.push(candidate.tabId);
    currentTotal -= candidate.bytes;
  }

  return toEvict;
}
