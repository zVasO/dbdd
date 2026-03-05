import { lazy, Suspense, useCallback, useEffect, useRef } from 'react';
import { format as formatSql } from 'sql-formatter';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useSchemaStore } from '@/stores/schemaStore';
import { useConnectionStore } from '@/stores/connectionStore';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

interface Props {
  value: string;
  onChange: (value: string) => void;
  onExecute: () => void;
}

// SQL keywords
const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE',
  'CREATE', 'ALTER', 'DROP', 'JOIN', 'LEFT', 'RIGHT', 'INNER',
  'OUTER', 'ON', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
  'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'AS',
  'DISTINCT', 'NULL', 'IS', 'SET', 'VALUES', 'INTO', 'TABLE',
  'INDEX', 'VIEW', 'DATABASE', 'SCHEMA', 'PRIMARY KEY',
  'FOREIGN KEY', 'REFERENCES', 'CASCADE', 'UNION', 'ALL',
  'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC',
  'DESC', 'TRUNCATE', 'GRANT', 'REVOKE', 'COMMIT', 'ROLLBACK',
  'BEGIN', 'TRANSACTION', 'CROSS', 'FULL', 'NATURAL', 'USING',
  'WITH', 'RECURSIVE', 'RETURNING', 'CONFLICT', 'DO', 'NOTHING',
  'OVER', 'PARTITION BY', 'WINDOW', 'ROWS', 'RANGE', 'UNBOUNDED',
  'PRECEDING', 'FOLLOWING', 'CURRENT ROW', 'FETCH', 'NEXT', 'ONLY',
  'TRUE', 'FALSE', 'DEFAULT', 'CHECK', 'UNIQUE', 'CONSTRAINT',
  'IF', 'REPLACE', 'TEMPORARY', 'TEMP', 'EXPLAIN', 'ANALYZE',
  'VACUUM', 'REINDEX',
];

