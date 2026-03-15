import { lazy, Suspense } from 'react';

const CodemirrorEditor = lazy(() =>
  import('./CodemirrorEditor').then((m) => ({ default: m.CodemirrorEditor })),
);

interface Props {
  value: string;
  onChange: (value: string) => void;
  onExecute: () => void;
}

export function SqlEditor(props: Props) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-muted-foreground">
          Loading editor...
        </div>
      }
    >
      <CodemirrorEditor {...props} />
    </Suspense>
  );
}
