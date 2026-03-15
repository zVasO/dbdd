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
