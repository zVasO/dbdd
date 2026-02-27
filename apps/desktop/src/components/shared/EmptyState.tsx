interface Props {
  message: string;
}

export function EmptyState({ message }: Props) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p className="text-sm" style={{ color: 'var(--color-text-disabled)' }}>{message}</p>
    </div>
  );
}
