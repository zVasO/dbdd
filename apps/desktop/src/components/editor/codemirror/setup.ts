import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  rectangularSelection,
  keymap,
} from '@codemirror/view';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import {
  bracketMatching,
  indentOnInput,
  foldGutter,
  foldKeymap,
} from '@codemirror/language';

// ---------------------------------------------------------------------------
// Compartments — hot-swappable preference slots
// ---------------------------------------------------------------------------

export const lineNumbersCompartment = new Compartment();
export const fontSizeCompartment = new Compartment();
export const wordWrapCompartment = new Compartment();

// ---------------------------------------------------------------------------
// Monospace font stack shared across editor surfaces
// ---------------------------------------------------------------------------

const MONO_FONT_FAMILY =
  "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

// ---------------------------------------------------------------------------
// Extension builders
// ---------------------------------------------------------------------------

export function fontSizeExtension(px: number): Extension {
  return EditorView.theme({
    '&': {
      fontSize: `${px}px`,
    },
    '.cm-content': {
      fontFamily: MONO_FONT_FAMILY,
    },
    '.cm-gutters': {
      fontFamily: MONO_FONT_FAMILY,
    },
  });
}

export function wordWrapExtension(enabled: boolean): Extension {
  return enabled ? EditorView.lineWrapping : [];
}

export function lineNumbersExtension(show: boolean): Extension {
  return show ? [lineNumbers(), highlightActiveLineGutter()] : [];
}

// ---------------------------------------------------------------------------
// Base setup — standard extensions shared by every editor instance
// ---------------------------------------------------------------------------

export function baseSetup(): Extension[] {
  return [
    highlightActiveLine(),
    drawSelection(),
    rectangularSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    history(),
    highlightSelectionMatches(),
    foldGutter(),
    EditorState.tabSize.of(2),
    EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': { overflow: 'auto' },
    }),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...foldKeymap,
    ]),
  ];
}
