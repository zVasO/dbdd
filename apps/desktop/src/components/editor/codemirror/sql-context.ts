// SQL context detection and static SQL data
// Standalone module with zero Monaco dependency

// SQL keywords (single words only — no multi-word to avoid cursor issues)
export const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE',
  'CREATE', 'ALTER', 'DROP', 'JOIN', 'LEFT', 'RIGHT', 'INNER',
  'OUTER', 'ON', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
  'GROUP', 'ORDER', 'BY', 'HAVING', 'LIMIT', 'OFFSET', 'AS',
  'DISTINCT', 'NULL', 'IS', 'SET', 'VALUES', 'INTO', 'TABLE',
  'INDEX', 'VIEW', 'DATABASE', 'SCHEMA', 'PRIMARY', 'FOREIGN',
  'KEY', 'REFERENCES', 'CASCADE', 'UNION', 'ALL',
  'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC',
  'DESC', 'TRUNCATE', 'GRANT', 'REVOKE', 'COMMIT', 'ROLLBACK',
  'BEGIN', 'TRANSACTION', 'CROSS', 'FULL', 'NATURAL', 'USING',
  'WITH', 'RECURSIVE', 'RETURNING', 'CONFLICT', 'DO', 'NOTHING',
  'OVER', 'PARTITION', 'WINDOW', 'ROWS', 'RANGE', 'UNBOUNDED',
  'PRECEDING', 'FOLLOWING', 'FETCH', 'NEXT', 'ONLY',
  'TRUE', 'FALSE', 'DEFAULT', 'CHECK', 'UNIQUE', 'CONSTRAINT',
  'IF', 'REPLACE', 'TEMPORARY', 'TEMP', 'EXPLAIN', 'ANALYZE',
  'VACUUM', 'REINDEX',
  'SHOW', 'DESCRIBE', 'USE', 'MODIFY', 'ADD', 'COLUMN', 'RENAME',
  'INTERVAL', 'ANY', 'SOME', 'ESCAPE', 'EXCEPT', 'INTERSECT',
  'LATERAL', 'GROUPING', 'CUBE', 'ROLLUP', 'LOCK', 'UNLOCK',
  'FORCE', 'IGNORE', 'STRAIGHT_JOIN', 'DUPLICATE',
];

