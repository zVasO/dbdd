interface Props {
  connected: boolean;
  dbType?: string;
}

export function ConnectionStatus({ connected, dbType }: Props) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-muted-foreground'}`}
      />
      <span className="text-xs text-muted-foreground">
        {connected ? `Connected (${dbType})` : 'Disconnected'}
      </span>
    </div>
  );
}
