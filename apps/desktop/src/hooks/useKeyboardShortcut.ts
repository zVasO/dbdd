import { useEffect } from 'react';

type Modifier = 'meta' | 'ctrl' | 'shift' | 'alt';

interface Shortcut {
  key: string;
  modifiers: Modifier[];
  handler: () => void;
  when?: () => boolean;
}

export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        const modMatch = shortcut.modifiers.every((mod) => {
          if (mod === 'meta') return e.metaKey;
          if (mod === 'ctrl') return e.ctrlKey;
          if (mod === 'shift') return e.shiftKey;
          if (mod === 'alt') return e.altKey;
          return false;
        });

        if (modMatch && e.key.toLowerCase() === shortcut.key.toLowerCase()) {
          if (!shortcut.when || shortcut.when()) {
            e.preventDefault();
            shortcut.handler();
            return;
          }
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts]);
}