// Common SQL functions
export const SQL_FUNCTIONS: { label: string; detail: string; insertText: string }[] = [
  // Aggregate
  { label: 'COUNT', detail: 'Aggregate: count rows', insertText: 'COUNT(${1:*})' },
  { label: 'SUM', detail: 'Aggregate: sum values', insertText: 'SUM(${1:column})' },
  { label: 'AVG', detail: 'Aggregate: average value', insertText: 'AVG(${1:column})' },
  { label: 'MIN', detail: 'Aggregate: minimum value', insertText: 'MIN(${1:column})' },
  { label: 'MAX', detail: 'Aggregate: maximum value', insertText: 'MAX(${1:column})' },
  { label: 'STRING_AGG', detail: 'Aggregate: concatenate strings', insertText: "STRING_AGG(${1:column}, '${2:,}')" },
  { label: 'GROUP_CONCAT', detail: 'Aggregate: concatenate (MySQL)', insertText: 'GROUP_CONCAT(${1:column})' },
  // String
  { label: 'CONCAT', detail: 'String: concatenate', insertText: 'CONCAT(${1:a}, ${2:b})' },
  { label: 'SUBSTRING', detail: 'String: extract substring', insertText: 'SUBSTRING(${1:str}, ${2:start}, ${3:length})' },
  { label: 'TRIM', detail: 'String: trim whitespace', insertText: 'TRIM(${1:column})' },
  { label: 'UPPER', detail: 'String: to uppercase', insertText: 'UPPER(${1:column})' },
  { label: 'LOWER', detail: 'String: to lowercase', insertText: 'LOWER(${1:column})' },
  { label: 'LENGTH', detail: 'String: character count', insertText: 'LENGTH(${1:column})' },
  { label: 'REPLACE', detail: 'String: replace substring', insertText: "REPLACE(${1:column}, '${2:old}', '${3:new}')" },
  { label: 'COALESCE', detail: 'Return first non-null', insertText: 'COALESCE(${1:a}, ${2:b})' },
  { label: 'NULLIF', detail: 'Return null if equal', insertText: 'NULLIF(${1:a}, ${2:b})' },
  { label: 'CAST', detail: 'Type cast', insertText: 'CAST(${1:expr} AS ${2:type})' },
  // Date/time
  { label: 'NOW', detail: 'Date: current timestamp', insertText: 'NOW()' },
  { label: 'CURRENT_DATE', detail: 'Date: current date', insertText: 'CURRENT_DATE' },
  { label: 'CURRENT_TIMESTAMP', detail: 'Date: current timestamp', insertText: 'CURRENT_TIMESTAMP' },
  { label: 'EXTRACT', detail: 'Date: extract part', insertText: 'EXTRACT(${1:YEAR} FROM ${2:column})' },
  { label: 'DATE_TRUNC', detail: 'Date: truncate to precision', insertText: "DATE_TRUNC('${1:day}', ${2:column})" },
  // Numeric
  { label: 'ABS', detail: 'Math: absolute value', insertText: 'ABS(${1:n})' },
  { label: 'CEIL', detail: 'Math: round up', insertText: 'CEIL(${1:n})' },
  { label: 'FLOOR', detail: 'Math: round down', insertText: 'FLOOR(${1:n})' },
  { label: 'ROUND', detail: 'Math: round', insertText: 'ROUND(${1:n}, ${2:2})' },
  { label: 'SQRT', detail: 'Math: square root', insertText: 'SQRT(${1:n})' },
  // Window
  { label: 'ROW_NUMBER', detail: 'Window: row number', insertText: 'ROW_NUMBER() OVER (${1:ORDER BY id})' },
  { label: 'RANK', detail: 'Window: rank', insertText: 'RANK() OVER (${1:ORDER BY id})' },
  { label: 'DENSE_RANK', detail: 'Window: dense rank', insertText: 'DENSE_RANK() OVER (${1:ORDER BY id})' },
  { label: 'LAG', detail: 'Window: previous row', insertText: 'LAG(${1:column}) OVER (${2:ORDER BY id})' },
  { label: 'LEAD', detail: 'Window: next row', insertText: 'LEAD(${1:column}) OVER (${2:ORDER BY id})' },
  // Conditional
  { label: 'IFNULL', detail: 'Return alternative if null', insertText: 'IFNULL(${1:column}, ${2:default})' },
  { label: 'IF', detail: 'Conditional: if/then/else (MySQL)', insertText: 'IF(${1:condition}, ${2:true_val}, ${3:false_val})' },
  // String (additional)
  { label: 'LEFT', detail: 'String: leftmost characters', insertText: 'LEFT(${1:str}, ${2:len})' },
  { label: 'RIGHT', detail: 'String: rightmost characters', insertText: 'RIGHT(${1:str}, ${2:len})' },
  { label: 'LPAD', detail: 'String: pad left', insertText: "LPAD(${1:str}, ${2:len}, '${3: }')" },
  { label: 'RPAD', detail: 'String: pad right', insertText: "RPAD(${1:str}, ${2:len}, '${3: }')" },
  { label: 'REVERSE', detail: 'String: reverse', insertText: 'REVERSE(${1:str})' },
  { label: 'CHAR_LENGTH', detail: 'String: character length', insertText: 'CHAR_LENGTH(${1:str})' },
  { label: 'POSITION', detail: 'String: find position', insertText: 'POSITION(${1:substr} IN ${2:str})' },
  // Date (additional)
  { label: 'DATE_FORMAT', detail: 'Date: format (MySQL)', insertText: "DATE_FORMAT(${1:date}, '${2:%Y-%m-%d}')" },
  { label: 'DATEDIFF', detail: 'Date: difference in days', insertText: 'DATEDIFF(${1:date1}, ${2:date2})' },
  { label: 'DATE_ADD', detail: 'Date: add interval (MySQL)', insertText: 'DATE_ADD(${1:date}, INTERVAL ${2:1} ${3:DAY})' },
  { label: 'DATE_SUB', detail: 'Date: subtract interval (MySQL)', insertText: 'DATE_SUB(${1:date}, INTERVAL ${2:1} ${3:DAY})' },
  { label: 'YEAR', detail: 'Date: extract year', insertText: 'YEAR(${1:date})' },
  { label: 'MONTH', detail: 'Date: extract month', insertText: 'MONTH(${1:date})' },
  { label: 'DAY', detail: 'Date: extract day', insertText: 'DAY(${1:date})' },
  // JSON
  { label: 'JSON_EXTRACT', detail: 'JSON: extract value', insertText: "JSON_EXTRACT(${1:column}, '${2:\\$.key}')" },
  { label: 'JSON_OBJECT', detail: 'JSON: create object', insertText: "JSON_OBJECT('${1:key}', ${2:value})" },
  { label: 'JSON_ARRAY', detail: 'JSON: create array', insertText: 'JSON_ARRAY(${1:values})' },
  { label: 'JSON_ARRAYAGG', detail: 'JSON: aggregate into array', insertText: 'JSON_ARRAYAGG(${1:column})' },
  // Window (additional)
  { label: 'NTILE', detail: 'Window: distribute into buckets', insertText: 'NTILE(${1:4}) OVER (${2:ORDER BY id})' },
  { label: 'FIRST_VALUE', detail: 'Window: first value in frame', insertText: 'FIRST_VALUE(${1:column}) OVER (${2:ORDER BY id})' },
  { label: 'LAST_VALUE', detail: 'Window: last value in frame', insertText: 'LAST_VALUE(${1:column}) OVER (${2:ORDER BY id})' },
  { label: 'NTH_VALUE', detail: 'Window: nth value in frame', insertText: 'NTH_VALUE(${1:column}, ${2:n}) OVER (${3:ORDER BY id})' },
  // Misc
  { label: 'GREATEST', detail: 'Return greatest value', insertText: 'GREATEST(${1:a}, ${2:b})' },
  { label: 'LEAST', detail: 'Return smallest value', insertText: 'LEAST(${1:a}, ${2:b})' },
  { label: 'ISNULL', detail: 'Check if null (MySQL)', insertText: 'ISNULL(${1:column})' },
  { label: 'CONVERT', detail: 'Convert type (MySQL)', insertText: 'CONVERT(${1:expr}, ${2:type})' },
];