// Common SQL functions by category
const SQL_FUNCTIONS: { label: string; detail: string; insertText: string }[] = [
  // Aggregate
  { label: 'COUNT', detail: 'Aggregate: count rows', insertText: 'COUNT($0)' },
  { label: 'SUM', detail: 'Aggregate: sum values', insertText: 'SUM($0)' },
  { label: 'AVG', detail: 'Aggregate: average value', insertText: 'AVG($0)' },
  { label: 'MIN', detail: 'Aggregate: minimum value', insertText: 'MIN($0)' },
  { label: 'MAX', detail: 'Aggregate: maximum value', insertText: 'MAX($0)' },
  { label: 'ARRAY_AGG', detail: 'Aggregate: collect into array', insertText: 'ARRAY_AGG($0)' },
  { label: 'STRING_AGG', detail: 'Aggregate: concatenate strings', insertText: 'STRING_AGG($1, $0)' },
  { label: 'GROUP_CONCAT', detail: 'Aggregate: concatenate strings (MySQL)', insertText: 'GROUP_CONCAT($0)' },
  // String
  { label: 'CONCAT', detail: 'String: concatenate', insertText: 'CONCAT($0)' },
  { label: 'SUBSTRING', detail: 'String: extract substring', insertText: 'SUBSTRING($1 FROM $2 FOR $0)' },
  { label: 'TRIM', detail: 'String: trim whitespace', insertText: 'TRIM($0)' },
  { label: 'UPPER', detail: 'String: to uppercase', insertText: 'UPPER($0)' },
  { label: 'LOWER', detail: 'String: to lowercase', insertText: 'LOWER($0)' },
  { label: 'LENGTH', detail: 'String: character count', insertText: 'LENGTH($0)' },
  { label: 'REPLACE', detail: 'String: replace substring', insertText: 'REPLACE($1, $2, $0)' },
  { label: 'COALESCE', detail: 'Return first non-null', insertText: 'COALESCE($0)' },
  { label: 'NULLIF', detail: 'Return null if equal', insertText: 'NULLIF($1, $0)' },
  { label: 'CAST', detail: 'Type cast', insertText: 'CAST($1 AS $0)' },
  { label: 'POSITION', detail: 'String: find position', insertText: 'POSITION($1 IN $0)' },
  { label: 'LEFT', detail: 'String: left substring', insertText: 'LEFT($1, $0)' },
  { label: 'RIGHT', detail: 'String: right substring', insertText: 'RIGHT($1, $0)' },
  { label: 'LPAD', detail: 'String: left-pad', insertText: 'LPAD($1, $2, $0)' },
  { label: 'RPAD', detail: 'String: right-pad', insertText: 'RPAD($1, $2, $0)' },
  // Date/time
  { label: 'NOW', detail: 'Date: current timestamp', insertText: 'NOW()' },
  { label: 'CURRENT_DATE', detail: 'Date: current date', insertText: 'CURRENT_DATE' },
  { label: 'CURRENT_TIMESTAMP', detail: 'Date: current timestamp', insertText: 'CURRENT_TIMESTAMP' },
  { label: 'DATE', detail: 'Date: extract date', insertText: 'DATE($0)' },
  { label: 'EXTRACT', detail: 'Date: extract part', insertText: 'EXTRACT($1 FROM $0)' },
  { label: 'DATE_TRUNC', detail: 'Date: truncate to precision', insertText: "DATE_TRUNC('$1', $0)" },
  { label: 'AGE', detail: 'Date: interval between dates', insertText: 'AGE($0)' },
  { label: 'DATE_ADD', detail: 'Date: add interval (MySQL)', insertText: 'DATE_ADD($1, INTERVAL $0)' },
  { label: 'DATE_SUB', detail: 'Date: subtract interval (MySQL)', insertText: 'DATE_SUB($1, INTERVAL $0)' },
  { label: 'DATEDIFF', detail: 'Date: difference (MySQL)', insertText: 'DATEDIFF($1, $0)' },
  // Numeric
  { label: 'ABS', detail: 'Math: absolute value', insertText: 'ABS($0)' },
  { label: 'CEIL', detail: 'Math: round up', insertText: 'CEIL($0)' },
  { label: 'FLOOR', detail: 'Math: round down', insertText: 'FLOOR($0)' },
  { label: 'ROUND', detail: 'Math: round', insertText: 'ROUND($1, $0)' },
  { label: 'MOD', detail: 'Math: modulo', insertText: 'MOD($1, $0)' },
  { label: 'POWER', detail: 'Math: exponentiation', insertText: 'POWER($1, $0)' },
  { label: 'SQRT', detail: 'Math: square root', insertText: 'SQRT($0)' },
  { label: 'RANDOM', detail: 'Math: random number', insertText: 'RANDOM()' },
  // Window
  { label: 'ROW_NUMBER', detail: 'Window: row number', insertText: 'ROW_NUMBER() OVER ($0)' },
  { label: 'RANK', detail: 'Window: rank', insertText: 'RANK() OVER ($0)' },
  { label: 'DENSE_RANK', detail: 'Window: dense rank', insertText: 'DENSE_RANK() OVER ($0)' },
  { label: 'LAG', detail: 'Window: previous row', insertText: 'LAG($1) OVER ($0)' },
  { label: 'LEAD', detail: 'Window: next row', insertText: 'LEAD($1) OVER ($0)' },
  { label: 'FIRST_VALUE', detail: 'Window: first value', insertText: 'FIRST_VALUE($1) OVER ($0)' },
  { label: 'LAST_VALUE', detail: 'Window: last value', insertText: 'LAST_VALUE($1) OVER ($0)' },
  { label: 'NTILE', detail: 'Window: distribute into buckets', insertText: 'NTILE($1) OVER ($0)' },
  // Conditional
  { label: 'IF', detail: 'Conditional (MySQL)', insertText: 'IF($1, $2, $0)' },
  { label: 'IIF', detail: 'Conditional (SQLite)', insertText: 'IIF($1, $2, $0)' },
  { label: 'IFNULL', detail: 'Return alternative if null', insertText: 'IFNULL($1, $0)' },
  // JSON
  { label: 'JSON_EXTRACT', detail: 'JSON: extract value', insertText: "JSON_EXTRACT($1, '$0')" },
  { label: 'JSON_ARRAY', detail: 'JSON: create array', insertText: 'JSON_ARRAY($0)' },
  { label: 'JSON_OBJECT', detail: 'JSON: create object', insertText: 'JSON_OBJECT($0)' },
  { label: 'JSONB_EXTRACT_PATH', detail: 'JSON: extract path (PG)', insertText: "JSONB_EXTRACT_PATH($1, '$0')" },
];

