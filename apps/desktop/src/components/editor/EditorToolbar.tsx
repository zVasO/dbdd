interface Props {
  isExecuting: boolean;
  onRun: () => void;
}

export function EditorToolbar({ isExecuting, onRun }: Props) {
  return (
    <div
      className="flex items-center gap-2 border-b px-3"
      style={{
        height: 'var(--toolbar-height)',
        background: 'var(--color-bg-secondary)',
        borderColor: 'var(--color-border)',
      }}
    >
      <button
        onClick={onRun}
        disabled={isExecuting}
        className="flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        style={{ background: isExecuting ? 'var(--color-text-disabled)' : 'var(--color-success)' }}
      >
        {isExecuting ? 'Running...' : 'Run'}
        <kbd className="ml-1 rounded px-1 text-[10px] opacity-60" style={{ background: 'rgba(255,255,255,0.2)' }}>
          Ctrl+Enter
        </kbd>
      </button>
    </div>
  );
}
