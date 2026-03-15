# Differentiator Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 7 unique differentiator features (Import/Export, Data Generator, Visual Query Builder, Real-time Monitoring, Schema Migration, Collaboration, Notifications) to make PurrQL the most complete database management tool.

**Architecture:** Each feature follows the established pattern: Zustand store + React components + lazy-loaded views. All stores use `create<T>((set, get) => ({...}))` with localStorage persistence where needed. Views are lazy-imported in PanelLayout and accessible via CommandPalette. No backend changes — all features are frontend-only using existing IPC calls.

**Tech Stack:** React 19, TypeScript 5.7, Zustand 5, Tailwind CSS v4, shadcn/ui, @xyflow/react (query builder), recharts (live charts), papaparse (CSV), xlsx (Excel), @faker-js/faker (mock data), @tauri-apps/plugin-notification (alerts)

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

Install new dependencies:
```bash
npm install papaparse xlsx @faker-js/faker --ignore-scripts
npm install -D @types/papaparse
```

Note: `@tauri-apps/plugin-notification` requires Tauri plugin setup — skip for now, use browser Notification API as fallback.

**Verify:** `npx tsc --noEmit` passes.

**Commit:** `feat: add papaparse, xlsx, faker dependencies`

---

### Task 2: Import/Export Store

**Files:**
- Create: `src/stores/importExportStore.ts`

**Store interface:**
```typescript
interface ImportExportState {
  // Import
  importDialogOpen: boolean;
  importFile: { name: string; content: string; type: 'csv' | 'json' | 'sql' } | null;
  importPreview: { columns: string[]; rows: string[][]; detectedTypes: string[] } | null;
  importTargetTable: string | null;
  importMode: 'create' | 'insert';
  importLoading: boolean;
  importError: string | null;
  csvSeparator: string; // default ','

  // Export
  exportDialogOpen: boolean;
  exportFormat: 'csv' | 'json' | 'excel' | 'sql-insert' | 'sql-create' | 'markdown';
  exportLoading: boolean;

  // Actions
  setImportDialogOpen: (open: boolean) => void;
  parseFile: (file: File) => Promise<void>;
  executeImport: (connectionId: string, database: string) => Promise<void>;
  exportResult: (result: QueryResult, format: string) => Promise<void>;
  exportTable: (connectionId: string, database: string, table: string, format: string) => Promise<void>;
  setExportDialogOpen: (open: boolean) => void;
  reset: () => void;
}
```

**Key logic:**
- `parseFile()`: Use `papaparse` for CSV (with configurable separator), `JSON.parse` for JSON, regex for SQL INSERT. Detect column types from first 100 rows. Generate preview.
- `executeImport()`: For 'create' mode, generate CREATE TABLE + INSERT. For 'insert' mode, generate INSERT only. Use `ipc.executeBatch()`.
- `exportResult()`: Convert QueryResult to target format. CSV via papaparse unparse, JSON via JSON.stringify, Excel via xlsx, SQL via string templates, Markdown via table formatting. Use Tauri file dialog to save.

---

### Task 3: Import Dialog Component

**Files:**
- Create: `src/components/import-export/ImportDialog.tsx`
- Create: `src/components/import-export/ImportPreview.tsx`
- Create: `src/components/import-export/ColumnMapper.tsx`

**ImportDialog:** Full-screen dialog with steps:
1. Drop zone (drag-and-drop + file picker) for CSV/JSON/SQL files
2. Preview table showing first 100 rows with detected types
3. Column mapping: rename columns, change types, skip columns
4. Target: create new table (name input) or select existing table (dropdown)
5. Execute button with progress

**ImportPreview:** Renders preview data in a simple HTML table with type badges per column header.

**ColumnMapper:** Per-column row with: source name, arrow, target name (editable), type dropdown (VARCHAR, INT, FLOAT, TEXT, DATE, BOOLEAN), skip checkbox.

UI pattern: Use `Dialog` from shadcn/ui. Step indicator at top. Back/Next buttons.

---

### Task 4: Export Dialog Component

**Files:**
- Create: `src/components/import-export/ExportDialog.tsx`
- Create: `src/lib/exportFormats.ts`

**ExportDialog:** Dialog with:
- Format selector (radio group): CSV, JSON, Excel, SQL INSERT, SQL CREATE+INSERT, Markdown
- Options per format: CSV separator, JSON pretty print, SQL batch size, include column headers
- Column selector: checkboxes to include/exclude columns
- Row limit input (optional)
- Preview of first 5 rows in selected format
- Export button