// Data type suggestions
const SQL_TYPES = [
  'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT',
  'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE', 'REAL',
  'VARCHAR', 'CHAR', 'TEXT', 'NVARCHAR', 'NCHAR',
  'DATE', 'TIME', 'TIMESTAMP', 'DATETIME', 'INTERVAL',
  'BOOLEAN', 'BOOL',
  'BLOB', 'BYTEA', 'BINARY', 'VARBINARY',
  'JSON', 'JSONB', 'XML',
  'UUID', 'SERIAL', 'BIGSERIAL',
  'ARRAY', 'ENUM',
];

/**
 * Find the table name/alias before a dot at the cursor position.
 * E.g., for "SELECT u.|" returns "u", for "SELECT users.|" returns "users".
 */
function getTableBeforeDot(textBeforeCursor: string): string | null {
  const match = textBeforeCursor.match(/(\w+)\.\s*$/);
  return match ? match[1] : null;
}

/**
 * Parse table aliases from the SQL text.
 * Returns a map of alias -> table name.
 */
function parseAliases(sql: string): Record<string, string> {
  const aliases: Record<string, string> = {};
  // Match: FROM/JOIN table_name alias  or  FROM/JOIN table_name AS alias
  const pattern = /(?:FROM|JOIN)\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi;
  let match;
  while ((match = pattern.exec(sql)) !== null) {
    const table = match[1];
    const alias = match[2];
    if (alias && !isKeyword(alias)) {
      aliases[alias.toLowerCase()] = table.toLowerCase();
    }
  }
  return aliases;
}

function isKeyword(word: string): boolean {
  const upper = word.toUpperCase();
  return SQL_KEYWORDS.includes(upper) || ['ON', 'WHERE', 'AND', 'OR', 'SET', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'NATURAL', 'FULL'].includes(upper);
}

