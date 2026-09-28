import { describe, it, expect } from 'vitest';
import { splitStatements, statementAt, resolveSqlToRun } from '../sql-utils';

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

describe('statementAt', () => {
  const script = 'SELECT 1;\nSELECT 2;\n\nSELECT 3;\n';
  const at = (needle: string) => script.indexOf(needle);

  it('picks the statement containing the cursor', () => {
    expect(statementAt(script, at('SELECT 1') + 3, 'mysql')).toBe('SELECT 1');
    expect(statementAt(script, at('SELECT 2') + 3, 'mysql')).toBe('SELECT 2');
    expect(statementAt(script, at('SELECT 3') + 3, 'mysql')).toBe('SELECT 3');
  });

  it('picks the statement at its very first character', () => {
    expect(statementAt(script, at('SELECT 2'), 'mysql')).toBe('SELECT 2');
  });

  it('keeps a cursor right after the semicolon on the closed statement', () => {
    expect(statementAt(script, at('SELECT 2;') + 'SELECT 2;'.length, 'mysql')).toBe('SELECT 2');
  });

  it('attributes a blank line between statements to the previous one', () => {
    expect(statementAt(script, at('\n\nSELECT 3') + 1, 'mysql')).toBe('SELECT 2');
  });

  it('picks the last statement when the cursor is at the end of the script', () => {
    expect(statementAt(script, script.length, 'mysql')).toBe('SELECT 3');
  });

  it('picks the first statement when the cursor precedes it', () => {
    expect(statementAt('\n\n  SELECT 1; SELECT 2', 0, 'postgres')).toBe('SELECT 1');
  });

  it('ignores a semicolon inside a string literal', () => {
    const sql = "SELECT 'a;b';\nSELECT 2";
    expect(statementAt(sql, 10, 'mysql')).toBe("SELECT 'a;b'");
    expect(statementAt(sql, sql.length, 'mysql')).toBe('SELECT 2');
  });

  it('keeps a Postgres dollar-quoted block whole', () => {
    const block = 'DO $$ BEGIN PERFORM 1; PERFORM 2; END $$';
    const sql = `SELECT 1;\n${block};\nSELECT 3`;
    expect(statementAt(sql, sql.indexOf('PERFORM 2'), 'postgres')).toBe(block);
  });

  it('returns null for an empty script', () => {
    expect(statementAt('   \n', 0, 'mysql')).toBeNull();
  });
});

describe('resolveSqlToRun', () => {
  const script = 'SELECT 1;\nSELECT 2;';

  it('runs the selection when there is one', () => {
    expect(resolveSqlToRun(script, 0, 6, 'mysql')).toBe('SELECT');
  });

  it('accepts a backwards selection', () => {
    expect(resolveSqlToRun(script, script.length, script.indexOf('SELECT 2'), 'mysql')).toBe('SELECT 2;');
  });

  it('falls back to the statement under the cursor without a selection', () => {
    const pos = script.indexOf('SELECT 2') + 2;
    expect(resolveSqlToRun(script, pos, pos, 'mysql')).toBe('SELECT 2');
  });

  it('falls back to the cursor statement when the selection is whitespace only', () => {
    expect(resolveSqlToRun(script, 9, 10, 'mysql')).toBe('SELECT 1');
  });
});
