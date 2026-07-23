import { describe, it, expect } from 'vitest';
import { splitStatements } from '../sql-utils';

describe('splitStatements', () => {
  it('keeps a semicolon inside a string literal', () => {
    expect(splitStatements("UPDATE t SET bio = 'a;b' WHERE id = 1", 'mysql')).toEqual([
      "UPDATE t SET bio = 'a;b' WHERE id = 1",
    ]);
  });

  it('does not split on a semicolon inside a line comment', () => {
    expect(splitStatements('SELECT 1 -- note; more', 'postgres')).toEqual([
      'SELECT 1 -- note; more',
    ]);
  });

  it('keeps a Postgres dollar-quoted block as one statement', () => {
    const sql = 'DO $$ BEGIN PERFORM 1; PERFORM 2; END $$';
    expect(splitStatements(sql, 'postgres')).toEqual([sql]);
  });

  it('splits genuine multiple statements', () => {
    expect(splitStatements('SELECT 1; SELECT 2', 'postgres')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('drops empty trailing statements', () => {
    expect(splitStatements('SELECT 1;', 'sqlite')).toEqual(['SELECT 1']);
  });

  it('returns a single statement unchanged', () => {
    expect(splitStatements('SELECT * FROM users', 'mysql')).toEqual(['SELECT * FROM users']);
  });
});
