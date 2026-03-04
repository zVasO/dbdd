import { lazy, Suspense, useCallback } from 'react';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

interface Props {
  value: string;
  onChange: (value: string) => void;
  onExecute: () => void;
}

export function SqlEditor({ value, onChange, onExecute }: Props) {
  const handleMount = useCallback(
    (editor: any, monaco: any) => {
      editor.addCommand(
        // Ctrl/Cmd + Enter
        2048 | 3, // KeyMod.CtrlCmd | KeyCode.Enter
        () => onExecute(),
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
    [onExecute],
  );

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
