# Phase 1.1 — Safe Mode & Commit Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a pending-changes buffer so that all GUI data modifications (cell edits, row inserts, row deletes) remain local until the user explicitly commits them, with code preview, discard, undo/redo, and visual diff indicators.

**Architecture:** A new `changeStore` (Zustand) holds a queue of pending `Change` objects per table. The DataGrid reads from this store to overlay pending changes on top of query results. Commit sends a batch of SQL statements via a new `execute_batch` Tauri command. No Rust-side changes needed for safe mode levels (frontend-only UX gates).

**Tech Stack:** Zustand, React, TypeScript, Tauri IPC, Rust (one new command)

---

## Task 1: Create the Change Store

**Files:**
- Create: `apps/desktop/src/stores/changeStore.ts`

**Step 1: Create the store file**

```typescript
// apps/desktop/src/stores/changeStore.ts
import { create } from 'zustand';

export type CellValue = string | number | boolean | null;

export interface CellEdit {
  type: 'edit';
  id: string;
  table: string;
  database: string;
  rowIndex: number;
  primaryKeys: Record<string, CellValue>;
  column: string;
  oldValue: CellValue;
  newValue: CellValue;
}

export interface RowInsert {
  type: 'insert';
  id: string;
  table: string;
  database: string;
  values: Record<string, CellValue>;
}

export interface RowDelete {
  type: 'delete';
  id: string;
  table: string;
  database: string;
  rowIndex: number;
  primaryKeys: Record<string, CellValue>;
  originalRow: Record<string, CellValue>;
}

export type Change = CellEdit | RowInsert | RowDelete;

export type SafeModeLevel = 'silent' | 'alert' | 'alert_select' | 'password' | 'password_select';

interface ChangeState {
  pending: Change[];
  undone: Change[];
  safeModeLevel: SafeModeLevel;
  previewOpen: boolean;

  addChange: (change: Omit<Change, 'id'>) => void;
  undo: () => void;
  redo: () => void;
  discard: () => void;
  discardByTable: (database: string, table: string) => void;
  removeChange: (id: string) => void;
  setPreviewOpen: (open: boolean) => void;
  setSafeModeLevel: (level: SafeModeLevel) => void;

  getPendingForTable: (database: string, table: string) => Change[];
  generateSql: () => string[];
  hasPendingChanges: () => boolean;
  pendingCount: () => number;
}

export const useChangeStore = create<ChangeState>((set, get) => ({
  pending: [],
  undone: [],
  safeModeLevel: 'alert_select',
  previewOpen: false,

  addChange: (change) => {
    const id = crypto.randomUUID();
    const fullChange = { ...change, id } as Change;

    set((s) => {
      // If editing the same cell again, replace the previous edit
      if (change.type === 'edit') {
        const existing = s.pending.find(
          (c) =>
            c.type === 'edit' &&
            c.table === change.table &&
            c.database === change.database &&
            c.column === change.column &&
            JSON.stringify(c.primaryKeys) === JSON.stringify(change.primaryKeys)
        );
        if (existing) {
          // If reverting to original value, remove the change
          if (change.newValue === (existing as CellEdit).oldValue) {
            return {
              pending: s.pending.filter((c) => c.id !== existing.id),
              undone: [],
            };
          }
          return {
            pending: s.pending.map((c) =>
              c.id === existing.id ? { ...fullChange, id: existing.id, oldValue: (existing as CellEdit).oldValue } as CellEdit : c
            ),
            undone: [],
          };
        }
      }
      return { pending: [...s.pending, fullChange], undone: [] };
    });
  },

  undo: () => {
    set((s) => {
      if (s.pending.length === 0) return s;
      const last = s.pending[s.pending.length - 1];
      return {
        pending: s.pending.slice(0, -1),
        undone: [...s.undone, last],
      };
    });
  },

  redo: () => {
    set((s) => {
      if (s.undone.length === 0) return s;
      const last = s.undone[s.undone.length - 1];
      return {
        pending: [...s.pending, last],
        undone: s.undone.slice(0, -1),
      };
    });
  },

  discard: () => set({ pending: [], undone: [] }),

  discardByTable: (database, table) => {
    set((s) => ({
      pending: s.pending.filter((c) => !(c.database === database && c.table === table)),
      undone: [],
    }));
  },

  removeChange: (id) => {
    set((s) => ({ pending: s.pending.filter((c) => c.id !== id) }));
  },

  setPreviewOpen: (open) => set({ previewOpen: open }),
  setSafeModeLevel: (level) => set({ safeModeLevel: level }),

  getPendingForTable: (database, table) => {
    return get().pending.filter((c) => c.database === database && c.table === table);
  },

  generateSql: () => {
    const { pending } = get();
    return pending.map((change) => {
      switch (change.type) {
        case 'edit': {
          const setClauses = `\`${change.column}\` = ${sqlValue(change.newValue)}`;
          const whereClauses = Object.entries(change.primaryKeys)
            .map(([col, val]) => `\`${col}\` = ${sqlValue(val)}`)
            .join(' AND ');
          return `UPDATE \`${change.table}\` SET ${setClauses} WHERE ${whereClauses};`;
        }
        case 'insert': {
          const cols = Object.keys(change.values).map((c) => `\`${c}\``).join(', ');
          const vals = Object.values(change.values).map(sqlValue).join(', ');
          return `INSERT INTO \`${change.table}\` (${cols}) VALUES (${vals});`;
        }
        case 'delete': {
          const whereClauses = Object.entries(change.primaryKeys)
            .map(([col, val]) => `\`${col}\` = ${sqlValue(val)}`)
            .join(' AND ');
          return `DELETE FROM \`${change.table}\` WHERE ${whereClauses};`;
        }
      }
    });
  },

  hasPendingChanges: () => get().pending.length > 0,
  pendingCount: () => get().pending.length,
}));

