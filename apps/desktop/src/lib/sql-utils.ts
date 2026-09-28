import {
  splitQuery,
  mysqlSplitterOptions,
  postgreSplitterOptions,
  sqliteSplitterOptions,
  type SplitterOptions,
} from 'dbgate-query-splitter';

// The package's index does not re-export its result types
type SplitResultItem = ReturnType<typeof splitQuery>[number];
type SplitResultItemRich = Exclude<SplitResultItem, string>;

function splitterOptionsFor(dbType: string): SplitterOptions {
  switch (dbType) {
    case 'postgres':
      return postgreSplitterOptions;
    case 'sqlite':
      return sqliteSplitterOptions;
    default:
      return mysqlSplitterOptions;
  }
}

/**
 * Split a SQL script into individual statements, honoring the dialect's
 * string, comment and dollar-quote rules — a naive `;` split corrupts
 * literals ('a;b'), comments and Postgres dollar-quoted blocks (DO $$ ... $$).
 */
export function splitStatements(sql: string, dbType: string): string[] {
  return splitQuery(sql, splitterOptionsFor(dbType))
    .map((s) => (typeof s === 'string' ? s : s.text).trim())
    .filter((s) => s.length > 0);
}

/**
 * Return the statement the cursor at `offset` belongs to. The gap after a
 * statement (its `;`, trailing whitespace, blank lines) belongs to that
 * statement, so a cursor parked right after `;` runs the query it closes.
 * A cursor before the first statement picks the first one.
 */
export function statementAt(sql: string, offset: number, dbType: string): string | null {
  const items = splitQuery(sql, { ...splitterOptionsFor(dbType), returnRichInfo: true })
    .filter((s): s is SplitResultItemRich => typeof s !== 'string')
    .filter((s) => s.text.trim().length > 0);
  if (items.length === 0) return null;
  let match = items[0];
  for (const item of items) {
    if ((item.trimStart ?? item.start).position <= offset) match = item;
    else break;
  }
  return match.text.trim();
}

/**
 * Resolve what "run" should execute: the selection when there is one,
 * otherwise the statement under the cursor.
 */
export function resolveSqlToRun(sql: string, from: number, to: number, dbType: string): string | null {
  if (from !== to) {
    const selected = sql.slice(Math.min(from, to), Math.max(from, to)).trim();
    if (selected.length > 0) return selected;
  }
  return statementAt(sql, Math.min(from, to), dbType);
}

/**
 * Quote a SQL identifier (table/column name) according to the database dialect.
 * MySQL/SQLite use backticks, PostgreSQL uses double quotes.
 */
export function quoteIdentifier(name: string, dbType: string): string {
  if (dbType === 'postgres') {
    return `"${name.replace(/"/g, '""')}"`;
  }
  // MySQL and SQLite use backticks
  return `\`${name.replace(/`/g, '``')}\``;
}

/**
 * Escape a string value for use in SQL literals.
 * This is a safety fallback — prefer parameterized queries.
 */
export function escapeStringLiteral(value: string): string {
  return value.replace(/'/g, "''").replace(/\\/g, '\\\\');
}
