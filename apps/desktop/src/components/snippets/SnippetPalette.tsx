import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { Search, Code, Tag, Plus, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useSnippetStore, type Snippet } from '@/stores/snippetStore';
import { SnippetEditor } from '@/components/snippets/SnippetEditor';

interface SnippetPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (sql: string) => void;
}

function fuzzyMatch(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

function fuzzyScore(text: string, query: string): number {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  // Exact start match is best
  if (lower.startsWith(q)) return 3;
  // Contains is good
  if (lower.includes(q)) return 2;
  // Fuzzy match
  if (fuzzyMatch(text, query)) return 1;
  return 0;
}

export function SnippetPalette({
  open,
  onOpenChange,
  onInsert,
}: SnippetPaletteProps) {
  const pushModal = useUIStore((s) => s.pushModal);
  const popModal = useUIStore((s) => s.popModal);

  // Register modal when open
  useEffect(() => {
    if (open) {
      pushModal('snippetPalette');
      return () => popModal('snippetPalette');
    }
  }, [open, pushModal, popModal]);

  const { snippets, deleteSnippet } = useSnippetStore();
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [variablePrompt, setVariablePrompt] = useState<{
    snippet: Snippet;
    values: Record<string, string>;
  } | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return snippets;

    return snippets
      .map((s) => {
        const nameScore = fuzzyScore(s.name, search);
        const descScore = fuzzyScore(s.description, search);
        const tagScore = s.tags.some((t) => fuzzyMatch(t, search)) ? 1 : 0;
        const sqlScore = s.sql.toLowerCase().includes(search.toLowerCase())
          ? 1
          : 0;
        const total = nameScore * 3 + descScore * 2 + tagScore + sqlScore;
        return { snippet: s, score: total };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.snippet);
  }, [snippets, search]);

  // Reset selection when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length, search]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setSearch('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSelectSnippet = useCallback(
    (snippet: Snippet) => {
      if (snippet.variables.length > 0) {
        const initialValues: Record<string, string> = {};
        for (const v of snippet.variables) {
          initialValues[v] = '';
        }
        setVariablePrompt({ snippet, values: initialValues });
      } else {
        onInsert(snippet.sql);
        onOpenChange(false);
      }
    },
    [onInsert, onOpenChange],
  );

  const handleInsertWithVariables = useCallback(() => {
    if (!variablePrompt) return;

    let resolvedSql = variablePrompt.snippet.sql;
    for (const [varName, value] of Object.entries(variablePrompt.values)) {
      resolvedSql = resolvedSql.replaceAll(varName, value || varName);
    }

    onInsert(resolvedSql);
    setVariablePrompt(null);
    onOpenChange(false);
  }, [variablePrompt, onInsert, onOpenChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          handleSelectSnippet(filtered[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
      }
    },
    [filtered, selectedIndex, handleSelectSnippet, onOpenChange],
  );

  const handleEdit = useCallback(
    (snippet: Snippet, e: React.MouseEvent) => {
      e.stopPropagation();
      setEditingSnippet(snippet);
      setEditorOpen(true);
    },
    [],
  );

  const handleDelete = useCallback(
    (snippetId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      deleteSnippet(snippetId);
    },
    [deleteSnippet],
  );

  const handleCreateNew = useCallback(() => {
    setEditingSnippet(null);
    setEditorOpen(true);
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.querySelector(
        `[data-index="${selectedIndex}"]`,
      );
      selectedEl?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  return (
    <>
      <Dialog open={open && !variablePrompt && !editorOpen} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px] p-0 gap-0">
          {/* Search input */}
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="size-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search snippets..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <Button
              size="xs"
              variant="ghost"
              onClick={handleCreateNew}
              title="New snippet"
            >
              <Plus className="size-3.5" />
            </Button>
          </div>

          {/* Results list */}
          <ScrollArea className="max-h-[360px]">
            <div ref={listRef} className="py-1">
              {filtered.length === 0 && (
                <div className="text-muted-foreground text-sm text-center py-6 px-4">
                  {snippets.length === 0
                    ? 'No snippets yet. Click + to create one.'
                    : 'No matching snippets found.'}
                </div>
              )}

              {filtered.map((snippet, idx) => (
                <div
                  key={snippet.id}
                  data-index={idx}
                  className={cn(
                    'flex items-start gap-3 px-3 py-2 cursor-pointer',
                    idx === selectedIndex && 'bg-accent',
                  )}
                  onClick={() => handleSelectSnippet(snippet)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <Code className="size-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {snippet.name}
                      </span>
                      {snippet.variables.length > 0 && (
                        <Badge
                          variant="outline"
                          className="text-[10px] shrink-0"
                        >
                          {snippet.variables.length} var
                          {snippet.variables.length !== 1 ? 's' : ''}
                        </Badge>
                      )}
                    </div>
                    {snippet.description && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {snippet.description}
                      </p>
                    )}
                    <p className="text-xs font-mono text-muted-foreground truncate mt-0.5">
                      {snippet.sql.slice(0, 80)}
                      {snippet.sql.length > 80 ? '...' : ''}
                    </p>
                    {snippet.tags.length > 0 && (
                      <div className="flex items-center gap-1 mt-1">
                        <Tag className="size-3 text-muted-foreground" />
                        {snippet.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      className="p-1 rounded-sm hover:bg-accent-foreground/10"
                      onClick={(e) => handleEdit(snippet, e)}
                      title="Edit"
                    >
                      <Pencil className="size-3 text-muted-foreground" />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded-sm hover:bg-destructive/10"
                      onClick={(e) => handleDelete(snippet.id, e)}
                      title="Delete"
                    >
                      <Trash2 className="size-3 text-muted-foreground" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* Footer hint */}
          {filtered.length > 0 && (
            <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground flex items-center gap-3">
              <span>
                <kbd className="px-1 rounded border bg-muted text-[10px]">Up</kbd>{' '}
                <kbd className="px-1 rounded border bg-muted text-[10px]">Down</kbd> navigate
              </span>
              <span>
                <kbd className="px-1 rounded border bg-muted text-[10px]">Enter</kbd> insert
              </span>
              <span>
                <kbd className="px-1 rounded border bg-muted text-[10px]">Esc</kbd> close
              </span>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Variable prompt dialog */}
      {variablePrompt && (
        <Dialog
          open={!!variablePrompt}
          onOpenChange={(val) => {
            if (!val) setVariablePrompt(null);
          }}
        >
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Fill Variables</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Provide values for the variables in "{variablePrompt.snippet.name}":
              </p>
              {variablePrompt.snippet.variables.map((varName) => (
                <div key={varName} className="flex flex-col gap-1.5">
                  <Label className="font-mono text-xs">{varName}</Label>
                  <Input
                    value={variablePrompt.values[varName] ?? ''}
                    onChange={(e) =>
                      setVariablePrompt((prev) =>
                        prev
                          ? {
                              ...prev,
                              values: {
                                ...prev.values,
                                [varName]: e.target.value,
                              },
                            }
                          : null,
                      )
                    }
                    placeholder={`Value for ${varName}`}
                    className="font-mono"
                  />
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setVariablePrompt(null)}>
                Cancel
              </Button>
              <Button onClick={handleInsertWithVariables}>Insert</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Snippet editor dialog */}
      <SnippetEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        snippet={editingSnippet}
      />
    </>
  );
}
