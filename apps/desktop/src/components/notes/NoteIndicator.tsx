import { MessageSquare } from 'lucide-react';
import { useNotesStore } from '@/stores/notesStore';
import { cn } from '@/lib/utils';

interface NoteIndicatorProps {
  targetKey: string;
  size?: 'sm' | 'md';
}

export function NoteIndicator({ targetKey, size = 'sm' }: NoteIndicatorProps) {
  const notes = useNotesStore((s) => s.notes);
  const setPanelOpen = useNotesStore((s) => s.setPanelOpen);

  const matchingNotes = notes.filter((n) => n.targetKey === targetKey);

  if (matchingNotes.length === 0) {
    return null;
  }

  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  const badgeSize = size === 'sm' ? 'h-3 min-w-[12px] text-[8px]' : 'h-4 min-w-[16px] text-[10px]';

  return (
    <button
      type="button"
      className={cn(
        'relative inline-flex items-center text-muted-foreground hover:text-foreground transition-colors',
        size === 'sm' ? 'p-0.5' : 'p-1',
      )}
      onClick={(e) => {
        e.stopPropagation();
        setPanelOpen(true);
      }}
      title={`${matchingNotes.length} note${matchingNotes.length !== 1 ? 's' : ''}`}
    >
      <MessageSquare className={iconSize} />
      {matchingNotes.length > 1 && (
        <span
          className={cn(
            'absolute -top-1 -right-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground font-medium leading-none px-0.5',
            badgeSize,
          )}
        >
          {matchingNotes.length}
        </span>
      )}
    </button>
  );
}
