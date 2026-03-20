import { useEffect, useRef } from 'react';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
import { autocompletion, acceptCompletion } from '@codemirror/autocomplete';
import { keymap } from '@codemirror/view';

import {
  baseSetup,
  lineNumbersCompartment,
  fontSizeCompartment,
  wordWrapCompartment,
  fontSizeExtension,
  lineNumbersExtension,
  wordWrapExtension,
} from './codemirror/setup';
import { themeCompartment, purrqlTheme } from './codemirror/theme';
import { purrqlKeybindings } from './codemirror/keybindings';
import { purrqlSqlCompleter } from './codemirror/sql-completion';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useThemeStore } from '@/stores/themeStore';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  value: string;
  onChange: (value: string) => void;
  onExecute: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 150;
const THEME_SWITCH_DELAY_MS = 50;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CodemirrorEditor({ value, onChange, onExecute }: Props) {
  // --- Store subscriptions ---
  const fontSize = usePreferencesStore((s) => s.editorFontSize);
  const showLineNumbers = usePreferencesStore((s) => s.editorShowLineNumbers);
  const wordWrap = usePreferencesStore((s) => s.editorWordWrap);
  const isDark = useThemeStore((s) => {
    const t = s.themes.find((theme) => theme.id === s.activeThemeId);
    return t?.isDark ?? true;
  });
  const activeThemeId = useThemeStore((s) => s.activeThemeId);

  // --- Refs ---
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastExternalValueRef = useRef(value);

  // Stable callback refs to avoid stale closures inside CM6 listeners
  const onChangeRef = useRef(onChange);
  const onExecuteRef = useRef(onExecute);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onExecuteRef.current = onExecute; }, [onExecute]);

  // --- Format handler (shared between keybinding and DOM event) ---
  const formatRef = useRef(async () => {
    const view = viewRef.current;
    if (!view) return;
    try {
      const { format } = await import('sql-formatter');
      const formatted = format(view.state.doc.toString(), {
        language: 'sql',
        tabWidth: 2,
        keywordCase: 'upper',
      });
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: formatted },
      });
      onChangeRef.current(formatted);
      lastExternalValueRef.current = formatted;
    } catch {
      // formatting failed — silently ignore
    }
  });

  // --- Execute handler: flush debounce, sync doc, then call onExecute ---
  const executeRef = useRef(() => {
    const view = viewRef.current;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (view) {
      const currentDoc = view.state.doc.toString();
      lastExternalValueRef.current = currentDoc;
      onChangeRef.current(currentDoc);
    }
    onExecuteRef.current();
  });

  // --- Mount: create EditorView ---
  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        ...baseSetup(),
        lineNumbersCompartment.of(lineNumbersExtension(showLineNumbers)),
        fontSizeCompartment.of(fontSizeExtension(fontSize)),
        wordWrapCompartment.of(wordWrapExtension(wordWrap)),
        themeCompartment.of(purrqlTheme(isDark)),
        sql({ dialect: PostgreSQL }),
        autocompletion({
          override: [purrqlSqlCompleter],
          activateOnTyping: true,
          maxRenderedOptions: 50,
        }),
        keymap.of([{ key: 'Tab', run: acceptCompletion }]),
        purrqlKeybindings({
          onExecute: () => executeRef.current(),
          onFormat: () => { void formatRef.current(); },
        }),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (!update.docChanged) return;
          const doc = update.state.doc.toString();
          lastExternalValueRef.current = doc;
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            onChangeRef.current(doc);
          }, DEBOUNCE_MS);
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      // Flush pending debounce on unmount
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        const finalDoc = view.state.doc.toString();
        onChangeRef.current(finalDoc);
      }
      view.destroy();
      viewRef.current = null;
    };
    // Mount once — all dynamic values are handled via compartment reconfiguration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- External value sync (tab switch, file load) ---
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (value === lastExternalValueRef.current) return;
    lastExternalValueRef.current = value;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  }, [value]);

  // --- Theme switching ---
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // Small delay to let CSS variables update on DOM first
    const timer = setTimeout(() => {
      view.dispatch({
        effects: themeCompartment.reconfigure(purrqlTheme(isDark)),
      });
    }, THEME_SWITCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isDark, activeThemeId]);

  // --- Preference reconfiguration: font size ---
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: fontSizeCompartment.reconfigure(fontSizeExtension(fontSize)),
    });
  }, [fontSize]);

  // --- Preference reconfiguration: line numbers ---
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: lineNumbersCompartment.reconfigure(
        lineNumbersExtension(showLineNumbers),
      ),
    });
  }, [showLineNumbers]);

  // --- Preference reconfiguration: word wrap ---
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wordWrapCompartment.reconfigure(
        wordWrapExtension(wordWrap),
      ),
    });
  }, [wordWrap]);

  // --- Format event listener (toolbar button) ---
  useEffect(() => {
    const handler = () => { void formatRef.current(); };
    document.addEventListener('vasodb:format', handler);
    return () => document.removeEventListener('vasodb:format', handler);
  }, []);

  return <div ref={containerRef} className="h-full" />;
}