**exportFormats.ts:** Pure utility functions:
```typescript
export function toCSV(result: QueryResult, options: CSVOptions): string
export function toJSON(result: QueryResult, options: JSONOptions): string
export function toExcel(result: QueryResult, options: ExcelOptions): ArrayBuffer
export function toSQLInsert(result: QueryResult, table: string, options: SQLOptions): string
export function toSQLCreate(result: QueryResult, table: string): string
export function toMarkdown(result: QueryResult): string
```

Each function takes a QueryResult and converts CellValue[] to the target format using the cellValue helpers.

---

### Task 5: Data Generator Store & UI

**Files:**
- Create: `src/stores/dataGenStore.ts`
- Create: `src/components/data-gen/DataGeneratorDialog.tsx`
- Create: `src/components/data-gen/ProviderSelect.tsx`
- Create: `src/lib/dataGenProviders.ts`

**dataGenProviders.ts:** Maps column names/types to faker providers:
```typescript
export interface GenProvider {
  id: string;
  label: string;
  category: string;
  generate: (faker: Faker) => unknown;
}

export const PROVIDERS: GenProvider[] = [
  { id: 'name.firstName', label: 'First Name', category: 'Person', generate: (f) => f.person.firstName() },
  { id: 'name.lastName', label: 'Last Name', category: 'Person', generate: (f) => f.person.lastName() },
  { id: 'internet.email', label: 'Email', category: 'Internet', generate: (f) => f.internet.email() },
  { id: 'phone.number', label: 'Phone', category: 'Person', generate: (f) => f.phone.number() },
  // ... 30+ providers
];

export function autoDetectProvider(columnName: string, dataType: string): GenProvider
// Match column name patterns: email -> internet.email, phone -> phone.number, etc.
```

**DataGeneratorDialog:** Dialog showing:
- Table selector (dropdown of current database tables)
- Per-column row: column name | type badge | provider dropdown (grouped by category) | 5 sample values (live preview, regenerates on provider change)
- Row count slider (10 / 100 / 1000 / 10000 / 100000)
- FK handling: for FK columns, show "Sample from referenced table" option that queries existing IDs
- Buttons: "Generate & Insert" (executes INSERT via ipc.executeBatch), "Generate & Export CSV"

**Store:** Manages selected table, provider assignments per column, row count, generation state.

---

### Task 6: Visual Query Builder Store

**Files:**
- Create: `src/stores/queryBuilderStore.ts`

**Store interface:**
```typescript
interface QueryBuilderState {
  nodes: Node[];           // @xyflow/react nodes (table blocks)
  edges: Edge[];           // JOIN connections between columns
  selectedColumns: Record<string, string[]>;  // nodeId -> column names
  joins: JoinConfig[];     // { sourceTable, sourceColumn, targetTable, targetColumn, type: 'INNER'|'LEFT'|'RIGHT'|'FULL' }
  whereFilters: WhereFilter[];  // { table, column, operator, value }
  groupByColumns: string[];
  orderByColumns: { column: string; direction: 'ASC' | 'DESC' }[];
  limit: number | null;
  distinct: boolean;

  // Actions
  addTable: (database: string, tableName: string, columns: ColumnInfo[]) => void;
  removeTable: (nodeId: string) => void;
  toggleColumn: (nodeId: string, columnName: string) => void;
  addJoin: (join: JoinConfig) => void;
  removeJoin: (edgeId: string) => void;
  updateJoinType: (edgeId: string, type: string) => void;
  addWhereFilter: (filter: WhereFilter) => void;
  removeWhereFilter: (id: string) => void;
  setGroupBy: (columns: string[]) => void;
  setOrderBy: (columns: { column: string; direction: string }[]) => void;
  setLimit: (limit: number | null) => void;

  // SQL generation
  generateSQL: () => string;

  // Parse SQL back to visual (best-effort)
  parseSQL: (sql: string) => void;

  reset: () => void;
}
```

**generateSQL():** Build SELECT statement from state:
```sql
SELECT [DISTINCT] columns
FROM table1
[JOIN type] table2 ON table1.col = table2.col
WHERE conditions
GROUP BY columns
ORDER BY columns
LIMIT n
```

---

### Task 7: Visual Query Builder UI

**Files:**
- Create: `src/components/query-builder/QueryBuilderView.tsx`
- Create: `src/components/query-builder/TableBlock.tsx`
- Create: `src/components/query-builder/JoinEdge.tsx`
- Create: `src/components/query-builder/BuilderToolbar.tsx`
- Create: `src/components/query-builder/SQLPreview.tsx`
- Create: `src/components/query-builder/FilterPanel.tsx`

