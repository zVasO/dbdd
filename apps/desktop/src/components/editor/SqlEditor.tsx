import { lazy, Suspense, useCallback, useEffect, useRef } from 'react';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useThemeStore } from '@/stores/themeStore';
import { useSchemaStore } from '@/stores/schemaStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useShortcutStore } from '@/stores/shortcutStore';
import { getFuzzySearchBridge, type SearchContext } from '@/lib/fuzzy-search-bridge';

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
  'SHOW', 'DESCRIBE', 'USE', 'MODIFY', 'ADD', 'COLUMN', 'RENAME',
  'INTERVAL', 'ANY', 'SOME', 'ESCAPE', 'EXCEPT', 'INTERSECT',
  'LATERAL', 'GROUPING', 'CUBE', 'ROLLUP', 'LOCK', 'UNLOCK',
  'FORCE', 'IGNORE', 'STRAIGHT_JOIN', 'DUPLICATE',
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

// --- SQL context detection & parsing helpers ---

type SqlContext =
  | 'select' | 'from' | 'condition' | 'order_group'
  | 'set' | 'ddl' | 'after_table' | 'general';

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

function parseTablePrefixes(sql: string): Record<string, string> {
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

function detectSqlContext(textBeforeCursor: string): SqlContext {
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
const CLAUSE_SNIPPETS: { label: string; insertText: string; detail: string }[] = [
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

/** Read a CSS variable from :root and convert HSL to hex for Monaco */
function cssVarToHex(varName: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) return fallback;
  // Handle hsl(...) or raw "H S% L%" format
  const hslMatch = raw.match(/^(?:hsl\()?\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)?$/);
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]) / 360;
    const s = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
    const g = Math.round(hue2rgb(p, q, h) * 255);
    const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }
  // Already hex or other format
  if (raw.startsWith('#')) return raw;
  return fallback;
}

function defineDataforgeTheme(monaco: any, dark: boolean) {
  const bg = cssVarToHex('--background', dark ? '#1e1e1e' : '#ffffff');
  const fg = cssVarToHex('--foreground', dark ? '#d4d4d4' : '#1e1e1e');
  const muted = cssVarToHex('--muted', dark ? '#2d2d2d' : '#f5f5f5');
  const mutedFg = cssVarToHex('--muted-foreground', dark ? '#858585' : '#737373');
  const primary = cssVarToHex('--primary', dark ? '#569cd6' : '#0070f3');
  const accent = cssVarToHex('--accent', dark ? '#2d2d2d' : '#f0f0f0');
  const border = cssVarToHex('--border', dark ? '#3e3e3e' : '#e5e5e5');

  monaco.editor.defineTheme('dataforge', {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: primary.replace('#', ''), fontStyle: 'bold' },
      { token: 'comment', foreground: mutedFg.replace('#', ''), fontStyle: 'italic' },
      { token: 'string', foreground: dark ? 'ce9178' : 'a31515' },
      { token: 'number', foreground: dark ? 'b5cea8' : '098658' },
      { token: 'operator', foreground: fg.replace('#', '') },
    ],
    colors: {
      'editor.background': bg,
      'editor.foreground': fg,
      'editor.lineHighlightBackground': accent,
      'editor.selectionBackground': dark ? '#264f78' : '#add6ff',
      'editorLineNumber.foreground': mutedFg,
      'editorCursor.foreground': fg,
      'editor.inactiveSelectionBackground': muted,
      'editorWidget.background': bg,
      'editorWidget.border': border,
      'editorSuggestWidget.background': bg,
      'editorSuggestWidget.border': border,
      'editorSuggestWidget.selectedBackground': accent,
      'input.background': muted,
      'input.border': border,
      'input.foreground': fg,
    },
  });
}

// Track if we already registered a provider (global — Monaco providers are global per language)
let completionProviderRegistered = false;

