# Copy Formats, Query Favorites, Preferences, Session Recovery

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add copy format options, SQL file open/save, a preferences page, and session recovery.

**Architecture:** All 4 features are frontend-only. Copy formats = utility functions + context menu. Favorites = web File API. Preferences = new store + page. Session recovery = localStorage persistence of tabs/connection.

**Tech Stack:** React 19, Zustand 5, shadcn/ui, Web File API, localStorage

---

### Task 1: Copy Formats Utility (`lib/copyFormats.ts`)

Create utility functions that convert selected rows + columns into different formats.

**Files:**
- Create: `apps/desktop/src/lib/copyFormats.ts`

Formats: JSON, INSERT SQL, CSV (with headers), Markdown table.

### Task 2: Copy Formats in DataGrid Context Menu

Add "Copy as..." submenu to DataGrid context menu.

**Files:**
- Modify: `apps/desktop/src/components/grid/DataGrid.tsx` (context menu section)

### Task 3: Preferences Store (`stores/preferencesStore.ts`)

Zustand store persisted to localStorage. Settings: theme, editorFontSize, pageSize, safeModeLevel, autoUppercase, showLineNumbers.

**Files:**
- Create: `apps/desktop/src/stores/preferencesStore.ts`

### Task 4: Preferences Dialog

Settings dialog accessible via Command Palette or Ctrl+, shortcut.

**Files:**
- Create: `apps/desktop/src/components/layout/PreferencesDialog.tsx`
- Modify: `apps/desktop/src/components/layout/AppLayout.tsx` (add shortcut + render)
- Modify: `apps/desktop/src/components/layout/CommandPalette.tsx` (add command)

### Task 5: Wire Preferences to Existing Components

Replace hardcoded values with preference store reads.

**Files:**
- Modify: `apps/desktop/src/stores/uiStore.ts` (theme from prefs)
- Modify: `apps/desktop/src/components/grid/DataGrid.tsx` (pageSize from prefs)
- Modify: `apps/desktop/src/components/editor/SqlEditor.tsx` (font size from prefs)

### Task 6: Query File Open/Save

Open SQL files (Ctrl+O) and save (Ctrl+Shift+S) using web File API.

**Files:**
- Create: `apps/desktop/src/lib/fileOps.ts`
- Modify: `apps/desktop/src/components/layout/AppLayout.tsx` (add shortcuts)
- Modify: `apps/desktop/src/stores/queryStore.ts` (add file path tracking)

### Task 7: Session Recovery

Save open tabs + active connection to localStorage. Restore on app start.

**Files:**
- Create: `apps/desktop/src/lib/sessionRecovery.ts`
- Modify: `apps/desktop/src/stores/queryStore.ts` (persist tabs)
- Modify: `apps/desktop/src/stores/connectionStore.ts` (persist last connection)
- Modify: `apps/desktop/src/App.tsx` (restore on mount)
