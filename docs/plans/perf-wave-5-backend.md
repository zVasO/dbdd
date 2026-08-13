# Perf Wave 5 — Backend & Heavy Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Massive-dataset paths stop blocking: copy/export formatting off the main thread, schema structures cached in Rust, Postgres decoding per-column instead of per-cell, columnar results built in the driver, CSV import fully in Rust with windowed batches, MySQL on the binary protocol.

**Architecture:** Nine tasks in three chains. Frontend chain (T1→T2): one pure columnar formatter library replaces the three divergent formatter copies, then the export worker and all copy/export call sites route through it. Rust read chain (T3, T4→T5): the dead `structures` cache in purrql-engine gets wired stale-while-revalidate like `list_tables`; `pg_typed_cell`'s per-cell type-name match becomes a per-column decoder enum; then a defaulted `execute_columnar` trait method with a native Postgres implementation removes the row-intermediate for the single-shot columnar command. Rust write chain (T6→T7, T8): drivers report `affected_rows`, `execute_batch` gains a windowed summary mode with progress events, then a native `import_csv` command (csv crate) replaces the JS round-trip; MySQL switches text→binary protocol with the type-mapping tests it never had. T9 wires the orphaned `app-event` bus into activityStore, fixing the missing `cancelled` status.

**Tech Stack:** Rust (sqlx 0.8, mysql_async, csv crate, DashMap, tokio), Tauri 2.10 events, React 19 + Zustand 5, Web Workers (module type, `new URL` pattern), vitest 2 (node env), cargo test.

## Global Constraints

- Verification per task: frontend-touching tasks run `npx tsc --noEmit`, `npx vitest run` (apps/desktop) and `pnpm --filter desktop build:frontend` (root); Rust-touching tasks run `cargo check --workspace` and `cargo test --workspace`; tasks touching both run all five. All must pass before commit.
- Work directly on `master`; push after every task (`git push origin master`; fetch+rebase on rejection).
- Commit trailers on every commit, exactly:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01CVerLtPhHhQbDjA6p7ZMaG`
- Surgical diffs; no change-explaining comments; comments only for constraints code can't show.
- `DatabaseConnection` trait changes MUST be defaulted methods (purrql-sqlite is a 30-line all-`NotSupported` stub and purrql-mysql lacks the tracked variants — neither may be forced to grow).
- Rust test style: `#[cfg(test)] mod tests` at the bottom of the file under test; pure-function extraction over live-DB tests (no live-DB infra exists). Driver crates currently have no dev-dependencies — add `tokio = { workspace = true, features = ["macros", "rt-multi-thread"] }` under `[dev-dependencies]` only if a test needs it.
- Frontend test style: pure modules + vitest node env (no DOM infra). Store tests drive the real Zustand store with `setState` resets.
- Behavior-change ledger (each explicitly sanctioned, everything else is parity):
  1. T1 aligns the three formatter copies — the worker's one-INSERT-per-row becomes one multi-row INSERT (copyFormats semantics win); `Bytes` cells render `'[N bytes]'` consistently.
  2. T7 replaces CsvImportDialog's hand-rolled parser with Rust csv-crate parsing (quoted newlines now parse correctly).
  3. T8 changes MySQL result decoding wire-path (text→binary); visible formatting of dates/times must be preserved by the type mapping and is pinned by new tests.
- Line numbers cited are from scouting at commit 721d475 and may have drifted (wave 4 runs before this wave) — grep anchors before editing.

---

### Task 1: One columnar formatter library

Three divergent formatter implementations exist: `lib/copyFormats.ts` (csv/tsv/json/markdown/insert, multi-row INSERT), `lib/exportFormats.ts` (async toCSV via papaparse, toExcel), `workers/export.worker.ts` (third copy, one INSERT per row, no TSV). All are row-based, but `result.rows` is empty everywhere in DataGrid — data lives columnar (`resultStore.getActiveResult` returns `rows: []`, resultStore.ts:735-755). Build ONE pure columnar formatter module; rewire the two libs; the worker follows in Task 2.

**Files:**
- Create: `apps/desktop/src/lib/columnarFormat.ts`
- Modify: `apps/desktop/src/lib/copyFormats.ts` (delegate), `apps/desktop/src/lib/exportFormats.ts` (delegate csv/json/sql/markdown; keep toExcel as-is)
- Test: `apps/desktop/src/lib/__tests__/columnarFormat.test.ts` (create)

