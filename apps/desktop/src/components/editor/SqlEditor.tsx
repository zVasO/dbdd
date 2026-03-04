import { lazy, Suspense, useCallback, useEffect, useRef } from 'react';
import { format as formatSql } from 'sql-formatter';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

interface Props {
  value: string;
  onChange: (value: string) => void;
  onExecute: () => void;
}

export function SqlEditor({ value, onChange, onExecute }: Props) {
  const editorRef = useRef<any>(null);

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

      // Register SQL autocompletion provider
      monaco.languages.registerCompletionItemProvider('sql', {
        provideCompletionItems: (model: any, position: any) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          const keywords = [
            'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE',
            'CREATE', 'ALTER', 'DROP', 'JOIN', 'LEFT', 'RIGHT', 'INNER',
            'OUTER', 'ON', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
            'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'AS',
            'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'NULL',
            'IS', 'SET', 'VALUES', 'INTO', 'TABLE', 'INDEX', 'VIEW',
            'DATABASE', 'SCHEMA', 'PRIMARY KEY', 'FOREIGN KEY',
            'REFERENCES', 'CASCADE', 'UNION', 'ALL', 'EXISTS', 'CASE',
            'WHEN', 'THEN', 'ELSE', 'END', 'ASC', 'DESC', 'TRUNCATE',
            'GRANT', 'REVOKE', 'COMMIT', 'ROLLBACK', 'BEGIN', 'TRANSACTION',
          ];

          return {
            suggestions: keywords.map((kw) => ({
              label: kw,
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: kw,
              range,
            })),
          };
        },
      });
    },
    [onExecute, onChange],
  );

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
        theme="vs-dark"
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: 'var(--font-mono)',
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          tabSize: 2,
          automaticLayout: true,
          padding: { top: 8 },
          tabCompletion: 'on',
          acceptSuggestionOnEnter: 'on',
          suggestOnTriggerCharacters: true,
          quickSuggestions: true,
        }}
      />
    </Suspense>
  );
}