// Data type suggestions
export const SQL_TYPES = [
  'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT',
  'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE', 'REAL',
  'VARCHAR', 'CHAR', 'TEXT', 'NVARCHAR',
  'DATE', 'TIME', 'TIMESTAMP', 'DATETIME',
  'BOOLEAN', 'BOOL',
  'BLOB', 'BYTEA', 'BINARY',
  'JSON', 'JSONB', 'XML',
  'UUID', 'SERIAL', 'BIGSERIAL',
];

export const KEYWORD_SET = new Set([
  ...SQL_KEYWORDS,
  'ON', 'WHERE', 'AND', 'OR', 'SET',
]);

// --- SQL context detection & parsing helpers ---

export type SqlContext =
  | 'select' | 'from' | 'condition' | 'order_group'
  | 'set' | 'ddl' | 'after_table' | 'general';

export function parseAliases(sql: string): Record<string, string> {
  const aliases: Record<string, string> = {};
  const pattern = /(?:FROM|JOIN)\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi;
  let match;
  while ((match = pattern.exec(sql)) !== null) {
    const table = match[1];
    const alias = match[2];
    if (alias && !KEYWORD_SET.has(alias.toUpperCase())) {
      aliases[alias.toLowerCase()] = table.toLowerCase();
    }
  }
  return aliases;
}

export function parseTablePrefixes(sql: string): Record<string, string> {
  const refs: Record<string, string> = {};
  const pattern = /(?:FROM|JOIN)\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi;
  let match;
  while ((match = pattern.exec(sql)) !== null) {
    const table = match[1];
    const alias = match[2];
    if (alias && !KEYWORD_SET.has(alias.toUpperCase())) {
      refs[table.toLowerCase()] = alias;
    } else {
      refs[table.toLowerCase()] = table;
    }
  }
  return refs;
}

