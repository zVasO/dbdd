import { lazy, Suspense } from 'react';

const CodemirrorEditor = lazy(() =>
  import('./CodemirrorEditor').then((m) => ({ default: m.CodemirrorEditor })),
);

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Run the selection, or the statement under the cursor */
  onExecute: () => void;
  /** Run the whole script */
  onExecuteAll: () => void;
  /** Called whenever the selection or cursor moves */
  onSelectionChange: (range: { from: number; to: number }) => void;
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
