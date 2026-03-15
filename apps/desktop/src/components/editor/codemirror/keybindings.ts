import { keymap } from '@codemirror/view';
import { toggleComment } from '@codemirror/commands';
import type { Extension } from '@codemirror/state';
import { useShortcutStore, type ShortcutBinding } from '@/stores/shortcutStore';

// === Types ===

interface KeybindingCallbacks {
  onExecute: () => void;
  onFormat: () => void;
}

// === Modifier mapping ===
//
// The shortcutStore models modifiers as browser-level concepts:
//   ctrl  = "primary modifier" (Cmd on Mac, Ctrl elsewhere)
//   meta  = "secondary modifier" (physical Ctrl on Mac)
//   shift = Shift
//   alt   = Alt / Option
//
// CM6 uses a platform-aware notation:
//   Mod   = Cmd on Mac, Ctrl elsewhere (matches our "ctrl")
//   Ctrl  = physical Control key on every platform (matches our "meta")
//   Shift = Shift
//   Alt   = Alt / Option

const MODIFIER_TO_CM6: Record<string, string> = {
  ctrl: 'Mod',
  shift: 'Shift',
  alt: 'Alt',
  meta: 'Ctrl',
};

/**
 * Convert a ShortcutBinding into a CM6 key string.
 *
 * Example: { key: 'Enter', modifiers: ['ctrl'] } -> 'Mod-Enter'
 * Example: { key: 'i', modifiers: ['ctrl', 'shift'] } -> 'Mod-Shift-i'
 */
function bindingToCm6Key(binding: ShortcutBinding): string {
  const modParts = binding.modifiers
    .map((mod) => MODIFIER_TO_CM6[mod])
    .filter(Boolean);

  // CM6 expects modifiers in a canonical order: Ctrl, Alt, Shift, Mod
  // (though it is fairly lenient). We sort to keep output deterministic.
  const order = ['Ctrl', 'Alt', 'Shift', 'Mod'];
  modParts.sort((a, b) => order.indexOf(a) - order.indexOf(b));

  return [...modParts, binding.key].join('-');
}

// === Extension factory ===

/**
 * Build a CM6 keymap extension from the current shortcut store state.
 *
 * This reads bindings eagerly at call-time. If the user changes shortcuts
 * at runtime, the editor must be reconfigured (which the React wrapper
 * handles via compartment reconfiguration).
 */
export function dataforgeKeybindings(callbacks: KeybindingCallbacks): Extension {
  const { getBinding } = useShortcutStore.getState();

  const executeBinding = getBinding('editor.execute');
  const formatBinding = getBinding('editor.format');
  const commentBinding = getBinding('editor.toggleComment');

  return keymap.of([
    {
      key: bindingToCm6Key(executeBinding),
      run: () => {
        callbacks.onExecute();
        return true;
      },
      preventDefault: true,
    },
    {
      key: bindingToCm6Key(formatBinding),
      run: () => {
        callbacks.onFormat();
        return true;
      },
      preventDefault: true,
    },
    {
      key: bindingToCm6Key(commentBinding),
      run: toggleComment,
      preventDefault: true,
    },
  ]);
}

export { bindingToCm6Key };
export type { KeybindingCallbacks };
