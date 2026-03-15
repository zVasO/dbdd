// SQL autocomplete provider for CodeMirror 6
// Adapts the Monaco completion logic to CM6's CompletionContext API

import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { useSchemaStore } from '@/stores/schemaStore';
import { getFuzzySearchBridge, type SearchContext } from '@/lib/fuzzy-search-bridge';
import {
  detectSqlContext,
  parseAliases,
  SQL_KEYWORDS,
  SQL_FUNCTIONS,
  SQL_TYPES,
  CLAUSE_SNIPPETS,
  type SqlContext,
} from './sql-context';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip Monaco-style snippet placeholders from insert text (e.g. `${1:foo}` -> `foo`). */
function stripSnippetPlaceholders(text: string): string {
  return text.replace(/\$\{\d+:([^}]*)}/g, '$1');
}

/** Map SqlContext to a CM6 completion `type` string for visual styling. */
function completionTypeForItem(itemType: 'table' | 'column'): string {
  return itemType === 'table' ? 'class' : 'property';
}

// ---------------------------------------------------------------------------
// Main completer
// ---------------------------------------------------------------------------

export async function purrqlSqlCompleter(
  ctx: CompletionContext,
): Promise<CompletionResult | null> {
  const word = ctx.matchBefore(/\w*/);
  if (!word) return null;

  const currentWord = word.text;
  const from = word.from;

  // Grab the character just before the matched word to detect dot completion
  const charBeforeWord = from > 0 ? ctx.state.doc.sliceString(from - 1, from) : '';

  // --- DOT COMPLETION: table.column or alias.column ---
  if (charBeforeWord === '.') {
    const textBeforeDot = ctx.state.doc.sliceString(0, from - 1);
    const tableMatch = textBeforeDot.match(/(\w+)\s*$/);

    if (tableMatch) {
      const prefix = tableMatch[1].toLowerCase();
      const fullText = ctx.state.doc.toString();
      const aliases = parseAliases(fullText);
      const resolvedTable = aliases[prefix] || prefix;
      const options: Completion[] = [];

      if (currentWord) {
        // User typed something after dot — fuzzy search columns
        const bridge = getFuzzySearchBridge();
        const results = await bridge.search(currentWord, 'after_table', {
          resolvedTable,
          limit: 50,
        });
        for (const item of results) {
          options.push({
            label: item.name,
            type: 'property',
            detail: `${item.columnType ?? ''} — ${item.table ?? ''}`,
            boost: item.score,
          });
        }
      } else {
        // Just typed dot — show all columns from schema store
        const schemaState = useSchemaStore.getState();
        for (const structure of Object.values(schemaState.structures)) {
          if (structure.table_ref.table.toLowerCase() === resolvedTable) {
            for (let i = 0; i < structure.columns.length; i++) {
              const col = structure.columns[i];
              options.push({
                label: col.name,
                type: 'property',
                detail: `${col.data_type} — ${structure.table_ref.table}`,
                boost: 100 - i,
              });
            }
            break;
          }
        }
      }

      return options.length > 0 ? { from, options } : null;
    }
  }

  // If not explicit and nothing typed and no dot, bail out
  if (!ctx.explicit && currentWord.length === 0) {
    return null;
  }

  // --- CONTEXT-AWARE COMPLETION ---
  const textBeforeCursor = ctx.state.doc.sliceString(0, from);
  const sqlContext: SqlContext = detectSqlContext(textBeforeCursor);
  const options: Completion[] = [];

  // Map SqlContext to SearchContext for the bridge
  const bridgeContext: SearchContext = sqlContext as SearchContext;

  // Fuzzy search schema items when user has typed >= 2 chars
  if (currentWord.length >= 2) {
    const bridge = getFuzzySearchBridge();
    const results = await bridge.search(currentWord, bridgeContext, { limit: 50 });
    for (const item of results) {
      options.push({
        label: item.name,
        type: completionTypeForItem(item.type),
        detail: item.type === 'table'
          ? `Table — ${item.database ?? ''}`
          : `${item.columnType ?? ''} — ${item.table ?? ''}`,
        boost: item.score,
      });
    }
  }

  // --- Static suggestions ---

  // In DDL context: types + DDL keywords, then return early
  if (sqlContext === 'ddl') {
    for (const t of SQL_TYPES) {
      options.push({
        label: t,
        type: 'type',
        detail: 'Data type',
        boost: -10,
      });
    }
    for (const kw of ['TABLE', 'INDEX', 'VIEW', 'DATABASE', 'SCHEMA', 'COLUMN']) {
      options.push({
        label: kw,
        type: 'keyword',
        boost: -11,
      });
    }
    return options.length > 0 ? { from, options } : null;
  }

  // In column contexts: add functions
  const isColumnCtx =
    sqlContext === 'select' ||
    sqlContext === 'condition' ||
    sqlContext === 'order_group' ||
    sqlContext === 'set';

  if (isColumnCtx) {
    for (const fn of SQL_FUNCTIONS) {
      options.push({
        label: fn.label,
        type: 'function',
        detail: fn.detail,
        apply: fn.label + '()',
        boost: -10,
      });
    }
  }

  // Clause snippets
  const clauseBoost = sqlContext === 'after_table' ? -5 : -12;
  for (const cs of CLAUSE_SNIPPETS) {
    options.push({
      label: cs.label,
      type: 'keyword',
      detail: cs.detail,
      apply: stripSnippetPlaceholders(cs.insertText),
      boost: clauseBoost,
    });
  }

  // Keywords
  for (const kw of SQL_KEYWORDS) {
    options.push({
      label: kw,
      type: 'keyword',
      boost: -13,
    });
  }

  return options.length > 0 ? { from, options } : null;
}
