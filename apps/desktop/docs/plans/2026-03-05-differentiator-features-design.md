# Differentiator Features Design

## Goal

Add 7 unique features that no competitor (TablePlus, DBeaver, DataGrip) offers built-in, making DataForge the most complete database management tool on the market.

## Features

### 1. Import/Export Multi-Format

**Import**: Drag-and-drop CSV, JSON, Excel (.xlsx), SQL dump into a table. Auto-detect column types. Preview first 100 rows. Options: create new table or insert into existing, column mapping, CSV separator config, encoding handling.

**Export**: Select tables or query results. Formats: CSV, JSON, Excel, SQL INSERT, SQL CREATE+INSERT, Markdown table. Filtering (WHERE), row limits, column include/exclude. Batch export (multiple tables).

**Architecture**: Frontend parsing with `papaparse` (CSV), `xlsx` (Excel), `sql-formatter`. Backend Tauri handles file dialogs and writing. Store: `importExportStore.ts`.

### 2. Data Generator (Mock Data)

Select a table, generator reads schema (columns, types, FK, constraints). Per column, suggest intelligent provider: `name.firstName`, `internet.email`, `address.city`, etc. Auto-detection based on column name. Respect FK (sample existing IDs), UNIQUE, NOT NULL constraints.

**UI**: Dialog with one row per column, provider dropdown, live preview of 5 sample values. Slider for row count (10 to 100k). "Generate & Insert" or "Generate & Export CSV".

**Lib**: `@faker-js/faker` frontend-only.

### 3. Visual Query Builder (No-Code SQL)

Drag-and-drop canvas using `@xyflow/react`. Drag tables from sidebar as blocks. Connect columns between tables to create JOINs (configurable type). Per table: check columns to SELECT, add WHERE filters via dropdowns (column > operator > value), configure GROUP BY/ORDER BY/LIMIT.

**Bidirectional sync**: Builder generates SQL in real-time in a panel below. Writing SQL updates the builder (SQL parsing). Learn SQL visually.

**Architecture**: Reuse `@xyflow/react`. Store: `queryBuilderStore.ts`. Component: `QueryBuilderView`. Generated SQL injects into Monaco editor on "Run".

### 4. Real-time DB Monitoring (Live Charts)

Upgrade existing Health Dashboard with real-time line charts (30s window, 2s polling). Metrics: queries/sec, active connections, cache hit ratio, I/O throughput, slow query count. Uses `recharts`.

**Visual alerts**: Configurable thresholds ("alert if queries/sec > 1000"). Red flashing badge in sidebar + toast notification.

**Architecture**: Extend `HealthDashboard` with "Live Metrics" and "Alerts" tabs. Store: `monitoringStore.ts`.

### 5. Schema Migration Tool

**Schema diff**: Select two connections. Compare tables, columns, indexes, FK. Visual diff (green=added, red=removed, yellow=modified). Git-like diff for DB schemas.

**Migration generation**: From diff, auto-generate ALTER TABLE, CREATE TABLE, DROP TABLE statements. Preview before execution. Export as `.sql` file.

**Architecture**: Frontend comparison using existing backend `get_tables`/`get_columns`. Component: `SchemaMigrationView`. Store: `migrationStore.ts`.

### 6. Collaboration & Sharing

**Shared queries**: Export/import query collections as `.json`. Copy query with context (connection type, database, description) to clipboard. Shareable via Slack/email.

**Dashboard sharing**: Export complete dashboard (layout + widgets + queries) as `.json`. Import from colleague. No credentials stored.

**Notes & Annotations**: Add markdown notes on tables, columns, or queries. Stored locally in `notesStore.ts`. Visible in sidebar next to tables and in dedicated panel.

**No server**: All file-based (JSON export/import). No backend collaboration needed.

### 7. Notifications & DB Alerts

**Scheduled queries**: Program a query to run at intervals (5min, 1h, daily). If result changes or exceeds threshold, native system notification (Tauri notification API).

**Conditional alerts**: Configure rules: "If `SELECT COUNT(*) FROM orders WHERE status='failed'` > 10, critical alert". System tray icon with badge. Alert history panel.

**Architecture**: `alertStore.ts`. Frontend `setInterval` for scheduled execution. Notifications via `@tauri-apps/plugin-notification`. Alerts only work while app is open.

## Tech Stack (New Dependencies)

- `papaparse` — CSV parsing
- `xlsx` — Excel read/write
- `@faker-js/faker` — Mock data generation
- `@tauri-apps/plugin-notification` — Native notifications

## Existing Dependencies Reused

- `@xyflow/react` — Visual Query Builder (already installed for ER diagrams)
- `recharts` — Live charts (already installed for dashboards)
- `zustand` — All new stores
- `lucide-react` — Icons
