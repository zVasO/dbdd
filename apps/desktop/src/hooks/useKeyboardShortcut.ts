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
        // On macOS, Cmd (metaKey) and Ctrl are unified under 'ctrl' — same as matchesBinding()
        const ctrlPressed = e.ctrlKey || e.metaKey;
        const wantsCtrl = shortcut.modifiers.includes('ctrl');
        const wantsShift = shortcut.modifiers.includes('shift');
        const wantsAlt = shortcut.modifiers.includes('alt');
        const wantsMeta = shortcut.modifiers.includes('meta');

        const modMatch =
          wantsCtrl === ctrlPressed &&
          wantsShift === e.shiftKey &&
          wantsAlt === e.altKey &&
          (!wantsCtrl && wantsMeta ? e.metaKey : true);

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
