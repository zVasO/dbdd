import { describe, bench } from 'vitest';
import { fuzzyScore, scoreDotAware } from '../fuzzy-scorer';

// Generate realistic Dolibarr-style test data
function generateTables(count: number): string[] {
  const prefixes = ['llx_', 'app_', 'sys_', 'tmp_', 'log_'];
  const names = [
    'dossier', 'user', 'product', 'order', 'invoice', 'payment',
    'category', 'tag', 'comment', 'session', 'config', 'migration',
    'notification', 'template', 'workflow', 'permission', 'role',
    'audit', 'cache', 'queue',
  ];
  const suffixes = ['', '_det', '_line', '_extra', '_hist', '_log', '_ref', '_link', '_meta', '_isolation'];
  const result: string[] = [];
  let idx = 0;
  while (result.length < count) {
    const prefix = prefixes[idx % prefixes.length];
    const name = names[idx % names.length];
    const suffix = suffixes[Math.floor(idx / names.length) % suffixes.length];
    result.push(`${prefix}${name}${suffix}`);
    idx++;
  }
  return result;
}

function generateColumns(tables: string[], colsPerTable: number): { table: string; col: string }[] {
  const colNames = [
    'rowid', 'name', 'label', 'description', 'status', 'created_at',
    'updated_at', 'deleted_at', 'fk_user', 'fk_parent', 'amount', 'qty',
    'price', 'total', 'ref', 'code', 'type', 'active', 'note', 'entity',
  ];
  const result: { table: string; col: string }[] = [];
  for (const table of tables) {
    for (let i = 0; i < colsPerTable; i++) {
      result.push({ table, col: colNames[i % colNames.length] });
    }
  }
  return result;
}

const tables500 = generateTables(500);
const columns10k = generateColumns(tables500, 20);
const fullNames10k = columns10k.map((c) => `${c.table}.${c.col}`);

describe('fuzzyScore performance — 500 tables', () => {
  bench('prefix match (llx_dossier)', () => {
    for (const t of tables500) {
      fuzzyScore('llx_dossier', t);
    }
  });

  bench('substring match (dossier)', () => {
    for (const t of tables500) {
      fuzzyScore('dossier', t);
    }
  });

  bench('fuzzy match with typo (dosiser)', () => {
    for (const t of tables500) {
      fuzzyScore('dosiser', t);
    }
  });

  bench('short input (dos)', () => {
    for (const t of tables500) {
      fuzzyScore('dos', t);
    }
  });
});

describe('fuzzyScore performance — 10K columns (table.column)', () => {
  bench('substring match (dossier) against 10K', () => {
    for (const name of fullNames10k) {
      fuzzyScore('dossier', name);
    }
  });

  bench('fuzzy match (dosiser) against 10K', () => {
    for (const name of fullNames10k) {
      fuzzyScore('dosiser', name);
    }
  });
});

describe('scoreDotAware performance — 10K columns', () => {
  bench('dot-aware (dossier.name)', () => {
    for (const c of columns10k) {
      scoreDotAware('dossier.name', c.table, c.col);
    }
  });

  bench('dot-aware (dossieriso.row)', () => {
    for (const c of columns10k) {
      scoreDotAware('dossieriso.row', c.table, c.col);
    }
  });
});

describe('combined search simulation — 500 tables + 10K columns', () => {
  bench('full search: score all tables + columns for "llx_dossier"', () => {
    for (const t of tables500) {
      fuzzyScore('llx_dossier', t);
    }
    for (const name of fullNames10k) {
      fuzzyScore('llx_dossier', name);
    }
  });

  bench('full search: score all tables + columns for "dosiser" (typo)', () => {
    for (const t of tables500) {
      fuzzyScore('dosiser', t);
    }
    for (const name of fullNames10k) {
      fuzzyScore('dosiser', name);
    }
  });
});
