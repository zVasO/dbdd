import { EditorView } from '@codemirror/view';
import { Extension, Compartment } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * Compartment for hot-swapping the VasOdb theme
 * without recreating the entire editor instance.
 */
export const themeCompartment = new Compartment();

/**
 * Build the full VasOdb theme extension for CodeMirror 6.
 *
 * Colors are emitted as `var()` references, not resolved values: CodeMirror
 * injects this theme as real stylesheet rules, so the cascade keeps the editor
 * in sync with `.dark` and with user themes on its own. Resolving the tokens in
 * JS instead would mean reimplementing every color space `globals.css` uses.
 */
export function purrqlTheme(isDark: boolean): Extension {
  const bg = 'var(--background)';
  const fg = 'var(--foreground)';
  const muted = 'var(--muted)';
  const mutedFg = 'var(--muted-foreground)';
  const primary = 'var(--primary)';
  const accent = 'var(--accent)';
  const border = 'var(--border)';
  const selection = isDark ? '#264f78' : '#add6ff';
  const stringColor = isDark ? '#ce9178' : '#a31515';
  const numberColor = isDark ? '#b5cea8' : '#098658';

  const editorTheme = EditorView.theme(
    {
      '&': {
        backgroundColor: bg,
        color: fg,
      },
      '.cm-content': {
        caretColor: fg,
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: fg,
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
        backgroundColor: selection,
      },
      '.cm-activeLine': {
        backgroundColor: accent,
      },
      '.cm-gutters': {
        backgroundColor: bg,
        color: mutedFg,
        borderRight: `1px solid ${border}`,
      },
      '.cm-activeLineGutter': {
        backgroundColor: accent,
      },
      '.cm-selectionMatch': {
        backgroundColor: muted,
      },
      '.cm-panels': {
        backgroundColor: bg,
        color: fg,
      },
      '.cm-panels.cm-panels-top': {
        borderBottom: `1px solid ${border}`,
      },
      '.cm-panels.cm-panels-bottom': {
        borderTop: `1px solid ${border}`,
      },
      '.cm-tooltip': {
        backgroundColor: bg,
        border: `1px solid ${border}`,
        color: fg,
      },
      '.cm-tooltip-autocomplete': {
        '& > ul > li[aria-selected]': {
          backgroundColor: accent,
        },
      },
    },
    { dark: isDark },
  );

  const highlighting = HighlightStyle.define([
    { tag: tags.keyword, color: primary, fontWeight: 'bold' },
    { tag: tags.comment, color: mutedFg, fontStyle: 'italic' },
    { tag: tags.string, color: stringColor },
    { tag: tags.number, color: numberColor },
    { tag: tags.operator, color: fg },
    { tag: tags.typeName, color: primary },
  ]);

  return [editorTheme, syntaxHighlighting(highlighting)];
}
