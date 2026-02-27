interface Props {
  connected: boolean;
  dbType?: string;
}

export function ConnectionStatus({ connected, dbType }: Props) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="h-2 w-2 rounded-full"
        style={{ background: connected ? 'var(--color-success)' : 'var(--color-text-disabled)' }}
      />
      <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        {connected ? `Connected (${dbType})` : 'Disconnected'}
      </span>
    </div>
  );
}