function sqlValue(val: CellValue): string {
  if (val === null) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  return `'${String(val).replace(/'/g, "''")}'`;
}
```

**Step 2: Verify the file compiles**

Run: `cd apps/desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to changeStore.ts

**Step 3: Commit**

```bash
git add apps/desktop/src/stores/changeStore.ts
git commit -m "feat: add changeStore for pending changes buffer (safe mode foundation)"
```

---

## Task 2: Add execute_batch Tauri Command

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/query.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src/lib/ipc.ts`

**Step 1: Add the Rust command**

Append to `apps/desktop/src-tauri/src/commands/query.rs`:

```rust
#[tauri::command]
pub async fn execute_batch(
    state: State<'_, AppState>,
    connection_id: Uuid,
    statements: Vec<String>,
) -> Result<Vec<Result<QueryResult, String>>, String> {
    let active = state
        .connection_manager
        .get(&connection_id)
        .ok_or("Connection not found")?;

    let mut results = Vec::new();
    for sql in &statements {
        match active.connection.execute(sql).await {
            Ok(result) => results.push(Ok(result)),
            Err(e) => results.push(Err(e.to_string())),
        }
    }
    Ok(results)
}
```

**Step 2: Register the command in lib.rs**

In `apps/desktop/src-tauri/src/lib.rs`, add `commands::query::execute_batch` to the `.invoke_handler(tauri::generate_handler![...])` list.

**Step 3: Add IPC wrapper**

Append to `apps/desktop/src/lib/ipc.ts`:

```typescript
async executeBatch(connectionId: string, statements: string[]): Promise<Array<QueryResult | string>> {
  return invoke<Array<QueryResult | string>>('execute_batch', {
    connectionId,
    statements,
  });
},
```

**Step 4: Verify Rust compiles**

Run: `cd apps/desktop/src-tauri && cargo check 2>&1 | tail -5`
Expected: `Finished` with no errors

**Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/query.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src/lib/ipc.ts
git commit -m "feat: add execute_batch Tauri command for committing pending changes"
```