**QueryBuilderView:** Main view with ReactFlowProvider. Split layout:
- Top 70%: Canvas with table blocks and join edges
- Bottom 30%: Tabs for SQL Preview | Filters | Group By | Order By

**TableBlock:** Custom React Flow node. Shows table name header + scrollable column list with checkboxes. Each column shows name + type badge. Checked columns are included in SELECT. Connection handles on left/right of each column for creating JOINs.

**JoinEdge:** Custom edge with a label showing join type (INNER/LEFT/RIGHT/FULL). Click label to cycle through types. Delete button on hover.

**BuilderToolbar:** Add table (dropdown from schema), Clear all, Copy SQL, Run Query, toggle Distinct.

**SQLPreview:** Read-only Monaco editor (small) showing generated SQL in real-time. Updates on every state change.

**FilterPanel:** Table of WHERE conditions. Per row: table.column dropdown, operator dropdown (=, !=, >, <, LIKE, IN, IS NULL, etc.), value input. Add/remove buttons.

---

### Task 8: Real-time Monitoring Store & Charts

**Files:**
- Create: `src/stores/monitoringStore.ts`
- Create: `src/components/health/LiveMetrics.tsx`
- Create: `src/components/health/MetricChart.tsx`
- Create: `src/components/health/AlertConfig.tsx`
- Create: `src/components/health/AlertHistory.tsx`

**monitoringStore.ts:**
```typescript
interface MetricDataPoint {
  timestamp: number;
  value: number;
}

interface AlertRule {
  id: string;
  name: string;
  metric: string;
  operator: '>' | '<' | '>=' | '<=' | '==';
  threshold: number;
  enabled: boolean;
}

interface AlertEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  value: number;
  threshold: number;
  timestamp: number;
  acknowledged: boolean;
}

interface MonitoringState {
  metrics: Record<string, MetricDataPoint[]>;  // metric name -> data points (max 100 points = ~3 min at 2s intervals)
  alertRules: AlertRule[];
  alertHistory: AlertEvent[];
  isPolling: boolean;
  pollIntervalMs: number;  // default 2000

  startPolling: (connectionId: string, dbType: string) => void;
  stopPolling: () => void;
  addAlertRule: (rule: Omit<AlertRule, 'id'>) => void;
  removeAlertRule: (id: string) => void;
  acknowledgeAlert: (id: string) => void;
}
```

**Metrics collected per DB type:**
- MySQL: `SHOW GLOBAL STATUS` → Queries, Threads_connected, Threads_running, Slow_queries, Innodb_buffer_pool_reads, Innodb_buffer_pool_read_requests (cache hit ratio)
- Postgres: `pg_stat_database` → xact_commit+xact_rollback (queries/sec), numbackends (connections), blks_hit/(blks_hit+blks_read) (cache ratio), tup_returned, tup_fetched

**LiveMetrics:** Tab component for the Health Dashboard. Shows 4-6 recharts LineChart widgets in a 2x3 grid. Each chart: 30s rolling window, auto-scaling Y axis, current value as big number overlay.

**MetricChart:** Reusable line chart component. Props: data points, label, unit, color. Uses recharts `ResponsiveContainer` + `LineChart` + `Line` + `XAxis` + `YAxis`.

**AlertConfig:** Dialog to manage alert rules. Table with: metric dropdown, operator, threshold input, enabled toggle, delete. Add button.

**AlertHistory:** List of triggered alerts with timestamp, metric value, threshold, acknowledge button. Badge count in Health tab header.

---

### Task 9: Schema Migration Store & UI

**Files:**
- Create: `src/stores/migrationStore.ts`
- Create: `src/components/migration/SchemaMigrationView.tsx`
- Create: `src/components/migration/SchemaDiff.tsx`
- Create: `src/components/migration/MigrationPreview.tsx`

**migrationStore.ts:**
```typescript
interface SchemaDiffItem {
  type: 'table_added' | 'table_removed' | 'table_modified';
  tableName: string;
  changes?: ColumnDiff[];
}

interface ColumnDiff {
  type: 'column_added' | 'column_removed' | 'column_modified';
  columnName: string;
  sourceType?: string;
  targetType?: string;
  sourceNullable?: boolean;
  targetNullable?: boolean;
  sourceDefault?: string | null;
  targetDefault?: string | null;
}

interface MigrationState {
  sourceConnectionId: string | null;
  targetConnectionId: string | null;
  sourceDatabase: string | null;
  targetDatabase: string | null;
  diff: SchemaDiffItem[];
  migrationSQL: string[];
  loading: boolean;

  setSource: (connectionId: string, database: string) => void;
  setTarget: (connectionId: string, database: string) => void;
  computeDiff: () => Promise<void>;
  generateMigration: () => void;
  executeMigration: (connectionId: string) => Promise<void>;
  exportMigration: () => Promise<void>;
}
```

