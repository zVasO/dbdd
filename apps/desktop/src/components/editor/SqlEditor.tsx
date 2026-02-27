import { lazy, Suspense, useCallback } from 'react';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

interface Props {
  value: string;
  onChange: (value: string) => void;
  onExecute: () => void;
}

export function SqlEditor({ value, onChange, onExecute }: Props) {
  const handleMount = useCallback(
    (editor: any) => {
      editor.addCommand(
        // Ctrl/Cmd + Enter
        2048 | 3, // KeyMod.CtrlCmd | KeyCode.Enter
        () => onExecute(),
      );
    },
    [onExecute],
  );

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center" style={{ color: 'var(--color-text-disabled)' }}>
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
        }}
      />
    </Suspense>
  );
}