---

## Task 3: Add Commit/Discard/Preview Toolbar Buttons

**Files:**
- Modify: `apps/desktop/src/components/editor/EditorToolbar.tsx`

**Step 1: Update EditorToolbar**

Replace the content of `apps/desktop/src/components/editor/EditorToolbar.tsx` with:

```typescript
import { useChangeStore } from '@/stores/changeStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { ipc } from '@/lib/ipc';
import { useQueryStore } from '@/stores/queryStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { Play, Save, Eye, Undo2, Redo2, Trash2, Loader2 } from 'lucide-react';
import { useState } from 'react';

interface Props {
  isExecuting: boolean;
  onRun: () => void;
}

export function EditorToolbar({ isExecuting, onRun }: Props) {
  const pendingCount = useChangeStore((s) => s.pendingCount());
  const hasPending = useChangeStore((s) => s.hasPendingChanges());
  const undo = useChangeStore((s) => s.undo);
  const redo = useChangeStore((s) => s.redo);
  const discard = useChangeStore((s) => s.discard);
  const setPreviewOpen = useChangeStore((s) => s.setPreviewOpen);
  const generateSql = useChangeStore((s) => s.generateSql);
  const clearPending = useChangeStore((s) => s.discard);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const [isCommitting, setIsCommitting] = useState(false);

  const handleCommit = async () => {
    if (!activeConnectionId || !hasPending) return;
    setIsCommitting(true);
    try {
      const statements = generateSql();
      await ipc.executeBatch(activeConnectionId, statements);
      clearPending();
      // Re-execute the active query to refresh the grid
      const { activeTabId, executeQuery } = useQueryStore.getState();
      if (activeTabId) {
        executeQuery(activeConnectionId, activeTabId);
      }
    } catch (err) {
      console.error('Commit failed:', err);
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex items-center gap-1 border-b border-border bg-muted px-2"
        style={{ height: 'var(--toolbar-height)' }}
      >
        {/* Run button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              onClick={onRun}
              disabled={isExecuting}
              className="gap-1.5 text-xs"
            >
              {isExecuting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Run
            </Button>
          </TooltipTrigger>
          <TooltipContent>Run query (Ctrl+Enter)</TooltipContent>
        </Tooltip>

        <div className="mx-1 h-4 w-px bg-border" />

        {/* Undo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-xs" variant="ghost" onClick={undo} className="h-7 w-7">
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
        </Tooltip>

        {/* Redo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-xs" variant="ghost" onClick={redo} className="h-7 w-7">
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo (Ctrl+Shift+Z)</TooltipContent>
        </Tooltip>

        <div className="flex-1" />

        {/* Pending changes indicator + actions */}
        {hasPending && (
          <div className="flex items-center gap-1">
            <Badge variant="secondary" className="gap-1 text-[10px]">
              {pendingCount} pending
            </Badge>

            {/* Preview SQL */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPreviewOpen(true)}
                  className="gap-1 text-xs"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Preview
                </Button>
              </TooltipTrigger>
              <TooltipContent>Preview SQL (Ctrl+Shift+P)</TooltipContent>
            </Tooltip>

            {/* Discard */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={discard}
                  className="gap-1 text-xs text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Discard
                </Button>
              </TooltipTrigger>
              <TooltipContent>Discard all changes (Ctrl+Shift+Del)</TooltipContent>
            </Tooltip>

            {/* Commit */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={handleCommit}
                  disabled={isCommitting}
                  className="gap-1 text-xs"
                >
                  {isCommitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  Commit
                </Button>
              </TooltipTrigger>
              <TooltipContent>Commit changes (Ctrl+S)</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd apps/desktop && npx tsc --noEmit --pretty 2>&1 | head -20`

**Step 3: Commit**

