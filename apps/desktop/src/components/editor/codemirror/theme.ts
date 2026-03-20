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
 * Read a CSS variable from :root and convert HSL to hex.
 * Handles both `hsl(H S% L%)` and raw `H S% L%` formats.
 */
function cssVarToHex(varName: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  if (!raw) return fallback;

  const hslMatch = raw.match(
    /^(?:hsl\()?\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)?$/,
  );
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]) / 360;
    const s = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;

    const hue2rgb = (p: number, q: number, t: number): number => {
      const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
    const g = Math.round(hue2rgb(p, q, h) * 255);
    const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  if (raw.startsWith('#')) return raw;
  return fallback;
}

/**
 * Build the full VasOdb theme extension for CodeMirror 6.
 *
 * Reads CSS custom properties from :root at call time so the
 * theme stays in sync with the app's light/dark palette.
 */
export function purrqlTheme(isDark: boolean): Extension {
  const bg = cssVarToHex('--background', isDark ? '#1e1e1e' : '#ffffff');
  const fg = cssVarToHex('--foreground', isDark ? '#d4d4d4' : '#1e1e1e');
  const muted = cssVarToHex('--muted', isDark ? '#2d2d2d' : '#f5f5f5');
  const mutedFg = cssVarToHex(
    '--muted-foreground',
    isDark ? '#858585' : '#737373',
  );
  const primary = cssVarToHex('--primary', isDark ? '#569cd6' : '#0070f3');
  const accent = cssVarToHex('--accent', isDark ? '#2d2d2d' : '#f0f0f0');
  const border = cssVarToHex('--border', isDark ? '#3e3e3e' : '#e5e5e5');
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
