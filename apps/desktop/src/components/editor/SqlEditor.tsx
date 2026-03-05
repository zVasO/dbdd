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

// SQL keywords (single words only — no multi-word to avoid cursor issues)
const SQL_KEYWORDS = [
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
];

// Common SQL functions
const SQL_FUNCTIONS: { label: string; detail: string; insertText: string }[] = [
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
];

// Data type suggestions
const SQL_TYPES = [
  'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT',
  'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE', 'REAL',
  'VARCHAR', 'CHAR', 'TEXT', 'NVARCHAR',
  'DATE', 'TIME', 'TIMESTAMP', 'DATETIME',
  'BOOLEAN', 'BOOL',
  'BLOB', 'BYTEA', 'BINARY',
  'JSON', 'JSONB', 'XML',
  'UUID', 'SERIAL', 'BIGSERIAL',
];

const KEYWORD_SET = new Set([
  ...SQL_KEYWORDS,
  'ON', 'WHERE', 'AND', 'OR', 'SET',
]);

/**
 * Parse table aliases from the SQL text.
 * Returns a map of alias -> table name.
 */
function parseAliases(sql: string): Record<string, string> {
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

// Track if we already registered a provider (global — Monaco providers are global per language)
let completionProviderRegistered = false;

export function SqlEditor({ value, onChange, onExecute }: Props) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const disposableRef = useRef<any>(null);
  const fontSize = usePreferencesStore((s) => s.editorFontSize);
  const showLineNumbers = usePreferencesStore((s) => s.editorShowLineNumbers);
  const wordWrap = usePreferencesStore((s) => s.editorWordWrap);
  const theme = usePreferencesStore((s) => s.theme);

  // Keep stable refs for callbacks used inside Monaco
  const onExecuteRef = useRef(onExecute);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onExecuteRef.current = onExecute; }, [onExecute]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const handleMount = useCallback(
    (editor: any, monaco: any) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      // Ctrl/Cmd + Enter — execute query
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        () => onExecuteRef.current(),
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
            onChangeRef.current(formatted);
          } catch {
            // formatting failed
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

      // Register completion provider only once globally
      if (!completionProviderRegistered) {
        completionProviderRegistered = true;

        disposableRef.current = monaco.languages.registerCompletionItemProvider('sql', {
          triggerCharacters: ['.'],
          provideCompletionItems: (model: any, position: any) => {
            const word = model.getWordUntilPosition(position);
            const range = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn,
            };

            // Get the character before the current word to detect dot context
            const lineContent = model.getLineContent(position.lineNumber);
            const charBeforeWord = lineContent[word.startColumn - 2] || '';

            const fullText = model.getValue();

            // Get schema data
            const schemaState = useSchemaStore.getState();

            // Collect all tables
            const allTables: { name: string; database: string }[] = [];
            for (const [db, tables] of Object.entries(schemaState.tables)) {
              for (const t of tables) {
                allTables.push({ name: t.name, database: db });
              }
            }

            // Collect all columns from loaded structures
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

            // === DOT COMPLETION: table.column ===
            if (charBeforeWord === '.') {
              // Find the word before the dot
              const textBeforeDot = lineContent.substring(0, word.startColumn - 2);
              const tableMatch = textBeforeDot.match(/(\w+)\s*$/);
              if (tableMatch) {
                const prefix = tableMatch[1].toLowerCase();
                const aliases = parseAliases(fullText);
                const resolvedTable = aliases[prefix] || prefix;

                const tableColumns = allColumns.filter(
                  (c) => c.table.toLowerCase() === resolvedTable,
                );

                if (tableColumns.length > 0) {
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
            }

            // === GENERAL COMPLETION ===
            const suggestions: any[] = [];

            // Tables (high priority)
            for (const t of allTables) {
              suggestions.push({
                label: t.name,
                kind: monaco.languages.CompletionItemKind.Struct,
                detail: `Table — ${t.database}`,
                insertText: t.name,
                range,
                sortText: `0_${t.name}`,
              });
            }

            // Columns from loaded structures (high priority)
            const seenCols = new Set<string>();
            for (const col of allColumns) {
              const key = `${col.name}__${col.table}`;
              if (seenCols.has(key)) continue;
              seenCols.add(key);
              suggestions.push({
                label: col.name,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${col.type} — ${col.table}`,
                insertText: col.name,
                range,
                sortText: `0_${col.name}`,
              });
            }

            // Keywords
            for (const kw of SQL_KEYWORDS) {
              suggestions.push({
                label: kw,
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: kw,
                range,
                sortText: `2_${kw}`,
              });
            }

            // Functions (with snippets)
            for (const fn of SQL_FUNCTIONS) {
              suggestions.push({
                label: fn.label,
                kind: monaco.languages.CompletionItemKind.Function,
                detail: fn.detail,
                insertText: fn.insertText,
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range,
                sortText: `3_${fn.label}`,
              });
            }

            // Databases
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

            // Data types
            for (const t of SQL_TYPES) {
              suggestions.push({
                label: t,
                kind: monaco.languages.CompletionItemKind.TypeParameter,
                detail: 'Data type',
                insertText: t,
                range,
                sortText: `5_${t}`,
              });
            }

            return { suggestions };
          },
        });
      }
    },
    [], // No deps — uses refs for callbacks
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (disposableRef.current) {
        disposableRef.current.dispose();
        disposableRef.current = null;
        completionProviderRegistered = false;
      }
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
        onChangeRef.current(formatted);
      } catch {
        // formatting failed
      }
    };
    document.addEventListener('dataforge:format', handler);
    return () => document.removeEventListener('dataforge:format', handler);
  }, []);

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
            showKeywords: false,
            insertMode: 'replace',
          },
        }}
      />
    </Suspense>
  );
}
