/// <reference lib="webworker" />

import { fuzzyScore, scoreDotAware } from '../lib/fuzzy-scorer';
import type { ScoreResult } from '../lib/fuzzy-scorer';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SearchContext =
  | 'select' | 'from' | 'condition' | 'order_group'
  | 'set' | 'ddl' | 'after_table' | 'general' | 'sidebar';

export interface ScoredItem {
  name: string;
  type: 'table' | 'column';
  table?: string;
  database?: string;
  columnType?: string;
  score: number;
  matches: [number, number][];
}

// ---------------------------------------------------------------------------
// Inbound message types
// ---------------------------------------------------------------------------

interface SyncSchemaMessage {
  type: 'sync-schema';
  tables: { name: string; database: string }[];
  columns: { name: string; table: string; type: string }[];
}

interface SearchMessage {
  type: 'search';
  id: number;
  input: string;
  context: SearchContext;
  limit: number;
  resolvedTable?: string;
}

interface CancelMessage {
  type: 'cancel';
  id: number;
}

type InboundMessage = SyncSchemaMessage | SearchMessage | CancelMessage;

// ---------------------------------------------------------------------------
// Internal index types
// ---------------------------------------------------------------------------

interface IndexedTable {
  name: string;
  database: string;
  nameLower: string;
}

interface IndexedColumn {
  name: string;
  table: string;
  type: string;
  nameLower: string;
  tableLower: string;
  fullNameLower: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let tables: IndexedTable[] = [];
let columns: IndexedColumn[] = [];
const cancelledIds = new Set<number>();

const CANCEL_CHECK_INTERVAL = 100;
const CANCEL_SET_CLEANUP_THRESHOLD = 200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isCancelled(id: number): boolean {
  return cancelledIds.has(id);
}

function cleanupCancelledIds(): void {
  if (cancelledIds.size > CANCEL_SET_CLEANUP_THRESHOLD) {
    cancelledIds.clear();
  }
}

function tablesOnly(context: SearchContext): boolean {
  return context === 'from' || context === 'ddl';
}

function columnsOfTableOnly(context: SearchContext): boolean {
  return context === 'after_table';
}

function toMatchesTuple(matches: readonly (readonly [number, number])[]): [number, number][] {
  return matches.map(([s, e]) => [s, e] as [number, number]);
}

// ---------------------------------------------------------------------------
// Index building
// ---------------------------------------------------------------------------

function buildIndex(msg: SyncSchemaMessage): void {
  tables = msg.tables.map((t) => ({
    name: t.name,
    database: t.database,
    nameLower: t.name.toLowerCase(),
  }));

  columns = msg.columns.map((c) => ({
    name: c.name,
    table: c.table,
    type: c.type,
    nameLower: c.name.toLowerCase(),
    tableLower: c.table.toLowerCase(),
    fullNameLower: c.table.toLowerCase() + '.' + c.name.toLowerCase(),
  }));
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreTables(
  input: string,
  id: number,
): ScoredItem[] {
  const results: ScoredItem[] = [];

  for (let i = 0; i < tables.length; i++) {
    if (i % CANCEL_CHECK_INTERVAL === 0 && isCancelled(id)) {
      return [];
    }

    const t = tables[i];
    const result: ScoreResult = fuzzyScore(input, t.name);

    if (result.score > 0) {
      results.push({
        name: t.name,
        type: 'table',
        database: t.database,
        score: result.score,
        matches: toMatchesTuple(result.matches),
      });
    }
  }

  return results;
}

function scoreColumns(
  input: string,
  id: number,
  resolvedTable?: string,
): ScoredItem[] {
  const results: ScoredItem[] = [];
  const hasDot = input.includes('.');

  const filteredColumns = resolvedTable
    ? columns.filter((c) => c.tableLower === resolvedTable.toLowerCase())
    : columns;

  for (let i = 0; i < filteredColumns.length; i++) {
    if (i % CANCEL_CHECK_INTERVAL === 0 && isCancelled(id)) {
      return [];
    }

    const c = filteredColumns[i];
    let result: ScoreResult;

    if (hasDot) {
      result = scoreDotAware(input, c.table, c.name);
    } else if (resolvedTable) {
      // After table context: score against column name only
      result = fuzzyScore(input, c.name);
    } else {
      // No dot, no resolved table: score against "table.column"
      result = fuzzyScore(input, c.table + '.' + c.name);
    }

    if (result.score > 0) {
      results.push({
        name: c.name,
        type: 'column',
        table: c.table,
        columnType: c.type,
        score: result.score,
        matches: toMatchesTuple(result.matches),
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Search orchestration
// ---------------------------------------------------------------------------

function search(msg: SearchMessage): void {
  const { id, input, context, limit, resolvedTable } = msg;

  if (isCancelled(id)) return;

  if (input.length === 0) {
    self.postMessage({ type: 'results', id, items: [] });
    return;
  }

  let items: ScoredItem[] = [];

  if (columnsOfTableOnly(context)) {
    // after_table: only columns of the resolved table
    items = scoreColumns(input, id, resolvedTable);
  } else if (tablesOnly(context)) {
    // from, ddl: tables only
    items = scoreTables(input, id);
  } else {
    // All other contexts: tables + columns
    const tableResults = scoreTables(input, id);
    if (isCancelled(id)) return;

    const columnResults = scoreColumns(input, id);
    if (isCancelled(id)) return;

    items = [...tableResults, ...columnResults];
  }

  if (isCancelled(id)) return;

  // Sort: score descending, then name length ascending for ties
  items.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.length - b.name.length;
  });

  // Apply limit
  const effectiveLimit = limit > 0 ? limit : 50;
  const trimmed = items.slice(0, effectiveLimit);

  self.postMessage({ type: 'results', id, items: trimmed });
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = (e: MessageEvent<InboundMessage>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'sync-schema': {
      buildIndex(msg);
      self.postMessage({ type: 'ready' });
      break;
    }

    case 'search': {
      search(msg);
      cleanupCancelledIds();
      break;
    }

    case 'cancel': {
      cancelledIds.add(msg.id);
      break;
    }
  }
};