export function SqlEditor({ value, onChange, onExecute }: Props) {
  const editorRef = useRef<any>(null);
  const disposablesRef = useRef<any[]>([]);
  const fontSize = usePreferencesStore((s) => s.editorFontSize);
  const showLineNumbers = usePreferencesStore((s) => s.editorShowLineNumbers);
  const wordWrap = usePreferencesStore((s) => s.editorWordWrap);
  const theme = usePreferencesStore((s) => s.theme);

  const handleMount = useCallback(
    (editor: any, monaco: any) => {
      editorRef.current = editor;

      // Ctrl/Cmd + Enter — execute query
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        () => onExecute(),
      );

      // Ctrl/Cmd + I — format SQL
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI,
        () => {
          const model = editor.getModel();
          if (!model) return;
          const val = model.getValue();
          try {
            const formatted = formatSql(val, {
              language: 'sql',
              tabWidth: 2,
              keywordCase: 'upper',
            });
            editor.setValue(formatted);
            onChange(formatted);
          } catch {
            // If formatting fails, do nothing
          }
        },
      );

      // Ctrl/Cmd + / — toggle line comment
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash,
        () => {
          editor.trigger('keyboard', 'editor.action.commentLine', null);
        },
      );

      // Register schema-aware autocompletion provider
      const completionDisposable = monaco.languages.registerCompletionItemProvider('sql', {
        triggerCharacters: ['.', ' '],
        provideCompletionItems: (model: any, position: any) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          // Get text before cursor for context analysis
          const textBeforeCursor = model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });

          const fullText = model.getValue();
          const suggestions: any[] = [];

          // Get schema data
          const schemaState = useSchemaStore.getState();
          const dbType = useConnectionStore.getState().activeConfig?.db_type;

          // All table names across all databases
          const allTables: { name: string; database: string }[] = [];
          for (const [db, tables] of Object.entries(schemaState.tables)) {
            for (const t of tables) {
              allTables.push({ name: t.name, database: db });
            }
          }

          // All column info from loaded structures
          const allColumns: { name: string; table: string; type: string }[] = [];
          for (const structure of Object.values(schemaState.structures)) {
            for (const col of structure.columns) {
              allColumns.push({
                name: col.name,
                table: structure.table_ref.table,
                type: col.data_type,
              });
            }
          }

          // Check if we're after a dot (table.column completion)
          const tablePrefix = getTableBeforeDot(textBeforeCursor);
          if (tablePrefix) {
            const aliases = parseAliases(fullText);
            const resolvedTable = aliases[tablePrefix.toLowerCase()] || tablePrefix.toLowerCase();

            // Find columns for this table
            const tableColumns = allColumns.filter(
              (c) => c.table.toLowerCase() === resolvedTable,
            );

            if (tableColumns.length > 0) {
              // Dot-triggered: only return columns for this table
              return {
                suggestions: tableColumns.map((col, i) => ({
                  label: col.name,
                  kind: monaco.languages.CompletionItemKind.Field,
                  detail: `${col.type} — ${col.table}`,
                  insertText: col.name,
                  range,
                  sortText: String(i).padStart(4, '0'),
                })),
              };
            }
          }

          // === Keywords ===
          for (const kw of SQL_KEYWORDS) {
            suggestions.push({
              label: kw,
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: kw,
              range,
              sortText: `2_${kw}`,
            });
          }

          // === Functions (with snippet support) ===
          for (const fn of SQL_FUNCTIONS) {
            suggestions.push({
              label: fn.label,
              kind: monaco.languages.CompletionItemKind.Function,
              detail: fn.detail,
              insertText: fn.insertText,
              insertTextRules: fn.insertText.includes('$')
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
              range,
              sortText: `3_${fn.label}`,
            });
          }

          // === Tables ===
          for (const t of allTables) {
            suggestions.push({
              label: t.name,
              kind: monaco.languages.CompletionItemKind.Struct,
              detail: `Table — ${t.database}`,
              insertText: t.name,
              range,
              sortText: `1_${t.name}`,
            });
          }

          // === Databases ===
          for (const db of schemaState.databases) {
            suggestions.push({
              label: db.name,
              kind: monaco.languages.CompletionItemKind.Module,
              detail: 'Database',
              insertText: db.name,
              range,
              sortText: `4_${db.name}`,
            });
          }

          // === Columns (all, when not after a dot) ===
          const seen = new Set<string>();
          for (const col of allColumns) {
            if (seen.has(col.name)) continue;
            seen.add(col.name);
            suggestions.push({
              label: col.name,
              kind: monaco.languages.CompletionItemKind.Field,
              detail: `${col.type} — ${col.table}`,
              insertText: col.name,
              range,
              sortText: `1_${col.name}`,
            });
          }

          // === Data types (after CREATE, ALTER, CAST, AS) ===
          const lastKeyword = textBeforeCursor.match(/\b(CREATE|ALTER|CAST|AS|RETURNS)\s+\w*$/i);
          if (lastKeyword) {
            for (const t of SQL_TYPES) {
              suggestions.push({
                label: t,
                kind: monaco.languages.CompletionItemKind.TypeParameter,
                detail: 'Data type',
                insertText: t,
                range,
                sortText: `0_${t}`,
              });
            }
          }

          return { suggestions };
        },
      });

      disposablesRef.current.push(completionDisposable);
    },
    [onExecute, onChange],
  );

  // Cleanup completion provider on unmount
  useEffect(() => {
    return () => {
      for (const d of disposablesRef.current) {
        d.dispose();
      }
      disposablesRef.current = [];
    };
  }, []);

  // Listen for toolbar format event
  useEffect(() => {
    const handler = () => {
      const editor = editorRef.current;
      if (!editor) return;
      const model = editor.getModel();
      if (!model) return;
      const val = model.getValue();
      try {
        const formatted = formatSql(val, {
          language: 'sql',
          tabWidth: 2,
          keywordCase: 'upper',
        });
        editor.setValue(formatted);
        onChange(formatted);
      } catch {
        // If formatting fails, do nothing
      }
    };
    document.addEventListener('dataforge:format', handler);
    return () => document.removeEventListener('dataforge:format', handler);
  }, [onChange]);

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-muted-foreground">
          Loading editor...
        </div>
      }
    >
      <MonacoEditor
        height="100%"
        defaultLanguage="sql"
        value={value}
        onChange={(val) => onChange(val || '')}
        onMount={handleMount}
        theme={theme === 'dark' ? 'vs-dark' : 'vs'}
        options={{
          minimap: { enabled: false },
          fontSize,
          fontFamily: 'var(--font-mono)',
          lineNumbers: showLineNumbers ? 'on' : 'off',
          scrollBeyondLastLine: false,
          wordWrap: wordWrap ? 'on' : 'off',
          tabSize: 2,
          automaticLayout: true,
          padding: { top: 8 },
          tabCompletion: 'on',
          acceptSuggestionOnEnter: 'on',
          suggestOnTriggerCharacters: true,
          quickSuggestions: true,
          snippetSuggestions: 'inline',
          suggest: {
            showKeywords: false, // We provide our own
            insertMode: 'replace',
          },
        }}
      />
    </Suspense>
  );
}