export function SqlEditor({ value, onChange, onExecute }: Props) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const disposableRef = useRef<any>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fontSize = usePreferencesStore((s) => s.editorFontSize);
  const showLineNumbers = usePreferencesStore((s) => s.editorShowLineNumbers);
  const wordWrap = usePreferencesStore((s) => s.editorWordWrap);
  const activeTheme = useThemeStore((s) => s.themes.find((t) => t.id === s.activeThemeId));
  const isDark = activeTheme?.isDark ?? true;

  // Keep stable refs for callbacks used inside Monaco
  const onExecuteRef = useRef(onExecute);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onExecuteRef.current = onExecute; }, [onExecute]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // Sync external value changes into Monaco (e.g. tab switch, file load)
  const lastExternalValueRef = useRef(value);
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && value !== lastExternalValueRef.current) {
      lastExternalValueRef.current = value;
      const model = editor.getModel();
      if (model && model.getValue() !== value) {
        model.setValue(value);
      }
    }
  }, [value]);

  // Debounced onChange — sync to store every 150ms instead of every keystroke
  const handleChange = useCallback((val: string | undefined) => {
    const text = val || '';
    lastExternalValueRef.current = text;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChangeRef.current(text);
    }, 150);
  }, []);

  // Flush pending changes on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        // Flush the last value
        const editor = editorRef.current;
        if (editor) {
          const model = editor.getModel();
          if (model) onChangeRef.current(model.getValue());
        }
      }
    };
  }, []);

  const handleMount = useCallback(
    (editor: any, monaco: any) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      // Define and apply custom theme that reads CSS variables
      const currentTheme = useThemeStore.getState().getActiveTheme();
      defineDataforgeTheme(monaco, currentTheme.isDark);
      monaco.editor.setTheme('dataforge');

      // Helper: convert ShortcutBinding → Monaco keybinding number
      const toMonacoKeybinding = (id: string) => {
        const binding = useShortcutStore.getState().getBinding(id);
        let kb = 0;
        for (const mod of binding.modifiers) {
          if (mod === 'ctrl') kb |= monaco.KeyMod.CtrlCmd;
          if (mod === 'shift') kb |= monaco.KeyMod.Shift;
          if (mod === 'alt') kb |= monaco.KeyMod.Alt;
          if (mod === 'meta') kb |= monaco.KeyMod.WinCtrl;
        }
        // Map key string to Monaco KeyCode
        const keyMap: Record<string, number> = {
          enter: monaco.KeyCode.Enter,
          '/': monaco.KeyCode.Slash,
          i: monaco.KeyCode.KeyI,
        };
        kb |= keyMap[binding.key.toLowerCase()] ?? 0;
        return kb;
      };

      // Execute query — flush pending changes first so store has latest SQL
      editor.addCommand(
        toMonacoKeybinding('editor.execute'),
        () => {
          if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
          }
          const model = editor.getModel();
          if (model) onChangeRef.current(model.getValue());
          onExecuteRef.current();
        },
      );

      // Format SQL (lazy-loaded to avoid bundling on initial load)
      editor.addCommand(
        toMonacoKeybinding('editor.format'),
        async () => {
          const model = editor.getModel();
          if (!model) return;
          const val = model.getValue();
          try {
            const { format } = await import('sql-formatter');
            const formatted = format(val, {
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

      // Toggle line comment
      editor.addCommand(
        toMonacoKeybinding('editor.toggleComment'),
        () => {
          editor.trigger('keyboard', 'editor.action.commentLine', null);
        },
      );

      // Register completion provider only once globally
      if (!completionProviderRegistered) {
        completionProviderRegistered = true;

        const bridge = getFuzzySearchBridge();

        disposableRef.current = monaco.languages.registerCompletionItemProvider('sql', {
          triggerCharacters: ['.'],
          provideCompletionItems: async (model: any, position: any) => {
            const word = model.getWordUntilPosition(position);
            const range = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn,
            };

            const lineContent = model.getLineContent(position.lineNumber);
            const charBeforeWord = lineContent[word.startColumn - 2] || '';
            const currentWord = word.word;

            // === DOT COMPLETION: table.column or alias.column ===
            if (charBeforeWord === '.') {
              const textBeforeDot = lineContent.substring(0, word.startColumn - 2);
              const tableMatch = textBeforeDot.match(/(\w+)\s*$/);
              if (tableMatch) {
                const prefix = tableMatch[1].toLowerCase();
                const fullText = model.getValue();
                const aliases = parseAliases(fullText);
                const resolvedTable = aliases[prefix] || prefix;
                const suggestions: any[] = [];

                if (currentWord) {
                  // User typed something after dot — fuzzy search columns
                  const results = await bridge.search(currentWord, 'after_table', { resolvedTable, limit: 50 });
                  for (const item of results) {
                    suggestions.push({
                      label: item.name,
                      kind: monaco.languages.CompletionItemKind.Field,
                      detail: `${item.columnType ?? ''} — ${item.table ?? ''}`,
                      insertText: item.name,
                      range,
                      sortText: String(100 - item.score).padStart(4, '0'),
                      filterText: item.name,
                    });
                  }
                } else {
                  // Just typed dot — show all columns from schema store
                  const schemaState = useSchemaStore.getState();
                  for (const structure of Object.values(schemaState.structures)) {
                    if (structure.table_ref.table.toLowerCase() === resolvedTable) {
                      for (let i = 0; i < structure.columns.length; i++) {
                        const col = structure.columns[i];
                        suggestions.push({
                          label: col.name,
                          kind: monaco.languages.CompletionItemKind.Field,
                          detail: `${col.data_type} — ${structure.table_ref.table}`,
                          insertText: col.name,
                          range,
                          sortText: String(i).padStart(4, '0'),
                        });
                      }
                      break;
                    }
                  }
                }
                return { suggestions };
              }
            }

            // === CONTEXT-AWARE COMPLETION ===
            const textBeforeCursor = model.getValueInRange({
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: position.lineNumber,
              endColumn: word.startColumn,
            });
            const context = detectSqlContext(textBeforeCursor);
            const suggestions: any[] = [];

            // Map SqlContext to SearchContext for the bridge
            const bridgeContext: SearchContext = context as SearchContext;

            // Fuzzy search schema items when user has typed >= 2 chars
            if (currentWord.length >= 2) {
              const results = await bridge.search(currentWord, bridgeContext, { limit: 50 });
              for (const item of results) {
                suggestions.push({
                  label: item.name,
                  kind: item.type === 'table'
                    ? monaco.languages.CompletionItemKind.Struct
                    : monaco.languages.CompletionItemKind.Field,
                  detail: item.type === 'table'
                    ? `Table — ${item.database ?? ''}`
                    : `${item.columnType ?? ''} — ${item.table ?? ''}`,
                  insertText: item.name,
                  range,
                  sortText: String(100 - item.score).padStart(4, '0'),
                  filterText: item.name,
                });
              }
            }

            // Static suggestions (keywords, functions, snippets, types) —
            // always appended so Monaco's native filtering handles them
            const staticSortBase = '0200';

            // In DDL context: types + DDL keywords
            if (context === 'ddl') {
              for (const t of SQL_TYPES) {
                suggestions.push({
                  label: t, kind: monaco.languages.CompletionItemKind.TypeParameter,
                  detail: 'Data type', insertText: t, range, sortText: staticSortBase,
                });
              }
              for (const kw of ['TABLE', 'INDEX', 'VIEW', 'DATABASE', 'SCHEMA', 'COLUMN']) {
                suggestions.push({
                  label: kw, kind: monaco.languages.CompletionItemKind.Keyword,
                  insertText: kw, range, sortText: '0201',
                });
              }
              return { suggestions };
            }

            // In column contexts: add functions
            const isColumnCtx = context === 'select' || context === 'condition'
              || context === 'order_group' || context === 'set';
            if (isColumnCtx) {
              for (const fn of SQL_FUNCTIONS) {
                suggestions.push({
                  label: fn.label, kind: monaco.languages.CompletionItemKind.Function,
                  detail: fn.detail, insertText: fn.insertText,
                  insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range, sortText: staticSortBase,
                });
              }
            }

            // Clause snippets
            for (const cs of CLAUSE_SNIPPETS) {
              suggestions.push({
                label: cs.label, kind: monaco.languages.CompletionItemKind.Snippet,
                detail: cs.detail, insertText: cs.insertText,
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range, sortText: context === 'after_table' ? '0100' : '0202',
              });
            }

            // Keywords
            for (const kw of SQL_KEYWORDS) {
              suggestions.push({
                label: kw, kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: kw, range, sortText: '0203',
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

  // Re-apply Monaco theme when app theme changes (dark/light toggle or theme switch)
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    // Small delay to let CSS variables update on DOM first
    const timer = setTimeout(() => {
      defineDataforgeTheme(monaco, isDark);
      monaco.editor.setTheme('dataforge');
    }, 50);
    return () => clearTimeout(timer);
  }, [isDark, activeThemeId]);

  // Listen for toolbar format event (lazy-loaded)
  useEffect(() => {
    const handler = async () => {
      const editor = editorRef.current;
      if (!editor) return;
      const model = editor.getModel();
      if (!model) return;
      const val = model.getValue();
      try {
        const { format } = await import('sql-formatter');
        const formatted = format(val, {
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
        defaultValue={value}
        onChange={handleChange}
        onMount={handleMount}
        theme="dataforge"
        options={{
          minimap: { enabled: false },
          fontSize,
          fontFamily: "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
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
            showKeywords: true,
            insertMode: 'insert',
            filterGraceful: true,
            showIcons: true,
          },
        }}
      />
    </Suspense>
  );
}
