import {
  splitQuery,
  mysqlSplitterOptions,
  postgreSplitterOptions,
  sqliteSplitterOptions,
  type SplitterOptions,
} from 'dbgate-query-splitter';

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