**computeDiff():** Fetches tables + structures from both connections via `ipc.listTables` + `ipc.getTableStructure`. Compares by table name, then by column name/type/nullable/default.

**SchemaMigrationView:** Split view:
- Top: Source and Target connection/database selectors (dropdowns using existing connectionStore data). "Compare" button.
- Middle: Diff table with color-coded rows (green/red/yellow). Expandable table rows showing column-level diffs.
- Bottom: Generated SQL preview (read-only textarea). "Execute on Target" and "Export .sql" buttons.

**SchemaDiff:** Renders the diff list. Per table: icon (+ / - / ~), table name, expandable column changes. Each column change shows: name, old type → new type, nullable change, default change.

---

### Task 10: Notes & Annotations Store & UI

**Files:**
- Create: `src/stores/notesStore.ts`
- Create: `src/components/notes/NotesPanel.tsx`
- Create: `src/components/notes/NoteEditor.tsx`
- Create: `src/components/notes/NoteIndicator.tsx`

**notesStore.ts:**
```typescript
interface Note {
  id: string;
  targetType: 'table' | 'column' | 'query';
  targetKey: string;  // "db.table" or "db.table.column" or query tab id
  content: string;    // markdown
  createdAt: number;
  updatedAt: number;
}

interface NotesState {
  notes: Note[];
  panelOpen: boolean;

  addNote: (targetType: string, targetKey: string, content: string) => void;
  updateNote: (id: string, content: string) => void;
  deleteNote: (id: string) => void;
  getNotesFor: (targetKey: string) => Note[];
  setPanelOpen: (open: boolean) => void;
}

// Persist to localStorage: 'purrql:notes'
```

**NotesPanel:** Side panel (like AI chat) showing notes for the current context. If a table is selected, show table notes. Markdown preview + edit toggle.

**NoteEditor:** Textarea for markdown input with basic toolbar (bold, italic, code, link).

**NoteIndicator:** Small icon (MessageSquare from lucide) shown next to tables/columns in the Sidebar when they have notes. Shows note count badge.

---

### Task 11: Sharing (Query & Dashboard Export/Import)

**Files:**
- Create: `src/lib/sharing.ts`
- Create: `src/components/sharing/ShareDialog.tsx`
- Create: `src/components/sharing/ImportSharedDialog.tsx`

**sharing.ts:**
```typescript
interface SharedQueryCollection {
  version: 1;
  type: 'query-collection';
  name: string;
  exportedAt: string;
  queries: { title: string; sql: string; description?: string; dbType?: string }[];
}

interface SharedDashboard {
  version: 1;
  type: 'dashboard';
  name: string;
  exportedAt: string;
  dashboard: { name: string; widgets: Omit<DashboardWidget, 'result' | 'loading' | 'error'>[]; layout: LayoutItem[] };
}

export function exportQueries(queries: ...): string  // JSON.stringify
export function importQueries(json: string): SharedQueryCollection  // JSON.parse + validate
export function exportDashboard(dashboard: Dashboard): string
export function importDashboard(json: string): SharedDashboard
export function copyQueryToClipboard(query: { title: string; sql: string; dbType?: string }): void
```

**ShareDialog:** Dialog with tabs: "Export Queries" | "Export Dashboard". Queries tab shows checkboxes for all open tabs + saved snippets. Dashboard tab shows dropdown of dashboards. Export button generates JSON file via Tauri save dialog. Copy-to-clipboard button for single query.

**ImportSharedDialog:** Drop zone or file picker for `.json` files. Preview contents. Import button creates tabs/dashboard.

---

### Task 12: Notifications & Scheduled Queries

**Files:**
- Create: `src/stores/alertStore.ts`
- Create: `src/components/alerts/AlertManager.tsx`
- Create: `src/components/alerts/ScheduledQueryDialog.tsx`
- Create: `src/components/alerts/AlertBadge.tsx`
- Create: `src/lib/notifications.ts`

