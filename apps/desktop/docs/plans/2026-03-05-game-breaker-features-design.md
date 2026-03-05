# DataForge Game-Breaker Features Design

**Date**: 2026-03-05
**Approach**: Big Bang - All features implemented in parallel
**Goal**: Become the #1 database client on the market

---

## 1. AI Engine - Multi-Provider Intelligence

### Architecture
Unified AI service layer supporting Claude (Anthropic), OpenAI, and Ollama (local).
Each provider implements a common interface. The active provider is configurable in Settings.

### Components
- **AI Chat Panel** (`Ctrl+J`): Side panel for conversational DB interaction. Context-aware (knows current schema, tables, columns, FK). "Insert to Editor" button for generated SQL.
- **NL-to-SQL**: Comment-triggered (`-- natural language`) or `Ctrl+Shift+G`. Generates SQL from plain language using schema context.
- **Query Explainer**: Right-click → "Explain with AI". Natural language explanation + optimization suggestions.
- **Query Optimizer**: Analyzes slow queries, suggests indexes, rewrites for performance.
- **Schema Assistant**: Generate schemas from description, suggest migrations, detect anti-patterns.

### Provider Config (Settings Page)
- Provider selector (Claude / OpenAI / Ollama)
- API key fields for Claude and OpenAI
- Ollama server URL + model selector
- Streaming toggle
- Temperature / max tokens controls

### State: `aiStore.ts` (Zustand)
- Provider config, chat history, streaming state, pending generation

### New Dependencies
- None (direct HTTP/fetch calls to provider APIs)
- Streaming via ReadableStream/SSE

---

## 2. ER Diagrams - Interactive Schema Visualization

### Architecture
React Flow (@xyflow/react) canvas with custom table nodes and relation edges.
Auto-generated from schemaStore foreign key data.

### Components
- **ERDiagramView**: Main canvas component, new tab type
- **TableNode**: Custom React Flow node showing table name, columns (with PK/FK/type icons), collapsible
- **RelationEdge**: Custom edge with cardinality labels (1, N, *)
- **ERToolbar**: Zoom controls, auto-layout toggle, export buttons, AI analyze

### Features
- Auto-layout via dagre algorithm (top-down / left-right)
- Drag & drop table positioning
- Zoom/pan with minimap
- Multi-select tables
- Color coding by table type (table, view, junction)
- Double-click → open table in grid
- Right-click context menu (SELECT, DESCRIBE, etc.)
- Export: PNG, SVG, clipboard

### AI Integration
- "Explain this schema" button
- "Suggest improvements" analysis
- Highlight tables related to selected query

### New Dependencies
- `@xyflow/react` (React Flow v12)
- `dagre` (auto-layout algorithm)

---

## 3. Dashboard Builder

### Architecture
Grid-based dashboard with drag & drop widgets. Each widget = SQL query + chart config.
Uses react-grid-layout for positioning and recharts for visualization.

### Components
- **DashboardView**: Main dashboard container, new tab type
- **DashboardManager**: Create/delete/rename dashboards, stored in localStorage
- **WidgetCard**: Individual widget wrapper with title, refresh, edit, delete
- **WidgetConfigDialog**: Configure query, chart type, axis mapping, refresh interval
- **Chart components**: BarChartWidget, LineChartWidget, PieChartWidget, AreaChartWidget, ScatterWidget, KPICard, DataTableWidget, SQLTextWidget

### Widget Types
| Type | Description |
|------|-------------|
| Bar Chart | Vertical/horizontal bars |
| Line Chart | Multiple series, time-based |
| Pie / Donut | Category distribution |
| Area Chart | Filled line chart |
| Scatter Plot | X/Y correlation |
| KPI Card | Single value + % change |
| Data Table | Mini grid with query results |
| SQL Text | Raw query result display |

### Widget Config
- SQL query (editable with Monaco mini-editor)
- Column → axis mapping (X, Y, groupBy, color)
- Refresh interval (off, 5s, 30s, 1min, 5min)
- Title, colors (from theme), legend toggle

### AI Integration
- Natural language dashboard generation ("analyze my sales data")
- Auto-suggest widgets from schema analysis

### Export
- PNG screenshot, PDF export

### State: `dashboardStore.ts` (Zustand)
- Dashboards list, active dashboard, widgets, layouts

### New Dependencies
- `recharts`
- `react-grid-layout`

---

## 4. Query Performance Profiler

### Components
- **ExplainView**: Visual EXPLAIN ANALYZE tree
- **PlanNodeCard**: Individual plan node with cost, rows, time
- **BottleneckIndicator**: Color-coded performance (green/yellow/red)
- **IndexSuggestion**: AI-powered index recommendations

### Features
- Visual tree view of query execution plan
- Color-coded bottleneck identification
- Before/after comparison for optimizations
- AI-suggested index creation statements

---

## 5. Data Diff / Compare