export function detectSqlContext(textBeforeCursor: string): SqlContext {
  const cleaned = textBeforeCursor
    .replace(/'[^']*'/g, "''")
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trimEnd();
  const upper = cleaned.toUpperCase();

  // Directly after a keyword (keyword is the last token)
  if (/\b(?:SELECT|SELECT\s+DISTINCT)\s*$/i.test(cleaned)) return 'select';
  if (/\b(?:FROM|JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|INNER\s+JOIN|CROSS\s+JOIN|FULL\s+(?:OUTER\s+)?JOIN|NATURAL\s+JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s*$/i.test(cleaned)) return 'from';
  if (/\b(?:WHERE|AND|OR|HAVING|ON|NOT)\s*$/i.test(cleaned)) return 'condition';
  if (/\b(?:ORDER\s+BY|GROUP\s+BY)\s*$/i.test(cleaned)) return 'order_group';
  if (/\bSET\s*$/i.test(cleaned)) return 'set';
  if (/\b(?:CREATE|ALTER|DROP)\s*$/i.test(cleaned)) return 'ddl';

  // After comma → determine which clause we're continuing
  if (cleaned.endsWith(',')) {
    const selectIdx = upper.lastIndexOf('SELECT');
    const fromIdx = upper.lastIndexOf(' FROM');
    const orderIdx = Math.max(upper.lastIndexOf('ORDER BY'), upper.lastIndexOf('ORDER  BY'));
    const groupIdx = Math.max(upper.lastIndexOf('GROUP BY'), upper.lastIndexOf('GROUP  BY'));
    const setIdx = upper.lastIndexOf(' SET');
    const max = Math.max(selectIdx, fromIdx, orderIdx, groupIdx, setIdx);
    if (max === fromIdx && fromIdx > -1) return 'from';
    if (max === orderIdx && orderIdx > -1) return 'order_group';
    if (max === groupIdx && groupIdx > -1) return 'order_group';
    if (max === setIdx && setIdx > -1) return 'set';
    if (max === selectIdx && selectIdx > -1) return 'select';
    return 'select';
  }

  // After a table reference → suggest next clause keywords
  if (/\b(?:FROM|JOIN)\s+\w+(?:\s+(?:AS\s+)?\w+)?\s*$/i.test(cleaned)) return 'after_table';

  // After a complete condition → suggest AND/OR/clause keywords
  if (/(?:=|<>|!=|>=|<=|>|<)\s*(?:'[^']*'|\d+|\w+(?:\.\w+)?)\s*$/i.test(cleaned)) return 'after_table';
  if (/\b(?:IS\s+(?:NOT\s+)?NULL|LIKE\s+'[^']*'|IN\s*\([^)]*\))\s*$/i.test(cleaned)) return 'after_table';

  // Start of statement
  if (/(?:^|;\s*)$/i.test(cleaned)) return 'general';

  return 'general';
}

// Clause-level keyword snippets (compound keywords)
export const CLAUSE_SNIPPETS: { label: string; insertText: string; detail: string }[] = [
  { label: 'WHERE', insertText: 'WHERE ', detail: 'Filter rows' },
  { label: 'AND', insertText: 'AND ', detail: 'Additional condition' },
  { label: 'OR', insertText: 'OR ', detail: 'Alternative condition' },
  { label: 'JOIN', insertText: 'JOIN ${1:table} ON ${2:condition}', detail: 'Inner join' },
  { label: 'LEFT JOIN', insertText: 'LEFT JOIN ${1:table} ON ${2:condition}', detail: 'Left outer join' },
  { label: 'RIGHT JOIN', insertText: 'RIGHT JOIN ${1:table} ON ${2:condition}', detail: 'Right outer join' },
  { label: 'INNER JOIN', insertText: 'INNER JOIN ${1:table} ON ${2:condition}', detail: 'Inner join' },
  { label: 'CROSS JOIN', insertText: 'CROSS JOIN ${1:table}', detail: 'Cross join' },
  { label: 'FULL OUTER JOIN', insertText: 'FULL OUTER JOIN ${1:table} ON ${2:condition}', detail: 'Full outer join' },
  { label: 'ORDER BY', insertText: 'ORDER BY ${1:column}', detail: 'Sort results' },
  { label: 'GROUP BY', insertText: 'GROUP BY ${1:column}', detail: 'Group rows' },
  { label: 'HAVING', insertText: 'HAVING ${1:condition}', detail: 'Filter groups' },
  { label: 'LIMIT', insertText: 'LIMIT ${1:10}', detail: 'Limit rows' },
  { label: 'OFFSET', insertText: 'OFFSET ${1:0}', detail: 'Skip rows' },
  { label: 'UNION', insertText: 'UNION\nSELECT ', detail: 'Combine results' },
  { label: 'UNION ALL', insertText: 'UNION ALL\nSELECT ', detail: 'Combine results (with duplicates)' },
];
