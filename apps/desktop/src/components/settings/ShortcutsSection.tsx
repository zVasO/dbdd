import { useState, useEffect, useCallback, useRef } from 'react';
import {
  useShortcutStore,
  SHORTCUT_DEFS,
  formatBindingParts,
  bindingFromEvent,
  type ShortcutDef,
  type ShortcutCategory,
  type ShortcutBinding,
} from '@/stores/shortcutStore';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { RotateCcw, AlertTriangle } from 'lucide-react';

type FilterCategory = 'all' | ShortcutCategory;

const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  global: 'Global',
  editor: 'Editor',
  grid: 'Grid',
};

const CATEGORY_COLORS: Record<ShortcutCategory, string> = {
  global: 'bg-primary/15 text-primary',
  editor: 'bg-emerald-500/15 text-emerald-500',
  grid: 'bg-amber-500/15 text-amber-500',
};

export function ShortcutsSection() {
  const [filter, setFilter] = useState<FilterCategory>('all');
  const [search, setSearch] = useState('');
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ShortcutDef | null>(null);
  const [pendingBinding, setPendingBinding] = useState<ShortcutBinding | null>(null);
  const overrides = useShortcutStore((s) => s.overrides);
  const getBinding = useShortcutStore((s) => s.getBinding);
  const setBinding = useShortcutStore((s) => s.setBinding);
  const resetBinding = useShortcutStore((s) => s.resetBinding);
  const resetAll = useShortcutStore((s) => s.resetAll);
  const isModified = useShortcutStore((s) => s.isModified);
  const findConflict = useShortcutStore((s) => s.findConflict);

  const hasAnyOverride = Object.keys(overrides).length > 0;

  const filtered = SHORTCUT_DEFS.filter((def) => {
    if (filter !== 'all' && def.category !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return def.label.toLowerCase().includes(q) || def.id.toLowerCase().includes(q);
    }
    return true;
  });

  // Group by category
  const grouped = filtered.reduce<Record<ShortcutCategory, ShortcutDef[]>>(
    (acc, def) => {
      acc[def.category].push(def);
      return acc;
    },
    { global: [], editor: [], grid: [] }
  );

  const startRecording = (id: string) => {
    setRecordingId(id);
    setConflict(null);
    setPendingBinding(null);
  };

  const cancelRecording = useCallback(() => {
    setRecordingId(null);
    setConflict(null);
    setPendingBinding(null);
  }, []);

  // Global key listener for recording
  useEffect(() => {
    if (!recordingId) return;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        cancelRecording();
        return;
      }

      if (e.key === 'Backspace') {
        // Clear the shortcut
        setBinding(recordingId, { key: '', modifiers: [] });
        cancelRecording();
        return;
      }

      const binding = bindingFromEvent(e);
      if (!binding) return; // Standalone modifier press

      const conflictDef = findConflict(binding, recordingId);
      if (conflictDef) {
        setPendingBinding(binding);
        setConflict(conflictDef);
        return;
      }

      setBinding(recordingId, binding);
      cancelRecording();
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recordingId, cancelRecording, setBinding, findConflict]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
            <p className="text-sm text-muted-foreground">Click on a shortcut to change it. Press Backspace to clear.</p>
          </div>
          {hasAnyOverride && (
            <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={resetAll}>
              <RotateCcw className="size-3" />
              Reset All
            </Button>
          )}
        </div>
        <Separator className="mt-3" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex gap-0.5 border border-border rounded-md overflow-hidden">
          {(['all', 'global', 'editor', 'grid'] as FilterCategory[]).map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`px-2.5 py-1 text-xs transition-colors ${
                filter === cat
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              {cat === 'all' ? 'All' : CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search shortcuts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 h-7 px-2.5 rounded-md bg-muted/50 border border-border text-xs outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Shortcut list */}
      <div className="space-y-5">
        {(['global', 'editor', 'grid'] as ShortcutCategory[]).map((cat) => {
          const defs = grouped[cat];
          if (defs.length === 0) return null;
          return (
            <div key={cat} className="space-y-1">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                {CATEGORY_LABELS[cat]}
              </h3>
              <div className="rounded-lg border border-border overflow-hidden">
                {defs.map((def, i) => (
                  <ShortcutRow
                    key={def.id}
                    def={def}
                    binding={getBinding(def.id)}
                    modified={isModified(def.id)}
                    recording={recordingId === def.id}
                    conflict={recordingId === def.id ? conflict : null}
                    pendingBinding={recordingId === def.id ? pendingBinding : null}
                    onStartRecording={() => startRecording(def.id)}
                    onReset={() => resetBinding(def.id)}
                    isLast={i === defs.length - 1}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-sm text-muted-foreground text-center py-8">
          No shortcuts match "{search}"
        </div>
      )}
    </div>
  );
}

function ShortcutRow({
  def,
  binding,
  modified,
  recording,
  conflict,
  pendingBinding,
  onStartRecording,
  onReset,
  isLast,
}: {
  def: ShortcutDef;
  binding: ShortcutBinding;
  modified: boolean;
  recording: boolean;
  conflict: ShortcutDef | null;
  pendingBinding: ShortcutBinding | null;
  onStartRecording: () => void;
  onReset: () => void;
  isLast: boolean;
}) {
  return (
    <div className={`${!isLast ? 'border-b border-border' : ''}`}>
      <div className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30 transition-colors">
        {/* Action label */}
        <span className="text-xs flex-1">{def.label}</span>

        {/* Category badge */}
        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${CATEGORY_COLORS[def.category]}`}>
          {CATEGORY_LABELS[def.category]}
        </span>

        {/* Shortcut badge / recording */}
        {recording ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center h-6 px-2.5 rounded border border-primary bg-primary/5 text-[10px] font-mono text-primary animate-pulse">
              {pendingBinding ? formatBindingParts(pendingBinding).join(' + ') : 'Press keys...'}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onStartRecording(); /* cancel via Escape */ }}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Esc
            </button>
          </div>
        ) : (
          <button
            onClick={onStartRecording}
            className="group/kbd inline-flex items-center gap-0.5 hover:ring-1 hover:ring-primary/30 rounded transition-all"
          >
            <KbdBadge binding={binding} dimmed={!binding.key} />
          </button>
        )}

        {/* Reset button */}
        {modified && !recording && (
          <button
            onClick={onReset}
            title="Reset to default"
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="size-3" />
          </button>
        )}
        {!modified && !recording && <div className="w-[22px]" />}
      </div>

      {/* Conflict warning */}
      {recording && conflict && (
        <div className="flex items-center gap-1.5 px-3 pb-2 text-[10px] text-destructive">
          <AlertTriangle className="size-3 shrink-0" />
          Already used by "{conflict.label}" — choose a different shortcut
        </div>
      )}
    </div>
  );
}

function KbdBadge({ binding, dimmed }: { binding: ShortcutBinding; dimmed?: boolean }) {
  const parts = formatBindingParts(binding);
  return (
    <span className={`inline-flex items-center gap-0.5 ${dimmed ? 'opacity-40' : ''}`}>
      {parts.map((part, i) => (
        <span key={i} className="flex items-center">
          {i > 0 && <span className="text-[8px] text-muted-foreground mx-0.5">+</span>}
          <kbd className="min-w-[20px] text-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {part}
          </kbd>
        </span>
      ))}
    </span>
  );
}