### Components
- **DataDiffView**: Side-by-side comparison of two query results
- **DiffCell**: Highlighted cell showing added/removed/changed values

### Features
- Compare any 2 result sets
- Row-level and cell-level diff highlighting
- Added rows (green), removed (red), modified (yellow)
- Useful for migration verification and debugging

---

## 6. Smart Snippets

### Components
- **SnippetManager**: CRUD for SQL snippets
- **SnippetPalette**: Quick-insert panel (Ctrl+Shift+I)
- **SnippetEditor**: Edit snippet with variable placeholders

### Features
- Reusable SQL snippets with variables ($table_name, $date_range)
- Personal and shared snippet libraries
- AI-suggested snippets based on usage patterns
- Insert into editor with variable prompts

### State: `snippetStore.ts` (Zustand)

---

## 7. Query Versioning

### Components
- **QueryTimeline**: Visual history of query edits per tab
- **VersionDiffView**: Diff between two versions

### Features
- Auto-save query versions on execution
- Diff between versions
- Restore previous version
- Timeline visualization

### State: Stored in `queryStore.ts` as version array per tab

---

## 8. Data Masking

### Components
- **MaskingToggle**: Per-column masking toggle in grid header
- **MaskingConfig**: Settings for masking rules

### Features
- Auto-detect sensitive columns (email, phone, SSN, credit card) via regex patterns
- Visual masking (john@email.com → j***@e***.com)
- Toggle on/off per column
- "Production safe" mode (auto-mask all detected sensitive data)
- AI-enhanced detection for non-obvious sensitive fields

---

## 9. Database Health Monitor

### Components
- **HealthDashboard**: Overview of DB health metrics
- **ActiveConnections**: Live connection count
- **SlowQueryList**: Real-time slow query monitor
- **StorageOverview**: Table/index sizes

### Features
- Active connections count
- Slow queries in real-time
- Table/index size visualization
- Configurable alerts
- Works as a special dashboard tab

---

## Technical Decisions

### Libraries to Add
| Library | Purpose | Size |
|---------|---------|------|
| @xyflow/react | ER diagrams | ~150KB |
| dagre | Auto-layout | ~30KB |
| recharts | Charts | ~200KB |
| react-grid-layout | Dashboard grid | ~50KB |

### State Management
All new features use Zustand (consistent with existing stores):
- `aiStore.ts` - AI provider config, chat history, streaming
- `dashboardStore.ts` - Dashboards, widgets, layouts
- `snippetStore.ts` - SQL snippets
- `erDiagramStore.ts` - Diagram state, positions, layout

### Tab System Extension
Current tab types: 'query' | 'structure'
New tab types: 'er-diagram' | 'dashboard' | 'health-monitor' | 'data-diff'

### File Structure (new)
```
src/
├── components/
│   ├── ai/
│   │   ├── AiChatPanel.tsx
│   │   ├── AiMessage.tsx
│   │   ├── AiProviderConfig.tsx
│   │   └── NlToSqlInline.tsx
│   ├── er-diagram/
│   │   ├── ERDiagramView.tsx
│   │   ├── TableNode.tsx
│   │   ├── RelationEdge.tsx
│   │   └── ERToolbar.tsx
│   ├── dashboard/
│   │   ├── DashboardView.tsx
│   │   ├── DashboardManager.tsx
│   │   ├── WidgetCard.tsx
│   │   ├── WidgetConfigDialog.tsx
│   │   └── charts/
│   │       ├── BarChartWidget.tsx
│   │       ├── LineChartWidget.tsx
│   │       ├── PieChartWidget.tsx
│   │       ├── AreaChartWidget.tsx
│   │       ├── ScatterWidget.tsx
│   │       ├── KPICard.tsx
│   │       ├── DataTableWidget.tsx
│   │       └── SQLTextWidget.tsx
│   ├── profiler/
│   │   ├── ExplainView.tsx
│   │   └── PlanNodeCard.tsx
│   ├── diff/
│   │   ├── DataDiffView.tsx
│   │   └── DiffCell.tsx
│   ├── snippets/
│   │   ├── SnippetManager.tsx
│   │   ├── SnippetPalette.tsx
│   │   └── SnippetEditor.tsx
│   ├── masking/
│   │   ├── MaskingToggle.tsx
│   │   └── MaskingConfig.tsx
│   └── health/
│       ├── HealthDashboard.tsx
│       ├── ActiveConnections.tsx
│       └── SlowQueryList.tsx
├── stores/
│   ├── aiStore.ts
│   ├── dashboardStore.ts
│   ├── snippetStore.ts
│   └── erDiagramStore.ts
└── lib/
    ├── aiProviders/
    │   ├── types.ts
    │   ├── claudeProvider.ts
    │   ├── openaiProvider.ts
    │   └── ollamaProvider.ts
    ├── dataMasking.ts
    └── queryVersioning.ts
```