```bash
git add apps/desktop/src/components/editor/EditorToolbar.tsx
git commit -m "feat: add commit/discard/preview/undo/redo buttons to editor toolbar"
```

---

## Task 4: Code Preview Dialog

**Files:**
- Create: `apps/desktop/src/components/editor/CodePreview.tsx`
- Modify: `apps/desktop/src/components/layout/PanelLayout.tsx`

**Step 1: Install missing shadcn component if needed**

Run: `cd apps/desktop && npx shadcn@latest add dialog --yes` (should already exist)

**Step 2: Create CodePreview component**

```typescript
// apps/desktop/src/components/editor/CodePreview.tsx
import { useChangeStore } from '@/stores/changeStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Copy, Check } from 'lucide-react';
import { useState } from 'react';

export function CodePreview() {
  const previewOpen = useChangeStore((s) => s.previewOpen);
  const setPreviewOpen = useChangeStore((s) => s.setPreviewOpen);
  const generateSql = useChangeStore((s) => s.generateSql);
  const pendingCount = useChangeStore((s) => s.pendingCount());
  const [copied, setCopied] = useState(false);

  const statements = previewOpen ? generateSql() : [];
  const fullSql = statements.join('\n');

  const handleCopy = () => {
    navigator.clipboard.writeText(fullSql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pending Changes Preview</DialogTitle>
          <DialogDescription>
            {pendingCount} statement{pendingCount !== 1 ? 's' : ''} will be executed on commit.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[400px]">
          <pre className="rounded-md bg-muted p-4 text-xs font-mono leading-relaxed">
            {fullSql || 'No pending changes.'}
          </pre>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy SQL'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 3: Add CodePreview to PanelLayout**

In `apps/desktop/src/components/layout/PanelLayout.tsx`, add at the top:

```typescript
import { CodePreview } from '@/components/editor/CodePreview';
```

And render `<CodePreview />` inside the PanelLayout return, just before the closing `</div>`.

**Step 4: Commit**

```bash
git add apps/desktop/src/components/editor/CodePreview.tsx apps/desktop/src/components/layout/PanelLayout.tsx
git commit -m "feat: add SQL code preview dialog for pending changes"
```

---

## Task 5: Wire DataGrid Inline Editing to changeStore

**Files:**
- Modify: `apps/desktop/src/components/grid/DataGrid.tsx`

This is the most complex task. The DataGrid currently has `commitEdit()` which does nothing useful. We need to:

1. Accept `database` and `table` props (so the grid knows which table it's showing)
2. On `commitEdit()`, push a `CellEdit` change to `changeStore`
3. Overlay visual indicators: modified cells get a colored background
4. Add row insert / row delete buttons that push to `changeStore`

**Step 1: Update DataGrid props and add changeStore integration**

At the top of `DataGrid.tsx`, add imports:

```typescript
import { useChangeStore } from '@/stores/changeStore';
import type { CellEdit, RowDelete } from '@/stores/changeStore';
```

Add new props to the DataGrid:

```typescript
interface DataGridProps {
  result: QueryResult;
  database?: string;
  table?: string;
}
```

Inside the component, connect to the changeStore:

```typescript
const addChange = useChangeStore((s) => s.addChange);
const getPendingForTable = useChangeStore((s) => s.getPendingForTable);
const pendingChanges = database && table ? getPendingForTable(database, table) : [];
```

**Step 2: Update commitEdit to push changes**

Replace the existing `commitEdit` function body:

```typescript
const commitEdit = useCallback(() => {
  if (!editingCell || !database || !table) {
    setEditingCell(null);
    return;
  }

  const { rowIndex, colIndex } = editingCell;
  const row = result.rows[rowIndex];
  const column = result.columns[colIndex];
  const oldValue = formatCellValue(row[colIndex]);
  const newValue = editValue;

  if (oldValue === newValue) {
    setEditingCell(null);
    return;
  }

  // Build primary key map
  const primaryKeys: Record<string, any> = {};
  result.columns.forEach((col, i) => {
    if (col.is_primary_key) {
      primaryKeys[col.name] = formatCellValue(row[i]);
    }
  });

  if (Object.keys(primaryKeys).length === 0) {
    // No primary key — can't safely update
    setEditingCell(null);
    return;
  }

  addChange({
    type: 'edit',
    table,
    database,
    rowIndex,
    primaryKeys,
    column: column.name,
    oldValue,
    newValue,
  });

  setEditingCell(null);
}, [editingCell, editValue, result, database, table, addChange]);
```

**Step 3: Add visual diff indicators for modified cells**

In the cell rendering section, add a helper to check if a cell has a pending edit:

```typescript
const getCellPendingEdit = (rowIndex: number, colName: string) => {
  return pendingChanges.find(
    (c) => c.type === 'edit' && c.rowIndex === rowIndex && c.column === colName
  );
};
```

In the cell `<div>`, add a conditional class:

```typescript
className={cn(
  // existing classes...
  getCellPendingEdit(actualIndex, col.name) && 'bg-yellow-500/15 dark:bg-yellow-400/15',
)}
```

**Step 4: Add row delete via context menu**

In the context menu, add a "Delete Row" option that pushes a `RowDelete` change:

```typescript
const handleDeleteRow = (rowIndex: number) => {
  if (!database || !table) return;
  const row = result.rows[rowIndex];
  const primaryKeys: Record<string, any> = {};
  const originalRow: Record<string, any> = {};
  result.columns.forEach((col, i) => {
    if (col.is_primary_key) primaryKeys[col.name] = formatCellValue(row[i]);
    originalRow[col.name] = formatCellValue(row[i]);
  });
  if (Object.keys(primaryKeys).length === 0) return;
  addChange({ type: 'delete', table, database, rowIndex, primaryKeys, originalRow });
};
```

**Step 5: Visual indicator for deleted rows**

```typescript
const isRowDeleted = (rowIndex: number) => {
  return pendingChanges.some((c) => c.type === 'delete' && c.rowIndex === rowIndex);
};
```

Add to row rendering: `isRowDeleted(actualIndex) && 'opacity-40 line-through'`

**Step 6: Pass database/table props from PanelLayout**

In `PanelLayout.tsx`, when rendering `<DataGrid>`, pass the current database and table name. These come from the query tab metadata. Update `QueryTab` in `queryStore.ts` to track `database` and `table`:

In `apps/desktop/src/stores/queryStore.ts`, add to the `QueryTab` interface:

```typescript
database?: string;
table?: string;
```

When creating a tab from the sidebar (`handleTableClick` in `Sidebar.tsx`), pass the database and table:

```typescript
const tabId = createTab(tableName, { editorVisible: false, database: db, table: tableName });
```

Then in PanelLayout, pass them to DataGrid:

```typescript
<DataGrid result={tab.result} database={activeTab.database} table={activeTab.table} />
```

**Step 7: Commit**

```bash
git add apps/desktop/src/components/grid/DataGrid.tsx apps/desktop/src/stores/queryStore.ts apps/desktop/src/components/layout/PanelLayout.tsx apps/desktop/src/components/layout/Sidebar.tsx
git commit -m "feat: wire DataGrid inline editing to changeStore with visual diff indicators"
```

---

## Task 6: Keyboard Shortcuts for Commit Workflow

**Files:**
- Modify: `apps/desktop/src/components/layout/AppLayout.tsx`

**Step 1: Add keyboard shortcuts**

In `AppLayout.tsx`, import the changeStore and add shortcuts to the existing `useKeyboardShortcuts` array:

```typescript
import { useChangeStore } from '@/stores/changeStore';
```

Add these to the shortcuts array:

```typescript
{
  key: 's',
  modifiers: ['ctrl'],
  handler: () => {
    // Commit is handled by toolbar button logic — we trigger via a custom event
    document.dispatchEvent(new CustomEvent('dataforge:commit'));
  },
},
{
  key: 'z',
  modifiers: ['ctrl'],
  handler: () => useChangeStore.getState().undo(),
},
{
  key: 'z',
  modifiers: ['ctrl', 'shift'],
  handler: () => useChangeStore.getState().redo(),
},
{
  key: 'p',
  modifiers: ['ctrl', 'shift'],
  handler: () => {
    const store = useChangeStore.getState();
    if (store.hasPendingChanges()) store.setPreviewOpen(true);
  },
},
```

**Step 2: Listen for commit event in EditorToolbar**

In `EditorToolbar.tsx`, add a `useEffect` to listen for the custom event:

```typescript
useEffect(() => {
  const handler = () => handleCommit();
  document.addEventListener('dataforge:commit', handler);
  return () => document.removeEventListener('dataforge:commit', handler);
}, [handleCommit]);
```

Wrap `handleCommit` in `useCallback`.

**Step 3: Commit**

```bash
git add apps/desktop/src/components/layout/AppLayout.tsx apps/desktop/src/components/editor/EditorToolbar.tsx
git commit -m "feat: add keyboard shortcuts for commit (Ctrl+S), undo, redo, preview"
```

---

## Task 7: Pending Changes Indicator in StatusBar

**Files:**
- Modify: `apps/desktop/src/components/layout/StatusBar.tsx`

**Step 1: Add pending changes count to StatusBar**

Import and use changeStore:

```typescript
import { useChangeStore } from '@/stores/changeStore';
```

Inside the component:

```typescript
const pendingCount = useChangeStore((s) => s.pendingCount());
const hasPending = useChangeStore((s) => s.hasPendingChanges());
```

Add between the left and right sections:

```typescript
{hasPending && (
  <div className="flex items-center gap-1 text-xs">
    <div className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
    <span className="text-muted-foreground">
      {pendingCount} unsaved change{pendingCount !== 1 ? 's' : ''}
    </span>
  </div>
)}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/components/layout/StatusBar.tsx
git commit -m "feat: show pending changes count in status bar"
```

---

## Task 8: Row Insert UI

**Files:**
- Modify: `apps/desktop/src/components/grid/DataGrid.tsx`

**Step 1: Add "Insert Row" button to the DataGrid footer**

Add a `+` button in the grid footer (next to the export buttons) that creates a new row with all NULL values:

```typescript
const handleInsertRow = () => {
  if (!database || !table) return;
  const values: Record<string, any> = {};
  result.columns.forEach((col) => {
    values[col.name] = null;
  });
  addChange({ type: 'insert', table, database, values });
};
```

Render inserted rows at the bottom of the grid with a green background indicator.

**Step 2: Show pending inserted rows at the bottom of the grid**

After the real rows, render pending inserts:

```typescript
const insertedRows = pendingChanges.filter((c) => c.type === 'insert');
```

Render them with `bg-green-500/15` background and editable cells.

**Step 3: Commit**

```bash
git add apps/desktop/src/components/grid/DataGrid.tsx
git commit -m "feat: add row insert UI with pending insert indicators"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Change Store | `changeStore.ts` (new) |
| 2 | execute_batch command | `query.rs`, `lib.rs`, `ipc.ts` |
| 3 | Toolbar buttons | `EditorToolbar.tsx` |
| 4 | Code Preview dialog | `CodePreview.tsx` (new), `PanelLayout.tsx` |
| 5 | DataGrid ↔ changeStore | `DataGrid.tsx`, `queryStore.ts`, `PanelLayout.tsx`, `Sidebar.tsx` |
| 6 | Keyboard shortcuts | `AppLayout.tsx`, `EditorToolbar.tsx` |
| 7 | StatusBar indicator | `StatusBar.tsx` |
| 8 | Row Insert UI | `DataGrid.tsx` |
