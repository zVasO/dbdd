import { describe, it, expect } from 'vitest';
import { qualifiedTable } from '../importExportStore';

describe('import target qualification', () => {
  it('qualifies with the selected database on MySQL', () => {
    expect(qualifiedTable('people', 'shop', 'mysql')).toBe('`shop`.`people`');
  });

  it('leaves Postgres and SQLite targets unqualified', () => {
    expect(qualifiedTable('people', 'shop', 'postgres')).toBe('"people"');
    expect(qualifiedTable('people', 'shop', 'sqlite')).toBe('`people`');
  });

  it('falls back to the connection default when no database is selected', () => {
    expect(qualifiedTable('people', '', 'mysql')).toBe('`people`');
  });

  it('doubles embedded quote characters in both parts', () => {
    expect(qualifiedTable('we`ird', 'da`ta', 'mysql')).toBe('`da``ta`.`we``ird`');
    expect(qualifiedTable('we"ird', '', 'postgres')).toBe('"we""ird"');
  });
});