**Interfaces:**
- Consumes: `ColumnData` (tagged union `Integers|Floats|Booleans|Strings|Json`, each `{values: (T|null)[]}`), `ColumnMeta`, `columnarCellValue` semantics (GridRow.tsx exports it — read it to mirror cell extraction exactly, including `Bytes`/preview handling).
- Produces (T2's worker and both libs consume these exact names):
  ```ts
  export interface ColumnarSlice {
    columns: ColumnMeta[];          // the columns to emit, in output order
    colIndexes: number[];           // parallel: index of each column in `data`
    data: ColumnData[];             // full columnar arrays (NOT sliced)
    rowIndexes: number[];           // actual row indexes to emit, in output order
  }
  export type CopyFormat = 'csv' | 'tsv' | 'json' | 'markdown' | 'insert' | 'create';
  export function formatColumnar(slice: ColumnarSlice, format: CopyFormat, options?: {
    tableName?: string;             // insert/create
    pretty?: boolean;               // json
    delimiter?: string;             // csv override
  }): string;
  export function cellToDisplay(data: ColumnData[], colIndex: number, rowIndex: number): string | number | boolean | null;
  ```

- [ ] **Step 1: Pin current behavior in failing tests**

Before writing tests, read `lib/copyFormats.ts` end-to-end — its output is the behavior contract (multi-row INSERT, TSV tabs, markdown pipes, JSON shape, NULL renderings). Write tests asserting `formatColumnar` reproduces it from columnar input:

```ts
import { describe, it, expect } from 'vitest';
import { formatColumnar } from '../columnarFormat';
import type { ColumnarSlice } from '../columnarFormat';

const slice = (): ColumnarSlice => ({
  columns: [
    { name: 'id', data_type: 'int4', nullable: false },
    { name: 'name', data_type: 'text', nullable: true },
  ] as never,
  colIndexes: [0, 1],
  data: [
    { kind: 'Integers', values: [1, 2, null] },
    { kind: 'Strings', values: ['a', null, 'c, "q"'] },
  ] as never,
  rowIndexes: [0, 2],
});

describe('formatColumnar', () => {
  it('csv quotes and escapes like copyFormats did', () => {
    const out = formatColumnar(slice(), 'csv');
    expect(out.split('\n')[0]).toBe('id,name');
    expect(out).toContain('"c, ""q"""');   // adapt to copyFormats' actual quoting
  });
  it('tsv joins with tabs', () => {
    expect(formatColumnar(slice(), 'tsv').split('\n')[1]).toBe('1\ta');
  });
  it('json emits an array of objects with pretty option', () => {
    const parsed = JSON.parse(formatColumnar(slice(), 'json'));
    expect(parsed).toEqual([{ id: 1, name: 'a' }, { id: null, name: 'c, "q"' }]);
  });
  it('insert emits ONE multi-row statement (copyFormats semantics)', () => {
    const out = formatColumnar(slice(), 'insert', { tableName: 't' });
    expect(out.match(/INSERT INTO/g)).toHaveLength(1);
    expect(out).toContain("VALUES");
    expect(out).toContain('NULL');
  });
  it('markdown renders a header separator row', () => {
    expect(formatColumnar(slice(), 'markdown').split('\n')[1]).toMatch(/^\|?\s*-+/);
  });
  it('respects rowIndexes order and skips unlisted rows', () => {
    const s = { ...slice(), rowIndexes: [2, 0] };
    const lines = formatColumnar(s, 'csv').split('\n');
    expect(lines[1].startsWith('')).toBe(true); // row 2 first (id null)
    expect(lines[2].startsWith('1')).toBe(true);
  });
});
```

Adjust expected strings to copyFormats' REAL output (run its functions mentally/inline while writing) — the tests document the alignment; where the worker diverged (one-INSERT-per-row), copyFormats wins per the behavior ledger.

- [ ] **Step 2: Run → module not found. Implement. Run → green.**

Implementation notes: build once over `rowIndexes × colIndexes`; `cellToDisplay` mirrors `columnarCellValue`'s extraction but returns display primitives; `create` format ports the worker's `sql-create` logic (its only unique feature — keep it).

- [ ] **Step 3: Delegate the two libs**

`copyFormats.ts`: each `copyAsX(columns, rows)` caller is being migrated in T2 — in THIS task add columnar entry points `copyColumnarAs(format, slice)` delegating to `formatColumnar`, and reimplement the existing row-based functions on top of `formatColumnar` by adapting rows→slice (temporary until T2 removes row-based callers; if an existing function's output would change beyond the sanctioned alignments, stop and report). `exportFormats.ts`: `toCSV`/`toJSON`/`toSQL`/markdown delegate similarly; `toExcel` untouched.

- [ ] **Step 4: Verify (all five commands N/A — frontend three), commit, push**

```bash
git add apps/desktop/src/lib/columnarFormat.ts apps/desktop/src/lib/__tests__/columnarFormat.test.ts apps/desktop/src/lib/copyFormats.ts apps/desktop/src/lib/exportFormats.ts
git commit -m "perf: single columnar formatter library behind all copy/export formats"
git push origin master
```

---

### Task 2: Copy/export through the worker, stall-free export dialog

Ctrl+C / export on 100k rows freezes the app: `copySelection` (DataGrid.tsx:1088-1123), `exportData` (:1360-1436) and the context-menu Copy-as items (:1752-1805) format on the main thread; `ExportDialog`'s real stall is `getAllResults` materializing every row BEFORE the worker is even reached (resultStore.ts:716-733, called at ExportDialog.tsx:171). Route formatting through `export.worker.ts` with a columnar protocol; small payloads may stay synchronous.

**Files:**
- Modify: `apps/desktop/src/workers/export.worker.ts` (columnar protocol, delegate to `formatColumnar`)
- Create: `apps/desktop/src/workers/exportWorker.protocol.ts` (typed messages, mirroring `gridWorker.protocol.ts`)
- Create: `apps/desktop/src/lib/exportRunner.ts` (spawn/queue/terminate; promise API `runExport(slice, format, options): Promise<string>`; SYNC_THRESHOLD fallback)
- Modify: `apps/desktop/src/components/grid/DataGrid.tsx` (copySelection, exportData, context-menu items), `apps/desktop/src/components/import-export/ExportDialog.tsx` + `apps/desktop/src/stores/importExportStore.ts` (columnar path, kill the `getAllResults` materialization for non-excel formats)
- Modify: `apps/desktop/src-tauri/src/commands/files.rs` (save dialog extension filter follows the requested filename — scout: `saveSqlFile` filters `*.sql` even for `.csv`/`.json`)
- Test: `apps/desktop/src/lib/__tests__/exportRunner.test.ts` (pure parts: threshold routing decision, message shaping — the Worker itself is mocked by injecting a factory)

**Interfaces:**
- Consumes: T1's `formatColumnar`/`ColumnarSlice`/`CopyFormat`; `materializeCells` (gridSelection.ts) and `paginatedIndexMap` for building `rowIndexes`; resultStore columnar accessors.
- Produces: `runExport(slice: ColumnarSlice, format: CopyFormat, options?): Promise<string>`; worker protocol `{ type: 'format', id: number, slice, format, options }` → `{ type: 'format-result', id, content } | { type: 'format-error', id, error }`.

- [ ] **Step 1: Protocol + runner (TDD the runner's pure decisions)**

Threshold: `SYNC_THRESHOLD = 10_000` cells (rows × cols) — below it call `formatColumnar` inline (clipboard gestures on small selections must not pay worker latency); at/above, post to the worker. Structured-clone cost note for the reviewer: the slice carries full `ColumnData` arrays — acceptable v1 (same data the grid worker already clones); do NOT build a second persistent worker cache in this task.

- [ ] **Step 2: Worker rewrite**

`export.worker.ts` becomes ~20 lines: `onmessage` → `formatColumnar` → reply. Delete its private formatter copy. Keep the file path (importExportStore imports it by URL).

- [ ] **Step 3: Rewire DataGrid**

`copySelection` and the four Copy-as menu items build a `ColumnarSlice` (they already compute unique rows/cols from `materializeCells`) → `await runExport(...)` → `copyToClipboard`. `exportData` likewise → `ipc.saveSqlFile`. Preserve exact index-space semantics (rowIndexes are ACTUAL indexes via `paginatedIndexMap`). The two duplicate `materializeCells` calls per menu action (scout: `getContextColumnsFromCells`+`getContextRowsFromCells` each re-materialize) — materialize once and share.

- [ ] **Step 4: ExportDialog / importExportStore**

For csv/json/sql/markdown: build the `ColumnarSlice` straight from the tab's columnar result (`getAllResults` NOT called; use the columnar accessors — read resultStore for the right one, `_allColumnarResults` per scout) → `runExport` → existing Blob download. Excel keeps the old row path (`toExcel`) — it needs row objects; call `getAllResults` only in that branch.

- [ ] **Step 5: files.rs filter**

`save_sql_file` (files.rs:41-67): derive the rfd filter from the requested filename's extension (`csv` → "CSV", `json` → "JSON", fallback "SQL"). Add a `#[test]` for the pure extension→filter helper you extract.

- [ ] **Step 6: Verify (all five commands — both sides touched), commit, push**

```bash
git add apps/desktop/src/workers/ apps/desktop/src/lib/exportRunner.ts apps/desktop/src/lib/__tests__/exportRunner.test.ts apps/desktop/src/components/grid/DataGrid.tsx apps/desktop/src/components/import-export/ExportDialog.tsx apps/desktop/src/stores/importExportStore.ts apps/desktop/src-tauri/src/commands/files.rs
git commit -m "perf: columnar worker formatting for copy/export, stall-free export dialog"
git push origin master
```

---

### Task 3: Wire the Rust structure cache (stale-while-revalidate)

`SchemaCache.structures` (schema_cache.rs:14-18) is evicted (:80,:88) but never read or written — every sidebar expansion, diff, and table-designer open pays 4 catalogue queries (`schema_inspector.rs:184-260`). Mirror the `list_tables` SWR pattern (schema.rs:46-96) exactly; DDL invalidation already clears the map (query.rs:397,:519,:634-636 → `invalidate_connection`).

**Files:**
- Modify: `crates/purrql-engine/src/schema_cache.rs` (add `get_structure`/`set_structure`; extend `evict_oldest_for_connection` to the structures map)
- Modify: `apps/desktop/src-tauri/src/commands/schema.rs` (`get_table_structure` :98-114 gains the SWR flow)
- Test: extend `#[cfg(test)]` in `schema_cache.rs` (create the module — the file has none)

**Interfaces:**
- Consumes: `TableRef` (Hash+Eq+Clone, models/schema.rs:5-10), `TableStructure` (Clone, :51-60), existing `get_tables`/`set_tables` shape.
- Produces:
  ```rust
  pub fn get_structure(&self, connection_id: &Uuid, table: &TableRef) -> (Option<TableStructure>, bool /*needs_refresh*/);
  pub fn set_structure(&self, connection_id: Uuid, table: TableRef, structure: TableStructure);
  ```

- [ ] **Step 1: Failing tests** — new `mod tests` in schema_cache.rs: fresh hit returns `(Some, false)`; stale-but-alive returns `(Some, true)` (construct with a short custom ttl — add a `#[cfg(test)] fn with_ttl(Duration)` constructor if none exists); expired returns `(None, true)` and removes; `invalidate_connection` clears it; miss returns `(None, true)`; per-connection cap evicts oldest structure entries (mirror `MAX_ENTRIES_PER_CONNECTION`).

- [ ] **Step 2: Run → fail (methods missing). Implement mirroring `get_tables`/`set_tables` (:38-76) including the `ttl*4/5` refresh threshold and eviction. Run → green.**

- [ ] **Step 3: Command flow** — `get_table_structure` (schema.rs:98-114) becomes: cache fresh → return; stale → return clone AND `tokio::spawn` background refresh (clone the inspector Arc out of the guard BEFORE spawning, same discipline as `list_tables` — never hold a DashMap guard across an await); miss → fetch, `set_structure`, return. Keep the frontend dedup (ipc.ts:107-110) untouched.

- [ ] **Step 4: `cargo check --workspace && cargo test --workspace`, commit, push**

```bash
git add crates/purrql-engine/src/schema_cache.rs apps/desktop/src-tauri/src/commands/schema.rs
git commit -m "perf: stale-while-revalidate structure cache, mirroring list_tables"
git push origin master
```

---

### Task 4: Postgres per-column decoder (kill the per-cell type match)

`pg_typed_cell` (purrql-postgres/src/connection.rs:351-447) string-matches the type name once PER CELL — 1M `match &str` comparisons for 50k×20. Both call paths already have per-column type names (`extract_pg_result` :481-486 builds `col_types: Vec<String>`; `run_stream` :186-190 likewise). Hoist the match: derive a `PgDecoder` enum once per column, decode cells through it.

**Files:**
- Modify: `crates/purrql-postgres/src/connection.rs`
- Test: extend the existing `mod tests` (connection.rs:640+)

**Interfaces (internal to the crate; T5 reuses `PgDecoder`):**
```rust
#[derive(Clone, Copy, PartialEq, Debug)]
enum PgDecoder { Bool, Int2, Int4, Int8, Float4, Float8, Numeric, Text, Json, Uuid, Timestamp, TimestampTz, Date, Time, Bytea, Array, Other }
fn decoder_for_type(pg_type: &str) -> PgDecoder;                     // the ONE place the string match lives
fn decode_cell(row: &PgRow, index: usize, decoder: PgDecoder) -> CellValue;
```

- [ ] **Step 1: Failing tests** — `decoder_for_type` maps every arm the current `pg_typed_cell` handles (read :351-447 and enumerate — one test with a table of `(type_name, expected_decoder)` pairs, including the fallback arm → `Other`). `decode_cell` needs a `PgRow`, which tests can't build without a connection — so the testable surface is `decoder_for_type` (pure) plus the guarantee that `decode_cell`'s match arms are exhaustive (compiler-enforced). That split is the point of the refactor.

- [ ] **Step 2: Implement** — `decoder_for_type` hoists the string match verbatim; `decode_cell` is `pg_typed_cell`'s body with `match decoder` instead of `match pg_type`; both call paths precompute `Vec<PgDecoder>` (from the existing `col_types` construction) and pass the decoder down. `pg_typed_cell` itself becomes `decode_cell(row, i, decoder_for_type(t))` or is deleted (grep callers). Preserve the NUMERIC/fallback `tracing::warn!`s.

- [ ] **Step 3: `cargo check/test --workspace`, commit, push**

```bash
git add crates/purrql-postgres/src/connection.rs
git commit -m "perf: per-column Postgres decoder replaces per-cell type-name matching"
git push origin master
```

---

### Task 5: Driver-level columnar (`execute_columnar`)

The single-shot columnar path materializes three times: `Vec<PgRow>` → `Vec<Row>` (CellValue ≈40B/cell) → `ColumnarResult` (from_query_result_consuming, columnar.rs:225-306) → JSON. Add a defaulted trait method so drivers can build `ColumnarResult` directly; implement natively for Postgres (the only driver worth it now); wire `execute_query_columnar`.

**Files:**
- Modify: `crates/purrql-core/src/ports/connection.rs` (trait), `crates/purrql-core/src/models/columnar.rs` (a `ColumnarBuilder` helper if useful — keep public surface minimal)
- Modify: `crates/purrql-postgres/src/connection.rs` (native impl on the tracked path)
- Modify: `apps/desktop/src-tauri/src/commands/query.rs` (`execute_query_columnar` :434-537 calls the new method)
- Test: extend `mod tests` in columnar.rs and connection.rs

**Interfaces:**
```rust
// purrql-core ports/connection.rs — defaulted, so mysql/sqlite compile untouched:
async fn execute_columnar_tracked(&self, sql: &str, query_id: &Uuid) -> Result<ColumnarResult> {
    let result = self.execute_tracked(sql, query_id).await?;
    Ok(ColumnarResult::from_query_result_consuming(result))
}
```
Kind selection: the native Postgres impl derives each column's `ColumnKind` from metadata via `column_kind_for_data_type(&DataType)` (the wave-1 single source of truth; `map_pg_column_meta` :449-453 already computes the `DataType` per column) — NOT from the first non-null cell. This aligns the single-shot path with the stream path's kinds (scout flagged they currently differ); `determine_column_kind` remains only inside the default fallback.

- [ ] **Step 1: Failing tests**
  - columnar.rs: if you add a builder (`ColumnarBuilder::new(kinds) / push_cell(col, CellValue) / finish()`), test it: correct tagged arrays per kind, nulls preserved, kind-mismatch cell (e.g. Text into Integers) falls back to the column's declared kind semantics — define: coerce via the same rules `rows_to_columnar_chunk` uses (:344-359, read it and mirror).
  - postgres connection.rs: pure part only — the per-column `(DataType → ColumnKind)` derivation for the native path (table-driven test; NUMERIC → String per wave-1 doc columnar.rs:152-161).

- [ ] **Step 2: Implement**
  - Trait default as above (plus nothing else — no untracked variant; the command always has a query id).
  - Postgres: `execute_columnar_tracked` mirrors `run_query`'s acquire/retry/pid discipline (`acquire_tracked`, `with_retry`, `PidRegistration` — connection.rs:108-133) but folds rows straight into columnar arrays: fetch rows (keep `fetch_all` — a streaming fold is not required here), compute per-column `PgDecoder` + `ColumnKind` once, loop rows pushing decoded cells into the builder. `total_rows`, timings, warnings as in `run_query`.
  - Command: `execute_query_columnar` calls `conn.execute_columnar_tracked(...)`; delete the `from_query_result_consuming` call at :534; row-path `execute_query` untouched.

- [ ] **Step 3: `cargo check/test --workspace` + frontend suite untouched but run `npx vitest run` anyway (resultStore consumes ColumnarResult over IPC — shape must be identical; any TS type change is a spec violation, the wire shape may not change). Commit, push.**

```bash
git add crates/purrql-core/src/ports/connection.rs crates/purrql-core/src/models/columnar.rs crates/purrql-postgres/src/connection.rs apps/desktop/src-tauri/src/commands/query.rs
git commit -m "perf: driver-level columnar results for Postgres single-shot queries"
git push origin master
```

---

### Task 6: `affected_rows` + windowed batch summary

Both drivers return `affected_rows: None` always (postgres connection.rs:124, mysql connection.rs:119) — the CSV import success counter always reads 0. And `execute_batch` (query.rs:579-641) returns one full `QueryResult` envelope per statement (400× for a 20k-row import). Fix both: drivers report affected rows; a summary mode returns counts only, windowed, with progress events.

**Files:**
- Modify: `crates/purrql-postgres/src/connection.rs` (rows_affected from the command tag — sqlx `PgQueryResult::rows_affected()`; scout: `run_query` uses `fetch_all`, which returns rows only — for DML the fix is: when the statement yields no rows, `affected_rows` from `sqlx`'s `Execute` path; read the current implementation and take the cheapest correct route: `raw_sql`/`fetch_all` already returns `Vec<PgRow>`; sqlx exposes `rows_affected` via `PgQueryResult` from `.execute()` — route DML through execute when rows are empty is WRONG (double execution); instead use `fetch_many`/stream summing `QueryResult::Done` frames if available in sqlx 0.8 — investigate `sqlx::Executor::fetch_many` yielding `Either<PgQueryResult, PgRow>` and fold both. That is the correct single-execution route.)
- Modify: `crates/purrql-mysql/src/connection.rs` (`conn.affected_rows()` after exec)
- Modify: `apps/desktop/src-tauri/src/commands/query.rs` (`execute_batch_summary` command), `apps/desktop/src-tauri/src/lib.rs` (register), `apps/desktop/src/lib/ipc.ts` + `apps/desktop/src/lib/types.ts` (TS binding)
- Test: cargo tests for the pure windowing; vitest untouched

**Interfaces:**
```rust
#[derive(Serialize)] pub struct StatementOutcome { pub affected_rows: Option<u64>, pub error: Option<String> }
#[derive(Serialize)] pub struct BatchSummary { pub outcomes: Vec<StatementOutcome>, pub total_affected: u64, pub failed: u32 }
// command: execute_batch_summary(connection_id, statements: Vec<String>, window: Option<usize> /*default 200*/) -> Result<BatchSummary, IpcError>
// progress event per window: emit "batch-progress-{first-statement-derived-id?}" — NO: emit via the existing event_bus AppEvent::QueryProgress {query_id, rows_fetched, elapsed_ms} (currently never emitted — T9 wires the listener; use a fresh batch UUID as query_id, rows_fetched = statements completed)
```
```ts
// ipc.ts
executeBatchSummary(connectionId: string, statements: string[], window?: number): Promise<BatchSummary>
```

- [ ] **Step 1: Failing cargo tests** — pure windowing helper `fn windows(statements: &[String], window: usize) -> impl Iterator<Item=&[String]>` (or just use `chunks` — then the testable pure part is the summary fold: outcomes → `{total_affected, failed}`; test that). Driver `affected_rows`: postgres's `Either` fold — extract the fold into a pure function over `Vec<Either<PgQueryResult-like, Row-like>>`? sqlx types resist construction; keep the driver change minimal and reviewed rather than force-tested; the summary fold IS tested.

- [ ] **Step 2: Implement** — drivers first (`affected_rows: Some(n)` where obtainable; leave `None` where genuinely unknowable), then the command: sequential windows (DML import order matters — no `buffered(4)` here; state this constraint in a doc comment: correctness over parallelism for imports), per-window `AppEvent::QueryProgress` emit, safety-limit application per statement EXACTLY as `execute_batch` does (:598-602 — SELECTs inside a batch keep the cap), summary fold. Keep the old `execute_batch` untouched (its callers remain until T7 migrates them; importExportStore path B migration is IN this task for its CSV/JSON branch — switch `executeImport`'s CSV/JSON path (importExportStore.ts:245-329) to `executeBatchSummary` and surface `failed`/`total_affected`; SQL-file branch stays on `executeBatch`).

- [ ] **Step 3: Verify all five (both sides), commit, push**

```bash
git add crates/purrql-postgres/src/connection.rs crates/purrql-mysql/src/connection.rs apps/desktop/src-tauri/src/commands/query.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src/lib/ipc.ts apps/desktop/src/lib/types.ts apps/desktop/src/stores/importExportStore.ts
git commit -m "perf: driver affected_rows and windowed execute_batch_summary"
git push origin master
```

---

### Task 7: CSV import in Rust

Path A (`CsvImportDialog.tsx`) reads the file in Rust, ships the whole string to JS (100MB cap), parses with a hand-rolled splitter that breaks on quoted newlines (:35-71), builds INSERTs in JS, and gets 400 full QueryResults back. Replace with a native command: parse + batch + execute in Rust, return a summary, emit progress.

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml` (+ `csv = "1"`), `apps/desktop/src-tauri/src/commands/files.rs` or new `commands/import.rs` (command `import_csv`), `apps/desktop/src-tauri/src/lib.rs` (register)
- Modify: `apps/desktop/src/components/editor/CsvImportDialog.tsx` (pick file → preview via a light `preview_csv` command → import via `import_csv`), `apps/desktop/src/lib/ipc.ts`
- Test: cargo tests for the pure pieces (INSERT building, identifier/value escaping, header mapping)

**Interfaces:**
```rust
// preview_csv(path-less: uses a file the user picked in the same session? NO — rfd dialog returns the path only inside Rust)
// Design: import_csv opens the dialog itself (like import_csv_file today), parses headers + first 100 rows, returns a PreviewPayload {file_token: Uuid, headers: Vec<String>, sample: Vec<Vec<String>>, total_rows_estimate: Option<u64>}; the file path is held server-side in a DashMap<Uuid, PathBuf> on AppState.
// import_csv_execute(file_token, connection_id, database: Option<String>, table: String, column_mapping: Vec<Option<String>> /*csv col → table col or skip*/, create_table: bool, window: Option<usize>) -> BatchSummary  (reuses T6's summary + windowed execution + QueryProgress events)
```
Pure, tested pieces: `fn build_insert(table:&str, columns:&[String], rows:&[Vec<Option<String>>], dialect_quote:char) -> String` (multi-row VALUES, NULL for None, quote-doubling); `fn map_record(record:&csv::StringRecord, mapping:&[Option<usize>]) -> Vec<Option<String>>`. Value typing: emit everything as quoted strings and let the DB coerce (matches today's JS `escapeValue` behavior — parity, not a regression; note it in a doc comment).

- [ ] **Step 1: Failing cargo tests** for `build_insert` (escaping: embedded quotes doubled, NULL unquoted, batch of 3 rows in one statement; identifier quoting per dialect char) and `map_record` (skipped columns, short records → None-padded).

- [ ] **Step 2: Implement** — csv crate with `flexible(true)`; stream records in windows of `window * batch_rows` (INSERT batch stays 50 rows/statement like today, window 200 statements per T6 execution call — reuse T6's internal execution path rather than invoking the command layer); progress via `AppEvent::QueryProgress` with a batch UUID; file-token map cleaned on completion/error.

- [ ] **Step 3: Rewire CsvImportDialog** — pick+preview via the new command (drop `parseCsv`, drop the full-content IPC), import via `import_csv_execute`, success/error counts from `BatchSummary` (now non-zero thanks to T6). Path B (`importExportStore.parseFile`) keeps its browser-File flow (it never touches the Rust reader — out of scope beyond T6's summary switch; note the duplication stays and is ledgered).

- [ ] **Step 4: Verify all five, commit, push**

```bash
git add apps/desktop/src-tauri/ apps/desktop/src/components/editor/CsvImportDialog.tsx apps/desktop/src/lib/ipc.ts
git commit -m "perf: native Rust CSV import with windowed batches and progress"
git push origin master
```

---

### Task 8: MySQL binary protocol

`execute` (mysql connection.rs:107 `conn.query`) and `execute_stream` (:251 `query_iter`) use the TEXT protocol: every cell arrives as `Value::Bytes` and `bytes_cell_by_type` (type_mapping.rs:159-187) re-reads the column type and `str::parse`s per numeric cell. Switch to `conn.exec(sql, ())` / `exec_iter` (binary, like `execute_with_params` :167 already does). Behavior risk (scout): binary protocol delivers `Value::Int/Double/Date/Time` variants instead of `Bytes` — `mysql_value_to_cell` (:189-209) must format them identically to today's text output, pinned by tests FIRST.

**Files:**
- Modify: `crates/purrql-mysql/src/type_mapping.rs` (formatting parity + tests), `crates/purrql-mysql/src/connection.rs` (query→exec, query_iter→exec_iter)
- Test: create `mod tests` in type_mapping.rs (crate currently has ZERO tests)

**Interfaces:** none new — internal switch.

- [ ] **Step 1: Failing/pinning tests** — construct `mysql_async::Value` variants directly (`Value::Int(42)`, `Value::Double(1.5)`, `Value::Date(2024,1,15,10,30,0,0)`, `Value::Time(false,0,1,2,3,0)`, `Value::NULL`, `Value::Bytes(b"text".to_vec())`) and assert `mysql_value_to_cell`'s `CellValue` output formats dates/times EXACTLY as the text protocol renders them (`YYYY-MM-DD HH:MM:SS` / `HH:MM:SS` — read the current Bytes path to know today's exact strings, and check mysql_async docs for `Value::Date` field semantics). If `mysql_value_to_cell` needs a `Column` it can't test-construct, refactor the value-only part into a pure `fn value_to_cell(value: Value) -> CellValue` and test that.

- [ ] **Step 2: Implement** — parity fixes in the mapping first (tests green with the mapping alone), then the two call-site switches (`conn.query(sql)` → `conn.exec(sql, ())`, `query_iter(&sql)` → `exec_iter(&sql, ())`). `bytes_cell_by_type` stays (binary can still deliver Bytes for text/blob columns).

- [ ] **Step 3: `cargo check/test --workspace`, commit, push**

```bash
git add crates/purrql-mysql/
git commit -m "perf: MySQL binary protocol for reads, pinned by type-mapping tests"
git push origin master
```

---

### Task 9: Wire the app-event bus into activityStore

Every query emits `AppEvent`s on `app-event` (event_bus.rs:42-53) that nothing listens to — pure serialization waste — while the activity panel shows cancellations as errors (wave-1 deferred: `logError('Cancelled')`). Wire the one existing listener hook to activityStore and map `QueryCancelled` to a real `cancelled` status; T6/T7's `QueryProgress` events surface as progress.

**Files:**
- Modify: `apps/desktop/src/hooks/useTauriEvent.ts` (make it the bridge: subscribe once, dispatch to activityStore), `apps/desktop/src/App.tsx` or `AppLayout.tsx` (mount the hook once — pick the stable root, state which), `apps/desktop/src/stores/activityStore.ts` (add `cancelled` status + `updateCancelled(queryId)`, progress update path)
- Modify: `apps/desktop/src/components/layout/ActivityBar.tsx` (render `cancelled` distinctly — neutral/amber, not red; wave-4 T4 already memoized this file — preserve that)
- Test: `apps/desktop/src/stores/__tests__/activityStore.events.test.ts` (create — pure store: dispatch AppEvent-shaped payloads into the new store actions, assert entries/status transitions; the Tauri `listen` itself is not testable in node, so the hook stays thin and the mapping function `applyAppEvent(store, event)` is exported pure)

**Interfaces:**
- Produces: `applyAppEvent(event: AppEvent): void` (exported from activityStore or a sibling module; the hook calls it).
- Behavior: `QueryCancelled` → entry status `cancelled` (ActivityBar renders non-error); `QueryProgress` → entry's progress text; existing started/completed/error flows keep their current source of truth if one exists in queryStore — read how activity entries are created today FIRST; if queryStore already writes entries directly, the event bridge must UPDATE, not duplicate (dedupe by query_id). If duplication can't be resolved cleanly, wire ONLY `QueryCancelled` + `QueryProgress` and report the rest as out of scope.

- [ ] **Step 1: Failing store tests** (cancelled transition; progress update; no duplicate entry when started arrives for an id queryStore already created).
- [ ] **Step 2: Implement mapping + hook mount + ActivityBar rendering.**
- [ ] **Step 3: Frontend verification trio, commit, push**

```bash
git add apps/desktop/src/hooks/useTauriEvent.ts apps/desktop/src/stores/activityStore.ts apps/desktop/src/components/layout/ActivityBar.tsx apps/desktop/src/App.tsx apps/desktop/src/components/layout/AppLayout.tsx apps/desktop/src/stores/__tests__/activityStore.events.test.ts
git commit -m "feat: wire app-event bus to activity panel with real cancelled status"
git push origin master
```

---

## Explicitly out of scope (parked)

- **Binary IPC** (Tauri `ipc::Response` raw payloads for chunks/columnar): needs an API spike against Tauri 2.10.3 docs before it can be planned honestly — parked as its own follow-up; the scout recorded the current emit/listen inventory to start from.
- Native columnar STREAM path in drivers (chunks already transpose via `rows_to_columnar_chunk`; revisit after T5 ships).
- importExportStore path-B parser unification with Rust import (ledgered in T7).
- SQLite driver implementation (still a stub).
- `information_schema.columns` → pg_catalog for `list_all_columns`, and its missing TS dedup (audit P4.7) — small, but this wave is full; ledger it.

## Self-review notes

- Coverage vs audit wave-5 list: export worker (T1-T2), structure cache (T3), driver columnar (T4-T5), CSV Rust (T6-T7), MySQL binary (T8) — plus P4.7 items pg decoder (T4), app-event bus (T9), save-dialog filter (T2). Binary IPC consciously parked with reason.
- Scout deviations honored: formatter consolidation precedes worker (three divergent copies); ExportDialog fixed at the `getAllResults` stall, not just the worker; `affected_rows` fixed before any summary UI depends on it; MySQL switch gated on parity tests; `execute_columnar` defaulted so stub drivers compile.
- Type consistency: `ColumnarSlice`/`formatColumnar` (T1) used by T2; `BatchSummary`/`StatementOutcome` (T6) reused by T7; `PgDecoder` (T4) reused by T5; `AppEvent::QueryProgress` emitted by T6/T7, consumed by T9.
- Line numbers from 721d475 (pre-wave-4) — every task instructs grep-before-edit; wave 4 will shift DataGrid/Sidebar lines.