**alertStore.ts:**
```typescript
interface ScheduledQuery {
  id: string;
  name: string;
  sql: string;
  connectionId: string;
  intervalMs: number;  // 300000 = 5min, 3600000 = 1h, 86400000 = 1day
  condition: {
    type: 'row_count_exceeds' | 'value_exceeds' | 'value_below' | 'result_changed';
    threshold?: number;
    column?: string;
  };
  enabled: boolean;
  lastResult?: string;  // JSON of last query result for change detection
  lastRunAt?: number;
  lastAlertAt?: number;
}

interface Alert {
  id: string;
  scheduledQueryId: string;
  queryName: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: number;
  read: boolean;
}

interface AlertState {
  scheduledQueries: ScheduledQuery[];
  alerts: Alert[];
  unreadCount: number;

  addScheduledQuery: (query: Omit<ScheduledQuery, 'id'>) => void;
  updateScheduledQuery: (id: string, updates: Partial<ScheduledQuery>) => void;
  removeScheduledQuery: (id: string) => void;

  // Scheduler
  startScheduler: () => void;
  stopScheduler: () => void;

  // Alerts
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAlerts: () => void;
}

// Persist to localStorage: 'purrql:scheduled-queries', 'purrql:alerts'
```

**notifications.ts:**
```typescript
export async function sendNotification(title: string, body: string): Promise<void> {
  // Try Tauri notification plugin first, fallback to browser Notification API
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  } else if ('Notification' in window) {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') new Notification(title, { body });
  }
}
```

**AlertManager:** Full panel view accessible from sidebar or command palette. Shows:
- Tab 1: Scheduled Queries list with enable/disable toggle, edit, delete. "Add Scheduled Query" button.
- Tab 2: Alert History with severity icons, timestamps, query name. Mark as read / clear all.

**ScheduledQueryDialog:** Dialog to create/edit a scheduled query. Fields: name, SQL editor (small Monaco), interval dropdown (5min/15min/1h/6h/daily), condition type dropdown + threshold input, test button.

**AlertBadge:** Small red badge component to show unread alert count. Used in sidebar and status bar.

---

### Task 13: Integration — Wire Everything Into the App

**Files:**
- Modify: `src/stores/queryStore.ts` — Add new TabViewMode values: `'query-builder' | 'migration' | 'alerts'`
- Modify: `src/components/layout/PanelLayout.tsx` — Add lazy imports and rendering for QueryBuilderView, SchemaMigrationView, AlertManager
- Modify: `src/components/layout/AppLayout.tsx` — Add NotesPanel, ImportDialog, ExportDialog, DataGeneratorDialog, ShareDialog, ImportSharedDialog. Add keyboard shortcuts: Ctrl+Shift+E (export), Ctrl+Shift+G (data generator).
- Modify: `src/components/layout/CommandPalette.tsx` — Add commands: Import Data, Export Data, Generate Mock Data, Visual Query Builder, Schema Migration, Notes, Manage Alerts, Share Queries, Import Shared.
- Modify: `src/components/layout/Sidebar.tsx` — Add NoteIndicator next to tables/columns that have notes. Add AlertBadge to show unread alerts.
- Modify: `src/components/editor/EditorTabs.tsx` — Add icons for new view modes (query-builder, migration, alerts).
- Modify: `src/components/editor/EditorToolbar.tsx` — Add Export button in toolbar.
- Modify: `src/components/health/HealthDashboard.tsx` — Add tabs for existing panels + new LiveMetrics + AlertConfig.
- Modify: `src/components/settings/SettingsPage.tsx` — Add Notifications section for alert preferences.

**Key integration patterns (follow existing code):**
```typescript
// Lazy loading in PanelLayout.tsx
const QueryBuilderView = lazy(() => import('@/components/query-builder/QueryBuilderView').then(m => ({ default: m.QueryBuilderView })));

// Rendering pattern
{activeTab && activeTab.viewMode === 'query-builder' && (
  <div className="flex flex-1 flex-col overflow-hidden">
    <Suspense fallback={<LazyFallback />}>
      <QueryBuilderView />
    </Suspense>
  </div>
)}

// Command palette pattern
{ id: 'visual-query-builder', label: 'Visual Query Builder', icon: <Workflow className="size-4" />, action: () => createTab('Query Builder', { viewMode: 'query-builder' }) }
```

---

### Task 14: Verify Build & Commit

**Step 1:** Run `npx tsc --noEmit` — must pass with 0 errors.
**Step 2:** Run `npx vite build` — must succeed.
**Step 3:** Manual smoke test: open app, test each new feature from command palette.
**Step 4:** Commit all changes: `feat: add 7 differentiator features — import/export, data generator, query builder, live monitoring, schema migration, collaboration, notifications`
**Step 5:** Push to remote.
