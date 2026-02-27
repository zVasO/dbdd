export function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center p-4">
      <div
        className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent"
        style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }}
      />
    </div>
  );
}
