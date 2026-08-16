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
  const mutedFg = 'var(--muted-foreground)';
  const primary = 'var(--primary)';
  const border = 'var(--border)';
  const selection = 'color-mix(in oklab, var(--primary) 24%, transparent)';
  const activeLine = 'color-mix(in oklab, var(--foreground) 5%, transparent)';
  const matchBg = 'color-mix(in oklab, var(--primary) 14%, transparent)';
  const stringColor = isDark ? 'oklch(0.76 0.11 145)' : 'oklch(0.45 0.11 145)';
  const numberColor = isDark ? 'oklch(0.78 0.10 80)' : 'oklch(0.52 0.12 65)';
  const keywordColor = primary;

  const editorTheme = EditorView.theme(
    {
      '&': {
        backgroundColor: bg,
        color: fg,
        height: '100%',
      },
      '&.cm-focused': {
        outline: 'none',
      },
      '.cm-content': {
        caretColor: primary,
        padding: '8px 0',
      },
      '.cm-line': {
        padding: '0 12px',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: primary,
        borderLeftWidth: '2px',
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
        backgroundColor: selection,
      },
      '.cm-activeLine': {
        backgroundColor: activeLine,
      },
      '.cm-activeLineGutter': {
        backgroundColor: activeLine,
      },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        color: mutedFg,
        border: 'none',
        paddingLeft: '4px',
      },
      '.cm-selectionMatch, .cm-searchMatch': {
        backgroundColor: matchBg,
      },
      '.cm-searchMatch-selected': {
        backgroundColor: selection,
      },
      '&.cm-focused .cm-matchingBracket': {
        backgroundColor: matchBg,
        outline: `1px solid ${border}`,
      },
      '.cm-panels': {
        backgroundColor: 'var(--popover, var(--background))',
        color: fg,
      },
      '.cm-panels.cm-panels-top': {
        borderBottom: `1px solid ${border}`,
      },
      '.cm-panels.cm-panels-bottom': {
        borderTop: `1px solid ${border}`,
      },
      '.cm-tooltip': {
        backgroundColor: 'var(--popover, var(--background))',
        border: `1px solid ${border}`,
        borderRadius: 'calc(var(--radius) - 8px)',
        color: fg,
      },
      '.cm-tooltip-autocomplete': {
        '& > ul > li[aria-selected]': {
          backgroundColor: selection,
          color: fg,
        },
      },
      '.cm-placeholder': {
        color: mutedFg,
      },
    },
    { dark: isDark },
  );

  const highlighting = HighlightStyle.define([
    { tag: tags.keyword, color: keywordColor, fontWeight: 'bold' },
    { tag: tags.comment, color: mutedFg, fontStyle: 'italic' },
    { tag: tags.string, color: stringColor },
    { tag: tags.number, color: numberColor },
    { tag: tags.operator, color: fg },
    { tag: tags.typeName, color: keywordColor },
    // lang-sql tags builtins (e.g. COUNT, NOW) as standard(name), not
    // function(variableName) — that lezer tag never fires for this grammar.
    { tag: tags.standard(tags.name), color: keywordColor },
    { tag: tags.propertyName, color: fg },
  ]);

  return [editorTheme, syntaxHighlighting(highlighting)];
}
