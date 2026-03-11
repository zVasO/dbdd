import { useEffect, useRef } from 'react';

type Modifier = 'meta' | 'ctrl' | 'shift' | 'alt';

interface Shortcut {
  key: string;
  modifiers: Modifier[];
  handler: () => void;
  when?: () => boolean;
}

export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  // Store shortcuts in a ref so the event listener never needs re-binding
  const shortcutsRef = useRef(shortcuts);
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      for (const shortcut of shortcutsRef.current) {
        // Exact modifier matching: all required modifiers must be pressed,
        // and no extra modifiers should be pressed
        const modMatch =
          shortcut.modifiers.every((mod) => {
            if (mod === 'meta') return e.metaKey;
            if (mod === 'ctrl') return e.ctrlKey;
            if (mod === 'shift') return e.shiftKey;
            if (mod === 'alt') return e.altKey;
            return false;
          }) &&
          e.metaKey === shortcut.modifiers.includes('meta') &&
          e.ctrlKey === shortcut.modifiers.includes('ctrl') &&
          e.shiftKey === shortcut.modifiers.includes('shift') &&
          e.altKey === shortcut.modifiers.includes('alt');

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
  }, []); // Mount once — never re-binds
}
