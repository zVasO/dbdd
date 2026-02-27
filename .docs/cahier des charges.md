# DATAFORGE — Cahier des Charges Technique

## Instructions pour l'agent IA

Tu es un Staff Engineer spécialisé Rust + React/TypeScript. Tu dois implémenter **DataForge**, un outil de gestion de bases de données desktop (alternative moderne à TablePlus), en suivant ce cahier des charges **à la lettre**. Chaque section contient des instructions précises, des signatures de code, des patterns à respecter et des contraintes non négociables. Ne prends aucune liberté sur l'architecture — elle a été validée par le CTO.

---

## TABLE DES MATIÈRES

1. [Vue d'ensemble du projet](#1-vue-densemble)
2. [Stack technique imposée](#2-stack-technique)
3. [Structure du monorepo](#3-structure-monorepo)
4. [Architecture Rust — Domain Layer](#4-domain-layer)
5. [Architecture Rust — Infrastructure Layer (Drivers)](#5-infrastructure-drivers)
6. [Architecture Rust — Application Layer (Engine)](#6-application-engine)
7. [Architecture Rust — Tauri Commands (IPC)](#7-tauri-commands)
8. [Architecture Frontend — React](#8-frontend-react)
9. [Flux de données critiques](#9-flux-de-données)
10. [Sécurité](#10-sécurité)
11. [Performance & Optimisations](#11-performance)
12. [Tests](#12-tests)
13. [CI/CD & Release](#13-ci-cd)
14. [Roadmap d'exécution](#14-roadmap)
15. [Contraintes non négociables](#15-contraintes)

---

## 1. VUE D'ENSEMBLE

### 1.1 Produit

**DataForge** est une application desktop multi-plateforme (macOS, Windows, Linux) de gestion de bases de données. Elle permet de se connecter à des moteurs SQL et NoSQL, naviguer dans les schémas, écrire et exécuter des requêtes, éditer des données inline, et exporter des résultats.

### 1.2 Principes directeurs

- **Performance first** : Rust pour tout le calcul, React uniquement pour le rendu.
- **Database-agnostic core** : Le domaine ne connaît aucun driver concret. Tout passe par des traits.
- **Offline-first** : Aucune dépendance cloud. Config locale chiffrée.
- **Extensible** : Ajouter un nouveau driver = implémenter 4 traits dans un crate isolé.

### 1.3 Bases de données cibles

| Priorité | Moteur | Crate Rust |
|----------|--------|------------|
| P0 (MVP) | MySQL / MariaDB | `mysql_async` |
| P0 (MVP) | SQLite | `rusqlite` |
| P1 | PostgreSQL | `sqlx` avec feature `postgres` |
| P2 | MongoDB | `mongodb` |
| P3 | Redis, DuckDB, ClickHouse | À évaluer |

---

## 2. STACK TECHNIQUE

### 2.1 Versions exactes à utiliser

```toml
# rust-toolchain.toml
[toolchain]
channel = "stable"
components = ["rustfmt", "clippy"]
```

### 2.2 Dépendances Rust (Cargo.toml workspace)

```toml
[workspace]
resolver = "2"
members = [
    "apps/desktop/src-tauri",
    "crates/dataforge-core",
    "crates/dataforge-engine",
    "crates/dataforge-mysql",
    "crates/dataforge-sqlite",
    "crates/dataforge-postgres",
    "crates/dataforge-config",
]

[workspace.dependencies]
# Framework
tauri = { version = "2", features = ["tray-icon", "protocol-asset"] }
tauri-build = "2"

# Async
tokio = { version = "1", features = ["full"] }
tokio-stream = "0.1"
futures = "0.3"
async-trait = "0.1"

# Serialization
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# Error handling
thiserror = "2"
anyhow = "1"

# Database drivers
sqlx = { version = "0.8", features = ["runtime-tokio", "tls-rustls", "postgres", "sqlite", "chrono", "uuid", "json"] }
mysql_async = "0.34"
rusqlite = { version = "0.32", features = ["bundled"] }

# SSH
russh = "0.46"
russh-keys = "0.46"

# Security
keyring = "3"

# Utils
uuid = { version = "1", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
dashmap = "6"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
```

### 2.3 Dépendances Frontend (package.json)

```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-shell": "^2.0.0",
    "zustand": "^5.0.0",
    "@monaco-editor/react": "^4.7.0",
    "monaco-editor": "^0.52.0",
    "@tanstack/react-table": "^8.20.0",
    "@tanstack/react-virtual": "^3.10.0",
    "cmdk": "^1.0.0",
    "react-resizable-panels": "^2.1.0",
    "react-arborist": "^3.4.0",
    "lucide-react": "^0.460.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.6.0",
    "class-variance-authority": "^0.7.0",
    "tailwindcss-animate": "^1.0.7"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "eslint": "^9.0.0",
    "vitest": "^2.1.0",
    "@testing-library/react": "^16.0.0"
  }
}
```

---

## 3. STRUCTURE MONOREPO

Crée exactement cette structure. Ne renomme rien. Ne déplace rien.

```
dataforge/
│
├── rust-toolchain.toml
├── Cargo.toml                          # Workspace root
├── package.json                        # pnpm workspace root
├── pnpm-workspace.yaml                 # content: "packages:\n  - apps/*"
├── .gitignore
├── README.md
│
├── crates/
│   ├── dataforge-core/                 # DOMAIN LAYER — zéro dépendance externe DB
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs                  # Re-exports publics
│   │       ├── error.rs                # DataForgeError enum
│   │       ├── models/
│   │       │   ├── mod.rs
│   │       │   ├── connection.rs       # ConnectionConfig, DatabaseType, SslMode
│   │       │   ├── query.rs            # QueryResult, ColumnMeta, Row, CellValue
│   │       │   ├── schema.rs           # DatabaseInfo, SchemaInfo, TableInfo, ColumnInfo, IndexInfo, ForeignKeyInfo
│   │       │   └── types.rs            # DataType enum unifié, Value enum
│   │       └── ports/
│   │           ├── mod.rs
│   │           ├── connection.rs       # trait DatabaseConnection
│   │           ├── schema.rs           # trait SchemaInspector
│   │           ├── dialect.rs          # trait QueryDialect
│   │           └── repository.rs       # trait ConnectionRepository, trait QueryRepository
│   │
│   ├── dataforge-engine/               # APPLICATION LAYER — orchestration
│   │   ├── Cargo.toml                  # depends on: dataforge-core
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── connection_manager.rs   # ConnectionManager struct
│   │       ├── query_executor.rs       # QueryExecutor struct
│   │       ├── driver_registry.rs      # DriverRegistry struct
│   │       ├── command_history.rs      # CommandHistory, DataCommand trait
│   │       ├── event_bus.rs            # EventBus, AppEvent enum
│   │       ├── schema_cache.rs         # SchemaCache struct
│   │       ├── ssh_tunnel.rs           # SshTunnelManager struct
│   │       └── export_service.rs       # ExportService (CSV, JSON, SQL)
│   │
│   ├── dataforge-mysql/                # DRIVER — MySQL/MariaDB (MVP)
│   │   ├── Cargo.toml                  # depends on: dataforge-core, mysql_async
│   │   └── src/
│   │       ├── lib.rs                  # MySqlDriverFactory (pub)
│   │       ├── connection.rs           # MySqlConnection impl DatabaseConnection
│   │       ├── schema_inspector.rs     # MySqlSchemaInspector impl SchemaInspector
│   │       ├── dialect.rs              # MySqlDialect impl QueryDialect
│   │       └── type_mapping.rs         # MySQL type → DataType mapping
│   │
│   ├── dataforge-sqlite/               # DRIVER — SQLite
│   │   ├── Cargo.toml                  # depends on: dataforge-core, rusqlite
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── connection.rs
│   │       ├── schema_inspector.rs
│   │       ├── dialect.rs
│   │       └── type_mapping.rs
│   │
│   ├── dataforge-postgres/             # DRIVER — PostgreSQL (Phase P1)
│   │   ├── Cargo.toml                  # depends on: dataforge-core, sqlx
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── connection.rs
│   │       ├── schema_inspector.rs
│   │       ├── dialect.rs
│   │       └── type_mapping.rs
│   │
│   └── dataforge-config/               # CONFIG — SQLite interne pour les préférences
│       ├── Cargo.toml                  # depends on: dataforge-core, rusqlite
│       └── src/
│           ├── lib.rs
│           ├── store.rs                # ConfigStore struct
│           ├── migrations.rs           # Schema migrations
│           └── repository_impl.rs      # impl ConnectionRepository, impl QueryRepository
│
└── apps/
    └── desktop/
        ├── src-tauri/
        │   ├── Cargo.toml              # depends on: all crates above
        │   ├── tauri.conf.json
        │   ├── capabilities/
        │   │   └── default.json
        │   ├── icons/
        │   └── src/
        │       ├── main.rs             # Tauri entry point
        │       ├── lib.rs              # Tauri setup, plugin registration
        │       ├── state.rs            # AppState struct (Tauri managed state)
        │       └── commands/
        │           ├── mod.rs
        │           ├── connection.rs   # #[tauri::command] connect, disconnect, test_connection, list_connections
        │           ├── query.rs        # #[tauri::command] execute_query, cancel_query, explain_query
        │           ├── schema.rs       # #[tauri::command] list_databases, list_schemas, list_tables, get_table_structure
        │           ├── data.rs         # #[tauri::command] update_rows, insert_rows, delete_rows
        │           └── export.rs       # #[tauri::command] export_csv, export_json, export_sql
        │
        ├── src/
        │   ├── main.tsx                # React entry point
        │   ├── App.tsx                 # Root component avec routing
        │   ├── styles/
        │   │   └── globals.css         # Tailwind imports + theme tokens CSS variables
        │   │
        │   ├── lib/
        │   │   ├── ipc.ts             # Typed wrappers around Tauri invoke()
        │   │   ├── types.ts           # TypeScript types mirroring Rust models (MUST match exactly)
        │   │   ├── utils.ts           # cn() helper (clsx + tailwind-merge) — requis par shadcn/ui
        │   │   └── constants.ts       # App-wide constants
        │   │
        │   ├── stores/
        │   │   ├── connectionStore.ts  # Zustand store — connections state
        │   │   ├── queryStore.ts       # Zustand store — tabs, results, history
        │   │   ├── schemaStore.ts      # Zustand store — tree state, cache
        │   │   ├── uiStore.ts          # Zustand store — sidebar, panels, theme
        │   │   └── settingsStore.ts    # Zustand store — preferences
        │   │
        │   ├── hooks/
        │   │   ├── useTauriEvent.ts    # Subscribe to Tauri events
        │   │   ├── useConnection.ts    # Connection context hook
        │   │   ├── useQueryExecution.ts # Execute + track query state
        │   │   └── useKeyboardShortcut.ts
        │   │
        │   ├── components/
        │   │   ├── ui/                 # Composants shadcn/ui (installés via CLI)
        │   │   │   ├── button.tsx
        │   │   │   ├── input.tsx
        │   │   │   ├── select.tsx
        │   │   │   ├── dialog.tsx
        │   │   │   ├── dropdown-menu.tsx
        │   │   │   ├── context-menu.tsx
        │   │   │   ├── toast.tsx
        │   │   │   ├── toaster.tsx
        │   │   │   ├── tabs.tsx
        │   │   │   ├── tooltip.tsx
        │   │   │   ├── badge.tsx
        │   │   │   ├── separator.tsx
        │   │   │   ├── scroll-area.tsx
        │   │   │   ├── popover.tsx
        │   │   │   ├── command.tsx        # Utilisé par CommandPalette (basé sur cmdk)
        │   │   │   ├── table.tsx          # Pour les vues structure/indexes
        │   │   │   ├── sheet.tsx          # Panels latéraux (settings, detail)
        │   │   │   ├── skeleton.tsx       # Loading states
        │   │   │   ├── alert.tsx
        │   │   │   └── sonner.tsx         # Alternative toast (si sonner préféré)
        │   │   │
        │   │   ├── layout/
        │   │   │   ├── AppLayout.tsx           # Layout principal : sidebar + main + statusbar
        │   │   │   ├── Sidebar.tsx             # Sidebar gauche : connections + schema tree
        │   │   │   ├── StatusBar.tsx           # Barre en bas : connection info, query time, row count
        │   │   │   ├── PanelLayout.tsx         # Panels resizable : editor en haut, résultats en bas
        │   │   │   └── CommandPalette.tsx      # Cmd+K — command palette (cmdk)
        │   │   │
        │   │   ├── connection/
        │   │   │   ├── ConnectionList.tsx      # Liste des connexions sauvegardées
        │   │   │   ├── ConnectionForm.tsx      # Formulaire nouvelle connexion / édition
        │   │   │   ├── ConnectionCard.tsx      # Carte individuelle d'une connexion
        │   │   │   └── ConnectionStatus.tsx    # Indicateur de statut (connected, error, etc.)
        │   │   │
        │   │   ├── schema/
        │   │   │   ├── SchemaTree.tsx          # Arbre navigable (databases > schemas > tables > columns)
        │   │   │   ├── SchemaTreeNode.tsx      # Noeud individuel de l'arbre
        │   │   │   ├── TableDetail.tsx         # Panel détail d'une table (structure, indexes, FK)
        │   │   │   └── TableActions.tsx        # Actions contextuelles (truncate, drop, export, etc.)
        │   │   │
        │   │   ├── editor/
        │   │   │   ├── SqlEditor.tsx           # Wrapper Monaco Editor avec config SQL
        │   │   │   ├── EditorTabs.tsx          # Onglets de requêtes (closeable, renameable)
        │   │   │   ├── EditorToolbar.tsx       # Boutons : Run, Explain, Format, Save
        │   │   │   └── QueryHistory.tsx        # Historique des requêtes exécutées
        │   │   │
        │   │   ├── grid/
        │   │   │   ├── DataGrid.tsx            # Composant principal du grid
        │   │   │   ├── DataGridToolbar.tsx     # Toolbar : search, filter, export, pagination
        │   │   │   ├── VirtualizedBody.tsx     # Corps virtualisé (TanStack Virtual)
        │   │   │   ├── ColumnHeader.tsx        # Header de colonne (sort, resize, type icon)
        │   │   │   ├── CellRenderer.tsx        # Dispatcher vers les renderers spécialisés
        │   │   │   ├── InlineEditor.tsx        # Éditeur inline de cellule
        │   │   │   ├── renderers/
        │   │   │   │   ├── TextCell.tsx
        │   │   │   │   ├── NumberCell.tsx
        │   │   │   │   ├── BooleanCell.tsx
        │   │   │   │   ├── DateCell.tsx
        │   │   │   │   ├── JsonCell.tsx        # Clic = ouvre un viewer JSON formaté
        │   │   │   │   ├── NullCell.tsx        # Affiche "NULL" en gris italique
        │   │   │   │   ├── BlobCell.tsx        # Affiche taille + bouton download
        │   │   │   │   └── ForeignKeyCell.tsx  # Lien cliquable vers la table référencée
        │   │   │   └── PendingChanges.tsx      # Barre : "3 pending changes" + Apply / Discard
        │   │   │
        │   │   └── shared/
        │   │       ├── LoadingSpinner.tsx
        │   │       ├── EmptyState.tsx
        │   │       └── ErrorBoundary.tsx
        │   │
        │   └── pages/
        │       ├── WelcomePage.tsx             # Page d'accueil quand aucune connexion active
        │       └── WorkspacePage.tsx           # Page principale après connexion
        │
        ├── index.html
        ├── components.json               # shadcn/ui config
        ├── package.json
        ├── tsconfig.json
        ├── vite.config.ts
        └── tailwind.config.ts
```

---

## 4. DOMAIN LAYER — `dataforge-core`

Ce crate est le cœur du système. Il ne dépend d'**aucun** driver de base de données. Uniquement `serde`, `async-trait`, `thiserror`, `uuid`, `chrono`.

### 4.1 Error types — `error.rs`

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DataForgeError {
    #[error("Connection error: {0}")]
    Connection(String),

    #[error("Authentication failed: {0}")]
    Authentication(String),

    #[error("Query execution error: {0}")]
    QueryExecution(String),

    #[error("Query cancelled by user")]
    QueryCancelled,

    #[error("Query timeout after {0}ms")]
    QueryTimeout(u64),

    #[error("Schema inspection error: {0}")]
    SchemaInspection(String),

    #[error("SSH tunnel error: {0}")]
    SshTunnel(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Driver not found for type: {0}")]
    DriverNotFound(String),

    #[error("Feature not supported: {0}")]
    NotSupported(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, DataForgeError>;

// Implémente serde::Serialize pour pouvoir envoyer les erreurs au frontend via Tauri
impl serde::Serialize for DataForgeError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
```

### 4.2 Models — `models/connection.rs`

```rust
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: Uuid,
    pub name: String,
    pub db_type: DatabaseType,
    pub host: String,
    pub port: u16,
    pub username: String,
    // Le mot de passe n'est PAS stocké ici — il est dans le keyring OS
    pub database: Option<String>,
    pub ssl_mode: SslMode,
    pub ssh_tunnel: Option<SshTunnelConfig>,
    pub color: Option<String>,       // Hex color pour identifier visuellement la connexion
    pub pool_size: Option<u32>,      // Default: 5
    pub query_timeout_ms: Option<u64>, // Default: 30000
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseType {
    Mysql,
    Sqlite,
    Postgres,
    Mongodb,
}

impl DatabaseType {
    pub fn default_port(&self) -> u16 {
        match self {
            Self::Mysql => 3306,
            Self::Sqlite => 0,
            Self::Postgres => 5432,
            Self::Mongodb => 27017,
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Mysql => "MySQL",
            Self::Sqlite => "SQLite",
            Self::Postgres => "PostgreSQL",
            Self::Mongodb => "MongoDB",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SslMode {
    #[default]
    Disable,
    Prefer,
    Require,
    VerifyCa,
    VerifyFull,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshTunnelConfig {
    pub host: String,
    pub port: u16,        // Default: 22
    pub username: String,
    pub auth_method: SshAuthMethod,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SshAuthMethod {
    Password,                              // Password stored in keyring
    PrivateKey { key_path: String },       // Path to private key file
    Agent,                                 // Use ssh-agent
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedConnection {
    pub config: ConnectionConfig,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_used_at: Option<chrono::DateTime<chrono::Utc>>,
    pub sort_order: i32,
}
```

### 4.3 Models — `models/query.rs`

```rust
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub query_id: Uuid,
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Row>,
    pub total_rows: Option<u64>,      // Nombre total si connu (COUNT)
    pub affected_rows: Option<u64>,   // Pour INSERT/UPDATE/DELETE
    pub execution_time_ms: u64,
    pub warnings: Vec<String>,
    pub result_type: ResultType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ResultType {
    Select,
    Insert,
    Update,
    Delete,
    DDL,        // CREATE, ALTER, DROP
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: DataType,
    pub native_type: String,     // Type brut du moteur (ex: "int4", "varchar(255)")
    pub nullable: bool,
    pub is_primary_key: bool,
    pub max_length: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Row {
    pub cells: Vec<CellValue>,
}

/// Enum sérialisé en JSON tagué : { "type": "Text", "value": "hello" }
/// Le frontend utilise le champ `type` pour choisir le renderer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum CellValue {
    Null,
    Integer(i64),
    Float(f64),
    Boolean(bool),
    Text(String),
    Json(serde_json::Value),
    DateTime(String),           // ISO 8601 string
    Date(String),               // YYYY-MM-DD
    Time(String),               // HH:MM:SS
    Uuid(String),
    Bytes { size: u64, preview: String },  // Pour BLOB/BYTEA
    Array(Vec<CellValue>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryHistoryEntry {
    pub id: Uuid,
    pub connection_id: Uuid,
    pub sql: String,
    pub executed_at: chrono::DateTime<chrono::Utc>,
    pub duration_ms: u64,
    pub row_count: Option<u64>,
    pub status: QueryStatus,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum QueryStatus {
    Success,
    Error,
    Cancelled,
}
```

### 4.4 Models — `models/schema.rs`

```rust
use serde::{Deserialize, Serialize};

/// Référence unique à une table : database.schema.table
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct TableRef {
    pub database: Option<String>,
    pub schema: Option<String>,   // None pour MySQL/SQLite, "public" pour Postgres
    pub table: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseInfo {
    pub name: String,
    pub size_bytes: Option<u64>,
    pub encoding: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaInfo {
    pub name: String,
    pub owner: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub table_type: TableType,     // Table, View, MaterializedView
    pub row_count_estimate: Option<u64>,
    pub size_bytes: Option<u64>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TableType {
    Table,
    View,
    MaterializedView,
    ForeignTable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableStructure {
    pub table_ref: TableRef,
    pub columns: Vec<ColumnInfo>,
    pub primary_key: Option<PrimaryKeyInfo>,
    pub indexes: Vec<IndexInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
    pub constraints: Vec<ConstraintInfo>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,         // Type natif (ex: "character varying(255)")
    pub mapped_type: DataType,     // Type unifié interne
    pub nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
    pub ordinal_position: i32,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrimaryKeyInfo {
    pub name: Option<String>,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
    pub index_type: String,        // btree, hash, gin, gist, etc.
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKeyInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub referenced_table: TableRef,
    pub referenced_columns: Vec<String>,
    pub on_update: FkAction,
    pub on_delete: FkAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FkAction {
    NoAction,
    Restrict,
    Cascade,
    SetNull,
    SetDefault,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConstraintInfo {
    pub name: String,
    pub constraint_type: ConstraintType,
    pub columns: Vec<String>,
    pub definition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConstraintType {
    PrimaryKey,
    Unique,
    Check,
    Exclusion,
    ForeignKey,
}
```

### 4.5 Models — `models/types.rs`

```rust
use serde::{Deserialize, Serialize};

/// Type de données unifié, indépendant de tout moteur.
/// Chaque driver mappe ses types natifs vers cet enum.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DataType {
    // Numeric
    SmallInt,
    Integer,
    BigInt,
    Float,
    Double,
    Decimal { precision: Option<u32>, scale: Option<u32> },
    Serial,
    BigSerial,

    // Boolean
    Boolean,

    // String
    Char(Option<u32>),
    Varchar(Option<u32>),
    Text,

    // Binary
    Blob,
    Bytea,

    // Date/Time
    Date,
    Time,
    TimeTz,
    Timestamp,
    TimestampTz,
    Interval,

    // JSON
    Json,
    Jsonb,

    // UUID
    Uuid,

    // Network
    Inet,
    Cidr,
    MacAddr,

    // Geometric (Postgres)
    Point,
    Line,
    Box,
    Circle,

    // Array
    Array(Box<DataType>),

    // Enum
    Enum { name: String, values: Vec<String> },

    // Fallback
    Unknown(String),
}
```

### 4.6 Ports (Traits) — `ports/connection.rs`

```rust
use async_trait::async_trait;
use crate::models::query::{QueryResult, CellValue};
use crate::error::Result;
use uuid::Uuid;

/// Trait principal pour l'interaction avec une base de données.
/// Chaque driver (mysql, sqlite, postgres) implémente ce trait.
///
/// CONTRAT :
/// - Toutes les méthodes sont async et Send + Sync
/// - execute() retourne un QueryResult unifié
/// - Les erreurs sont mappées vers DataForgeError
/// - cancel_query() doit être thread-safe (appelé depuis un autre thread)
#[async_trait]
pub trait DatabaseConnection: Send + Sync {
    /// Exécute une requête SQL brute et retourne le résultat complet.
    async fn execute(&self, sql: &str) -> Result<QueryResult>;

    /// Exécute une requête avec des paramètres positionnels (? pour MySQL/SQLite, $1, $2... pour Postgres).
    async fn execute_with_params(&self, sql: &str, params: &[CellValue]) -> Result<QueryResult>;

    /// Annule une requête en cours d'exécution par son ID.
    async fn cancel_query(&self, query_id: &Uuid) -> Result<()>;

    /// Teste que la connexion est toujours active.
    async fn ping(&self) -> Result<()>;

    /// Retourne la version du serveur de base de données.
    async fn server_version(&self) -> Result<String>;

    /// Ferme proprement la connexion et libère les ressources.
    async fn close(&self) -> Result<()>;
}
```

### 4.7 Ports (Traits) — `ports/schema.rs`

```rust
use async_trait::async_trait;
use crate::models::schema::*;
use crate::error::Result;

/// Inspecte le schéma d'une base de données.
/// Chaque driver implémente les requêtes spécifiques à son information_schema.
#[async_trait]
pub trait SchemaInspector: Send + Sync {
    /// Liste toutes les bases de données accessibles.
    async fn list_databases(&self) -> Result<Vec<DatabaseInfo>>;

    /// Liste les schémas d'une base (MySQL: N/A, SQLite: N/A, Postgres: public, pg_catalog...).
    async fn list_schemas(&self, database: &str) -> Result<Vec<SchemaInfo>>;

    /// Liste les tables et vues d'un schéma.
    async fn list_tables(&self, database: &str, schema: Option<&str>) -> Result<Vec<TableInfo>>;

    /// Retourne la structure complète d'une table (colonnes, PK, indexes, FK, contraintes).
    async fn get_table_structure(&self, table: &TableRef) -> Result<TableStructure>;
}
```

### 4.8 Ports (Traits) — `ports/dialect.rs`

```rust
use crate::models::schema::TableRef;
use crate::models::types::DataType;

/// Gère les différences de syntaxe SQL entre les moteurs.
/// Utilisé par le frontend pour construire des requêtes sans connaître le moteur.
pub trait QueryDialect: Send + Sync {
    /// Quote un identifiant (table, colonne). `table` pour MySQL, "table" pour Postgres.
    fn quote_identifier(&self, identifier: &str) -> String;

    /// Construit la clause LIMIT/OFFSET.
    fn limit_offset_clause(&self, limit: u64, offset: u64) -> String;

    /// Construit un SELECT paginé sur une table.
    fn build_select_all(&self, table: &TableRef, limit: u64, offset: u64) -> String;

    /// Construit un SELECT COUNT(*) sur une table.
    fn build_count(&self, table: &TableRef) -> String;

    /// Mappe un type natif (string retourné par le driver) vers le DataType unifié.
    fn map_native_type(&self, native_type: &str) -> DataType;
}
```

### 4.9 Ports (Traits) — `ports/repository.rs`

```rust
use async_trait::async_trait;
use crate::models::connection::SavedConnection;
use crate::models::query::QueryHistoryEntry;
use crate::error::Result;
use uuid::Uuid;

/// Persiste les connexions sauvegardées (dans SQLite interne).
#[async_trait]
pub trait ConnectionRepository: Send + Sync {
    async fn list_all(&self) -> Result<Vec<SavedConnection>>;
    async fn get_by_id(&self, id: &Uuid) -> Result<Option<SavedConnection>>;
    async fn save(&self, connection: &SavedConnection) -> Result<()>;
    async fn delete(&self, id: &Uuid) -> Result<()>;
    async fn update_last_used(&self, id: &Uuid) -> Result<()>;
}

/// Persiste l'historique des requêtes.
#[async_trait]
pub trait QueryRepository: Send + Sync {
    async fn add_to_history(&self, entry: &QueryHistoryEntry) -> Result<()>;
    async fn get_history(&self, connection_id: &Uuid, limit: u32) -> Result<Vec<QueryHistoryEntry>>;
    async fn clear_history(&self, connection_id: &Uuid) -> Result<()>;
    async fn search_history(&self, connection_id: &Uuid, query: &str, limit: u32) -> Result<Vec<QueryHistoryEntry>>;
}
```

---

## 5. INFRASTRUCTURE — DRIVERS

### 5.1 Driver Factory Pattern

Chaque driver expose un struct public `XxxDriverFactory` qui sert de point d'entrée.

```rust
// Trait à implémenter par chaque driver factory
// Dans dataforge-engine/src/driver_registry.rs

use async_trait::async_trait;
use dataforge_core::models::connection::ConnectionConfig;
use dataforge_core::ports::connection::DatabaseConnection;
use dataforge_core::ports::schema::SchemaInspector;
use dataforge_core::ports::dialect::QueryDialect;
use dataforge_core::error::Result;
use std::sync::Arc;

#[async_trait]
pub trait DatabaseDriverFactory: Send + Sync {
    /// Crée une nouvelle connexion à partir de la config.
    /// Le password doit être passé séparément (il vient du keyring).
    async fn create_connection(
        &self,
        config: &ConnectionConfig,
        password: Option<&str>,
    ) -> Result<Arc<dyn DatabaseConnection>>;

    /// Crée un inspecteur de schéma lié à cette connexion.
    fn create_schema_inspector(
        &self,
        conn: Arc<dyn DatabaseConnection>,
    ) -> Arc<dyn SchemaInspector>;

    /// Retourne le dialecte SQL de ce moteur.
    fn dialect(&self) -> Arc<dyn QueryDialect>;
}
```

### 5.2 MySQL/MariaDB Driver — Implémentation (MVP)

Fichier `crates/dataforge-mysql/src/connection.rs` — implémente `DatabaseConnection` en utilisant `mysql_async`.

Requêtes clés pour le `schema_inspector.rs` MySQL :

```sql
-- list_databases
SELECT SCHEMA_NAME AS name,
       ROUND(SUM(DATA_LENGTH + INDEX_LENGTH)) AS size_bytes,
       DEFAULT_CHARACTER_SET_NAME AS encoding
FROM information_schema.SCHEMATA s
LEFT JOIN information_schema.TABLES t ON s.SCHEMA_NAME = t.TABLE_SCHEMA
WHERE SCHEMA_NAME NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
GROUP BY SCHEMA_NAME, DEFAULT_CHARACTER_SET_NAME
ORDER BY SCHEMA_NAME;

-- list_tables (MySQL n'a pas de "schema" — le concept équivalent est la database)
SELECT TABLE_NAME AS name,
       TABLE_TYPE AS table_type,
       TABLE_ROWS AS row_count_estimate,
       DATA_LENGTH + INDEX_LENGTH AS size_bytes,
       TABLE_COMMENT AS comment
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = ?
ORDER BY TABLE_NAME;

-- get_columns
SELECT COLUMN_NAME AS name,
       COLUMN_TYPE AS data_type,
       IS_NULLABLE = 'YES' AS nullable,
       COLUMN_DEFAULT AS default_value,
       ORDINAL_POSITION AS ordinal_position,
       COLUMN_COMMENT AS comment,
       COLUMN_KEY = 'PRI' AS is_primary_key,
       EXTRA AS extra
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
ORDER BY ORDINAL_POSITION;

-- get_primary_key
SELECT COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = ?
  AND TABLE_NAME = ?
  AND CONSTRAINT_NAME = 'PRIMARY'
ORDER BY ORDINAL_POSITION;

-- get_indexes
SELECT INDEX_NAME AS name,
       GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns,
       NOT NON_UNIQUE AS is_unique,
       INDEX_NAME = 'PRIMARY' AS is_primary,
       INDEX_TYPE AS index_type
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
GROUP BY INDEX_NAME, NON_UNIQUE, INDEX_TYPE;

-- get_foreign_keys
SELECT CONSTRAINT_NAME AS name,
       GROUP_CONCAT(DISTINCT COLUMN_NAME) AS columns,
       REFERENCED_TABLE_SCHEMA AS ref_schema,
       REFERENCED_TABLE_NAME AS ref_table,
       GROUP_CONCAT(DISTINCT REFERENCED_COLUMN_NAME) AS ref_columns,
       UPDATE_RULE AS on_update,
       DELETE_RULE AS on_delete
FROM information_schema.KEY_COLUMN_USAGE kcu
JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
  ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
  AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA
WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
GROUP BY CONSTRAINT_NAME, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, UPDATE_RULE, DELETE_RULE;
```

**Notes spécifiques MySQL :**
- MySQL utilise `?` comme placeholder de paramètre (pas `$1, $2` comme PostgreSQL)
- MySQL n'a pas de "schémas" au sens PostgreSQL — une "database" MySQL équivaut à un schéma
- `COLUMN_TYPE` retourne le type complet avec taille (ex: `varchar(255)`, `int(11)`)
- `TABLE_ROWS` est une estimation pour InnoDB, exacte pour MyISAM
- Les backticks `` ` `` sont utilisées pour quoter les identifiants (pas les guillemets doubles)

### 5.3 SQLite Driver

Même structure mais requêtes adaptées :

```sql
-- list_tables
SELECT name, type AS table_type
FROM sqlite_master
WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
ORDER BY name;

-- get_columns (PRAGMA)
PRAGMA table_info('table_name');
-- Retourne: cid, name, type, notnull, dflt_value, pk

-- get_indexes
PRAGMA index_list('table_name');
-- Puis pour chaque index:
PRAGMA index_info('index_name');

-- get_foreign_keys
PRAGMA foreign_key_list('table_name');
```

### 5.4 PostgreSQL Driver (Phase P1)

Fichier `crates/dataforge-postgres/src/connection.rs` — implémente `DatabaseConnection` en utilisant `sqlx::PgPool`.

Requêtes clés pour le `schema_inspector.rs` PostgreSQL :

```sql
-- list_databases
SELECT datname AS name,
       pg_database_size(datname) AS size_bytes,
       pg_encoding_to_char(encoding) AS encoding
FROM pg_database
WHERE datistemplate = false
ORDER BY datname;

-- list_schemas
SELECT schema_name AS name,
       schema_owner AS owner
FROM information_schema.schemata
WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
ORDER BY schema_name;

-- list_tables
SELECT t.table_name AS name,
       t.table_type,
       COALESCE(s.n_live_tup, 0) AS row_count_estimate,
       pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name)) AS size_bytes,
       obj_description((quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::regclass) AS comment
FROM information_schema.tables t
LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name AND s.schemaname = t.table_schema
WHERE t.table_schema = $1
ORDER BY t.table_name;

-- get_columns
SELECT c.column_name AS name,
       c.data_type || COALESCE('(' || c.character_maximum_length || ')', '') AS data_type,
       c.is_nullable = 'YES' AS nullable,
       c.column_default AS default_value,
       c.ordinal_position,
       col_description((quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass, c.ordinal_position) AS comment
FROM information_schema.columns c
WHERE c.table_schema = $1 AND c.table_name = $2
ORDER BY c.ordinal_position;

-- get_primary_key
SELECT kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_schema = $1
  AND tc.table_name = $2
  AND tc.constraint_type = 'PRIMARY KEY'
ORDER BY kcu.ordinal_position;

-- get_indexes
SELECT i.relname AS name,
       array_agg(a.attname ORDER BY x.n) AS columns,
       ix.indisunique AS is_unique,
       ix.indisprimary AS is_primary,
       am.amname AS index_type
FROM pg_index ix
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_am am ON am.oid = i.relam
CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, n)
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
WHERE n.nspname = $1 AND t.relname = $2
GROUP BY i.relname, ix.indisunique, ix.indisprimary, am.amname;

-- get_foreign_keys
SELECT
    tc.constraint_name AS name,
    array_agg(DISTINCT kcu.column_name) AS columns,
    ccu.table_schema AS ref_schema,
    ccu.table_name AS ref_table,
    array_agg(DISTINCT ccu.column_name) AS ref_columns,
    rc.update_rule AS on_update,
    rc.delete_rule AS on_delete
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'FOREIGN KEY'
GROUP BY tc.constraint_name, ccu.table_schema, ccu.table_name, rc.update_rule, rc.delete_rule;
```

---

## 6. APPLICATION LAYER — `dataforge-engine`

### 6.1 Driver Registry — `driver_registry.rs`

```rust
use std::collections::HashMap;
use std::sync::Arc;
use dataforge_core::models::connection::DatabaseType;

pub struct DriverRegistry {
    factories: HashMap<DatabaseType, Arc<dyn DatabaseDriverFactory>>,
}

impl DriverRegistry {
    pub fn new() -> Self {
        let mut factories: HashMap<DatabaseType, Arc<dyn DatabaseDriverFactory>> = HashMap::new();

        // Enregistrer les drivers disponibles.
        // Chaque driver est compilé conditionnellement via des features Cargo.
        #[cfg(feature = "mysql")]
        factories.insert(DatabaseType::Mysql, Arc::new(dataforge_mysql::MySqlDriverFactory));

        #[cfg(feature = "sqlite")]
        factories.insert(DatabaseType::Sqlite, Arc::new(dataforge_sqlite::SqliteDriverFactory));

        #[cfg(feature = "postgres")]
        factories.insert(DatabaseType::Postgres, Arc::new(dataforge_postgres::PostgresDriverFactory));

        Self { factories }
    }

    pub fn get_factory(&self, db_type: &DatabaseType) -> Option<Arc<dyn DatabaseDriverFactory>> {
        self.factories.get(db_type).cloned()
    }
}
```

### 6.2 Connection Manager — `connection_manager.rs`

```rust
use dashmap::DashMap;
use std::sync::Arc;
use uuid::Uuid;
use dataforge_core::ports::connection::DatabaseConnection;
use dataforge_core::ports::schema::SchemaInspector;
use dataforge_core::ports::dialect::QueryDialect;

pub struct ActiveConnection {
    pub connection: Arc<dyn DatabaseConnection>,
    pub schema_inspector: Arc<dyn SchemaInspector>,
    pub dialect: Arc<dyn QueryDialect>,
    pub config_id: Uuid,
}

pub struct ConnectionManager {
    connections: DashMap<Uuid, ActiveConnection>,
    driver_registry: Arc<DriverRegistry>,
}

impl ConnectionManager {
    /// Se connecte à une base de données et stocke la connexion active.
    /// Retourne le connection_id unique de la session.
    pub async fn connect(&self, config: &ConnectionConfig, password: Option<&str>) -> Result<Uuid> {
        let factory = self.driver_registry
            .get_factory(&config.db_type)
            .ok_or_else(|| DataForgeError::DriverNotFound(config.db_type.display_name().to_string()))?;

        let conn = factory.create_connection(config, password).await?;
        conn.ping().await?; // Vérifie que la connexion fonctionne

        let connection_id = Uuid::new_v4();
        let active = ActiveConnection {
            connection: conn.clone(),
            schema_inspector: factory.create_schema_inspector(conn),
            dialect: factory.dialect(),
            config_id: config.id,
        };

        self.connections.insert(connection_id, active);
        Ok(connection_id)
    }

    pub async fn disconnect(&self, connection_id: &Uuid) -> Result<()> {
        if let Some((_, active)) = self.connections.remove(connection_id) {
            active.connection.close().await?;
        }
        Ok(())
    }

    pub fn get(&self, connection_id: &Uuid) -> Option<dashmap::mapref::one::Ref<Uuid, ActiveConnection>> {
        self.connections.get(connection_id)
    }
}
```

### 6.3 Event Bus — `event_bus.rs`

```rust
use serde::Serialize;
use uuid::Uuid;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize, Debug)]
#[serde(tag = "event_type", content = "payload")]
pub enum AppEvent {
    // Connection lifecycle
    ConnectionEstablished { connection_id: Uuid },
    ConnectionClosed { connection_id: Uuid },
    ConnectionError { connection_id: Uuid, error: String },

    // Query lifecycle
    QueryStarted { query_id: Uuid, sql: String },
    QueryProgress { query_id: Uuid, rows_fetched: u64, elapsed_ms: u64 },
    QueryCompleted { query_id: Uuid, row_count: u64, elapsed_ms: u64 },
    QueryError { query_id: Uuid, error: String },
    QueryCancelled { query_id: Uuid },
}

pub struct EventBus {
    app_handle: AppHandle,
}

impl EventBus {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    pub fn emit(&self, event: AppEvent) {
        // Le frontend écoute sur "app-event"
        let _ = self.app_handle.emit("app-event", &event);
    }
}
```

### 6.4 Schema Cache — `schema_cache.rs`

```rust
use dashmap::DashMap;
use std::time::{Duration, Instant};
use dataforge_core::models::schema::{TableRef, TableStructure, TableInfo};

const DEFAULT_TTL: Duration = Duration::from_secs(300); // 5 minutes

pub struct SchemaCache {
    tables: DashMap<(Uuid, String, Option<String>), (Vec<TableInfo>, Instant)>, // (conn_id, db, schema) -> tables
    structures: DashMap<(Uuid, TableRef), (TableStructure, Instant)>,
    ttl: Duration,
}

impl SchemaCache {
    pub fn new() -> Self {
        Self {
            tables: DashMap::new(),
            structures: DashMap::new(),
            ttl: DEFAULT_TTL,
        }
    }

    pub fn get_tables(&self, conn_id: &Uuid, db: &str, schema: Option<&str>) -> Option<Vec<TableInfo>> {
        let key = (*conn_id, db.to_string(), schema.map(|s| s.to_string()));
        self.tables.get(&key).and_then(|entry| {
            if entry.1.elapsed() < self.ttl { Some(entry.0.clone()) } else { None }
        })
    }

    pub fn set_tables(&self, conn_id: Uuid, db: String, schema: Option<String>, tables: Vec<TableInfo>) {
        self.tables.insert((conn_id, db, schema), (tables, Instant::now()));
    }

    pub fn invalidate_connection(&self, conn_id: &Uuid) {
        self.tables.retain(|k, _| &k.0 != conn_id);
        self.structures.retain(|k, _| &k.0 != conn_id);
    }
}
```

---

## 7. TAURI COMMANDS — IPC Layer

### 7.1 App State — `state.rs`

```rust
use std::sync::Arc;
use dataforge_engine::{
    connection_manager::ConnectionManager,
    driver_registry::DriverRegistry,
    event_bus::EventBus,
    schema_cache::SchemaCache,
    command_history::CommandHistory,
};
use dataforge_config::store::ConfigStore;
use tokio::sync::Mutex;

pub struct AppState {
    pub connection_manager: Arc<ConnectionManager>,
    pub config_store: Arc<ConfigStore>,
    pub schema_cache: Arc<SchemaCache>,
    pub event_bus: Arc<EventBus>,
    pub command_histories: Arc<DashMap<Uuid, Mutex<CommandHistory>>>,
}
```

### 7.2 Tauri Commands — `commands/connection.rs`

```rust
use tauri::State;
use uuid::Uuid;
use crate::state::AppState;

/// Connecte à une base de données. Retourne le connection_id de la session.
#[tauri::command]
pub async fn connect(
    state: State<'_, AppState>,
    config: ConnectionConfig,
    password: Option<String>,
) -> Result<Uuid, String> {
    // 1. Sauvegarder la config (sans le password)
    state.config_store.save_connection(&config).await.map_err(|e| e.to_string())?;

    // 2. Stocker le password dans le keyring OS si fourni
    if let Some(ref pw) = password {
        state.config_store.store_password(&config.id, pw).map_err(|e| e.to_string())?;
    }

    // 3. Ouvrir la connexion
    let connection_id = state.connection_manager
        .connect(&config, password.as_deref())
        .await
        .map_err(|e| e.to_string())?;

    // 4. Émettre l'événement
    state.event_bus.emit(AppEvent::ConnectionEstablished { connection_id });

    Ok(connection_id)
}

#[tauri::command]
pub async fn disconnect(
    state: State<'_, AppState>,
    connection_id: Uuid,
) -> Result<(), String> {
    state.connection_manager.disconnect(&connection_id).await.map_err(|e| e.to_string())?;
    state.schema_cache.invalidate_connection(&connection_id);
    state.event_bus.emit(AppEvent::ConnectionClosed { connection_id });
    Ok(())
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    config: ConnectionConfig,
    password: Option<String>,
) -> Result<String, String> {
    // Crée une connexion temporaire, ping, retourne la version, puis ferme.
    let factory = state.connection_manager.driver_registry
        .get_factory(&config.db_type)
        .ok_or("Driver not found")?;
    let conn = factory.create_connection(&config, password.as_deref()).await.map_err(|e| e.to_string())?;
    conn.ping().await.map_err(|e| e.to_string())?;
    let version = conn.server_version().await.map_err(|e| e.to_string())?;
    conn.close().await.ok();
    Ok(version)
}

#[tauri::command]
pub async fn list_saved_connections(
    state: State<'_, AppState>,
) -> Result<Vec<SavedConnection>, String> {
    state.config_store.list_connections().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_saved_connection(
    state: State<'_, AppState>,
    id: Uuid,
) -> Result<(), String> {
    state.config_store.delete_connection(&id).await.map_err(|e| e.to_string())
}
```

### 7.3 Tauri Commands — `commands/query.rs`

```rust
#[tauri::command]
pub async fn execute_query(
    state: State<'_, AppState>,
    connection_id: Uuid,
    sql: String,
) -> Result<QueryResult, String> {
    let query_id = Uuid::new_v4();

    // Émettre QueryStarted
    state.event_bus.emit(AppEvent::QueryStarted {
        query_id,
        sql: sql.clone(),
    });

    let start = std::time::Instant::now();

    let active = state.connection_manager
        .get(&connection_id)
        .ok_or("Connection not found")?;

    match active.connection.execute(&sql).await {
        Ok(mut result) => {
            result.query_id = query_id;
            result.execution_time_ms = start.elapsed().as_millis() as u64;

            // Sauvegarder dans l'historique
            let history_entry = QueryHistoryEntry {
                id: query_id,
                connection_id,
                sql,
                executed_at: chrono::Utc::now(),
                duration_ms: result.execution_time_ms,
                row_count: Some(result.rows.len() as u64),
                status: QueryStatus::Success,
                error_message: None,
            };
            let _ = state.config_store.add_to_history(&history_entry).await;

            state.event_bus.emit(AppEvent::QueryCompleted {
                query_id,
                row_count: result.rows.len() as u64,
                elapsed_ms: result.execution_time_ms,
            });

            Ok(result)
        }
        Err(e) => {
            state.event_bus.emit(AppEvent::QueryError {
                query_id,
                error: e.to_string(),
            });
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn cancel_query(
    state: State<'_, AppState>,
    connection_id: Uuid,
    query_id: Uuid,
) -> Result<(), String> {
    let active = state.connection_manager
        .get(&connection_id)
        .ok_or("Connection not found")?;
    active.connection.cancel_query(&query_id).await.map_err(|e| e.to_string())?;
    state.event_bus.emit(AppEvent::QueryCancelled { query_id });
    Ok(())
}

#[tauri::command]
pub async fn get_query_history(
    state: State<'_, AppState>,
    connection_id: Uuid,
    limit: Option<u32>,
) -> Result<Vec<QueryHistoryEntry>, String> {
    state.config_store
        .get_history(&connection_id, limit.unwrap_or(100))
        .await
        .map_err(|e| e.to_string())
}
```

### 7.4 Tauri Commands — `commands/schema.rs`

```rust
#[tauri::command]
pub async fn list_databases(
    state: State<'_, AppState>,
    connection_id: Uuid,
) -> Result<Vec<DatabaseInfo>, String> {
    let active = state.connection_manager.get(&connection_id).ok_or("Not connected")?;
    active.schema_inspector.list_databases().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_schemas(
    state: State<'_, AppState>,
    connection_id: Uuid,
    database: String,
) -> Result<Vec<SchemaInfo>, String> {
    let active = state.connection_manager.get(&connection_id).ok_or("Not connected")?;
    active.schema_inspector.list_schemas(&database).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_tables(
    state: State<'_, AppState>,
    connection_id: Uuid,
    database: String,
    schema: Option<String>,
) -> Result<Vec<TableInfo>, String> {
    // Check cache first
    if let Some(cached) = state.schema_cache.get_tables(&connection_id, &database, schema.as_deref()) {
        return Ok(cached);
    }

    let active = state.connection_manager.get(&connection_id).ok_or("Not connected")?;
    let tables = active.schema_inspector
        .list_tables(&database, schema.as_deref())
        .await
        .map_err(|e| e.to_string())?;

    state.schema_cache.set_tables(connection_id, database, schema, tables.clone());

    Ok(tables)
}

#[tauri::command]
pub async fn get_table_structure(
    state: State<'_, AppState>,
    connection_id: Uuid,
    table_ref: TableRef,
) -> Result<TableStructure, String> {
    let active = state.connection_manager.get(&connection_id).ok_or("Not connected")?;
    active.schema_inspector
        .get_table_structure(&table_ref)
        .await
        .map_err(|e| e.to_string())
}
```

### 7.5 Enregistrement dans `lib.rs`

```rust
use tauri::Manager;

mod commands;
mod state;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Initialiser le state
            let config_store = Arc::new(ConfigStore::new(app.path().app_data_dir()?)?);
            let driver_registry = Arc::new(DriverRegistry::new());
            let event_bus = Arc::new(EventBus::new(app.handle().clone()));
            let connection_manager = Arc::new(ConnectionManager::new(driver_registry));
            let schema_cache = Arc::new(SchemaCache::new());

            app.manage(AppState {
                connection_manager,
                config_store,
                schema_cache,
                event_bus,
                command_histories: Arc::new(DashMap::new()),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Connection
            commands::connection::connect,
            commands::connection::disconnect,
            commands::connection::test_connection,
            commands::connection::list_saved_connections,
            commands::connection::delete_saved_connection,
            // Query
            commands::query::execute_query,
            commands::query::cancel_query,
            commands::query::get_query_history,
            // Schema
            commands::schema::list_databases,
            commands::schema::list_schemas,
            commands::schema::list_tables,
            commands::schema::get_table_structure,
            // Data
            commands::data::update_rows,
            commands::data::insert_rows,
            commands::data::delete_rows,
            // Export
            commands::export::export_csv,
            commands::export::export_json,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

## 8. FRONTEND REACT

### 8.1 Types TypeScript — `lib/types.ts`

Ces types DOIVENT correspondre exactement aux structs Rust sérialisés par serde.

```typescript
// === CONNECTION ===

export type DatabaseType = 'mysql' | 'sqlite' | 'postgres' | 'mongodb';

export type SslMode = 'disable' | 'prefer' | 'require' | 'verify_ca' | 'verify_full';

export interface SshTunnelConfig {
  host: string;
  port: number;
  username: string;
  auth_method: SshAuthMethod;
}

export type SshAuthMethod =
  | { type: 'Password' }
  | { type: 'PrivateKey'; key_path: string }
  | { type: 'Agent' };

export interface ConnectionConfig {
  id: string;
  name: string;
  db_type: DatabaseType;
  host: string;
  port: number;
  username: string;
  database: string | null;
  ssl_mode: SslMode;
  ssh_tunnel: SshTunnelConfig | null;
  color: string | null;
  pool_size: number | null;
  query_timeout_ms: number | null;
}

export interface SavedConnection {
  config: ConnectionConfig;
  created_at: string;
  last_used_at: string | null;
  sort_order: number;
}

// === QUERY ===

export type ResultType = 'Select' | 'Insert' | 'Update' | 'Delete' | 'DDL' | 'Other';

export interface QueryResult {
  query_id: string;
  columns: ColumnMeta[];
  rows: Row[];
  total_rows: number | null;
  affected_rows: number | null;
  execution_time_ms: number;
  warnings: string[];
  result_type: ResultType;
}

export interface ColumnMeta {
  name: string;
  data_type: DataType;
  native_type: string;
  nullable: boolean;
  is_primary_key: boolean;
  max_length: number | null;
}

export interface Row {
  cells: CellValue[];
}

export type CellValue =
  | { type: 'Null' }
  | { type: 'Integer'; value: number }
  | { type: 'Float'; value: number }
  | { type: 'Boolean'; value: boolean }
  | { type: 'Text'; value: string }
  | { type: 'Json'; value: unknown }
  | { type: 'DateTime'; value: string }
  | { type: 'Date'; value: string }
  | { type: 'Time'; value: string }
  | { type: 'Uuid'; value: string }
  | { type: 'Bytes'; value: { size: number; preview: string } }
  | { type: 'Array'; value: CellValue[] };

// === SCHEMA ===

export interface TableRef {
  database: string | null;
  schema: string | null;
  table: string;
}

export interface DatabaseInfo {
  name: string;
  size_bytes: number | null;
  encoding: string | null;
}

export interface SchemaInfo {
  name: string;
  owner: string | null;
}

export interface TableInfo {
  name: string;
  table_type: 'Table' | 'View' | 'MaterializedView' | 'ForeignTable';
  row_count_estimate: number | null;
  size_bytes: number | null;
  comment: string | null;
}

export interface TableStructure {
  table_ref: TableRef;
  columns: ColumnInfo[];
  primary_key: PrimaryKeyInfo | null;
  indexes: IndexInfo[];
  foreign_keys: ForeignKeyInfo[];
  constraints: ConstraintInfo[];
  comment: string | null;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  mapped_type: DataType;
  nullable: boolean;
  default_value: string | null;
  is_primary_key: boolean;
  ordinal_position: number;
  comment: string | null;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  is_unique: boolean;
  is_primary: boolean;
  index_type: string;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  referenced_table: TableRef;
  referenced_columns: string[];
  on_update: string;
  on_delete: string;
}

// === EVENTS ===

export type AppEvent =
  | { event_type: 'ConnectionEstablished'; payload: { connection_id: string } }
  | { event_type: 'ConnectionClosed'; payload: { connection_id: string } }
  | { event_type: 'ConnectionError'; payload: { connection_id: string; error: string } }
  | { event_type: 'QueryStarted'; payload: { query_id: string; sql: string } }
  | { event_type: 'QueryProgress'; payload: { query_id: string; rows_fetched: number; elapsed_ms: number } }
  | { event_type: 'QueryCompleted'; payload: { query_id: string; row_count: number; elapsed_ms: number } }
  | { event_type: 'QueryError'; payload: { query_id: string; error: string } }
  | { event_type: 'QueryCancelled'; payload: { query_id: string } };
```

### 8.2 IPC Typed Wrappers — `lib/ipc.ts`

```typescript
import { invoke } from '@tauri-apps/api/core';
import type {
  ConnectionConfig, SavedConnection, QueryResult,
  DatabaseInfo, SchemaInfo, TableInfo, TableStructure, TableRef,
  QueryHistoryEntry,
} from './types';

// === CONNECTION ===

export const ipc = {
  connect: (config: ConnectionConfig, password?: string) =>
    invoke<string>('connect', { config, password }),

  disconnect: (connectionId: string) =>
    invoke<void>('disconnect', { connectionId }),

  testConnection: (config: ConnectionConfig, password?: string) =>
    invoke<string>('test_connection', { config, password }),

  listSavedConnections: () =>
    invoke<SavedConnection[]>('list_saved_connections'),

  deleteSavedConnection: (id: string) =>
    invoke<void>('delete_saved_connection', { id }),

  // === QUERY ===

  executeQuery: (connectionId: string, sql: string) =>
    invoke<QueryResult>('execute_query', { connectionId, sql }),

  cancelQuery: (connectionId: string, queryId: string) =>
    invoke<void>('cancel_query', { connectionId, queryId }),

  getQueryHistory: (connectionId: string, limit?: number) =>
    invoke<QueryHistoryEntry[]>('get_query_history', { connectionId, limit }),

  // === SCHEMA ===

  listDatabases: (connectionId: string) =>
    invoke<DatabaseInfo[]>('list_databases', { connectionId }),

  listSchemas: (connectionId: string, database: string) =>
    invoke<SchemaInfo[]>('list_schemas', { connectionId, database }),

  listTables: (connectionId: string, database: string, schema?: string) =>
    invoke<TableInfo[]>('list_tables', { connectionId, database, schema }),

  getTableStructure: (connectionId: string, tableRef: TableRef) =>
    invoke<TableStructure>('get_table_structure', { connectionId, tableRef }),

  // === DATA ===

  updateRows: (connectionId: string, tableRef: TableRef, changes: RowChange[]) =>
    invoke<void>('update_rows', { connectionId, tableRef, changes }),

  // === EXPORT ===

  exportCsv: (connectionId: string, sql: string, filePath: string) =>
    invoke<void>('export_csv', { connectionId, sql, filePath }),

  exportJson: (connectionId: string, sql: string, filePath: string) =>
    invoke<void>('export_json', { connectionId, sql, filePath }),
};
```

### 8.3 Zustand Stores

#### `stores/connectionStore.ts`

```typescript
import { create } from 'zustand';
import { ipc } from '../lib/ipc';
import type { SavedConnection, ConnectionConfig } from '../lib/types';

interface ConnectionState {
  // State
  savedConnections: SavedConnection[];
  activeConnectionId: string | null; // session connection_id (from connect())
  activeConfig: ConnectionConfig | null;
  connecting: boolean;
  error: string | null;

  // Actions
  loadSavedConnections: () => Promise<void>;
  connect: (config: ConnectionConfig, password?: string) => Promise<string>;
  disconnect: () => Promise<void>;
  testConnection: (config: ConnectionConfig, password?: string) => Promise<string>;
  deleteConnection: (id: string) => Promise<void>;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  savedConnections: [],
  activeConnectionId: null,
  activeConfig: null,
  connecting: false,
  error: null,

  loadSavedConnections: async () => {
    const connections = await ipc.listSavedConnections();
    set({ savedConnections: connections });
  },

  connect: async (config, password) => {
    set({ connecting: true, error: null });
    try {
      const connectionId = await ipc.connect(config, password);
      set({
        activeConnectionId: connectionId,
        activeConfig: config,
        connecting: false,
      });
      return connectionId;
    } catch (e) {
      set({ connecting: false, error: String(e) });
      throw e;
    }
  },

  disconnect: async () => {
    const { activeConnectionId } = get();
    if (activeConnectionId) {
      await ipc.disconnect(activeConnectionId);
      set({ activeConnectionId: null, activeConfig: null });
    }
  },

  testConnection: async (config, password) => {
    return ipc.testConnection(config, password);
  },

  deleteConnection: async (id) => {
    await ipc.deleteSavedConnection(id);
    await get().loadSavedConnections();
  },
}));
```

#### `stores/queryStore.ts`

```typescript
import { create } from 'zustand';
import { ipc } from '../lib/ipc';
import type { QueryResult, QueryHistoryEntry } from '../lib/types';

export interface QueryTab {
  id: string;
  title: string;
  sql: string;
  result: QueryResult | null;
  isExecuting: boolean;
  error: string | null;
}

interface QueryState {
  tabs: QueryTab[];
  activeTabId: string | null;
  history: QueryHistoryEntry[];

  // Actions
  createTab: (title?: string) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateSql: (tabId: string, sql: string) => void;
  executeQuery: (connectionId: string, tabId: string) => Promise<void>;
  cancelQuery: (connectionId: string, queryId: string) => Promise<void>;
  loadHistory: (connectionId: string) => Promise<void>;
}

export const useQueryStore = create<QueryState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  history: [],

  createTab: (title) => {
    const id = crypto.randomUUID();
    const tab: QueryTab = {
      id,
      title: title ?? `Query ${get().tabs.length + 1}`,
      sql: '',
      result: null,
      isExecuting: false,
      error: null,
    };
    set(s => ({ tabs: [...s.tabs, tab], activeTabId: id }));
    return id;
  },

  closeTab: (id) => {
    set(s => {
      const tabs = s.tabs.filter(t => t.id !== id);
      const activeTabId = s.activeTabId === id
        ? (tabs.length > 0 ? tabs[tabs.length - 1].id : null)
        : s.activeTabId;
      return { tabs, activeTabId };
    });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  updateSql: (tabId, sql) => {
    set(s => ({
      tabs: s.tabs.map(t => t.id === tabId ? { ...t, sql } : t),
    }));
  },

  executeQuery: async (connectionId, tabId) => {
    const tab = get().tabs.find(t => t.id === tabId);
    if (!tab || !tab.sql.trim()) return;

    set(s => ({
      tabs: s.tabs.map(t =>
        t.id === tabId ? { ...t, isExecuting: true, error: null, result: null } : t
      ),
    }));

    try {
      const result = await ipc.executeQuery(connectionId, tab.sql);
      set(s => ({
        tabs: s.tabs.map(t =>
          t.id === tabId ? { ...t, isExecuting: false, result } : t
        ),
      }));
    } catch (e) {
      set(s => ({
        tabs: s.tabs.map(t =>
          t.id === tabId ? { ...t, isExecuting: false, error: String(e) } : t
        ),
      }));
    }
  },

  cancelQuery: async (connectionId, queryId) => {
    await ipc.cancelQuery(connectionId, queryId);
  },

  loadHistory: async (connectionId) => {
    const history = await ipc.getQueryHistory(connectionId);
    set({ history });
  },
}));
```

### 8.4 Hooks critiques

#### `hooks/useTauriEvent.ts`

```typescript
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { AppEvent } from '../lib/types';

export function useTauriEvent(
  callback: (event: AppEvent) => void,
  deps: React.DependencyList = []
) {
  useEffect(() => {
    const unlisten = listen<AppEvent>('app-event', (event) => {
      callback(event.payload);
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, deps);
}
```

#### `hooks/useKeyboardShortcut.ts`

```typescript
import { useEffect } from 'react';

type Modifier = 'meta' | 'ctrl' | 'shift' | 'alt';

interface Shortcut {
  key: string;
  modifiers: Modifier[];
  handler: () => void;
  when?: () => boolean; // Condition pour activer le shortcut
}

export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        const modMatch =
          shortcut.modifiers.every(mod => {
            if (mod === 'meta') return e.metaKey;
            if (mod === 'ctrl') return e.ctrlKey;
            if (mod === 'shift') return e.shiftKey;
            if (mod === 'alt') return e.altKey;
            return false;
          });

        if (modMatch && e.key.toLowerCase() === shortcut.key.toLowerCase()) {
          if (!shortcut.when || shortcut.when()) {
            e.preventDefault();
            shortcut.handler();
            return;
          }
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts]);
}
```

### 8.5 Design System — `styles/globals.css`

```css
@import "tailwindcss";

/* Theme tokens en CSS variables — le theme switcher change la classe sur <html> */
:root {
  /* Couleurs neutres */
  --color-bg-primary: #ffffff;
  --color-bg-secondary: #f8f9fa;
  --color-bg-tertiary: #f1f3f5;
  --color-bg-hover: #e9ecef;
  --color-bg-active: #dee2e6;
  --color-bg-sidebar: #f8f9fa;

  /* Texte */
  --color-text-primary: #212529;
  --color-text-secondary: #495057;
  --color-text-tertiary: #868e96;
  --color-text-disabled: #adb5bd;

  /* Bordures */
  --color-border: #dee2e6;
  --color-border-strong: #ced4da;

  /* Accents */
  --color-accent: #228be6;
  --color-accent-hover: #1c7ed6;
  --color-accent-subtle: #e7f5ff;

  /* Sémantique */
  --color-success: #40c057;
  --color-warning: #fab005;
  --color-error: #fa5252;
  --color-info: #228be6;

  /* Grid */
  --color-grid-row-alt: #f8f9fa;
  --color-grid-row-hover: #e7f5ff;
  --color-grid-cell-edited: #fff9db;
  --color-grid-cell-null: #f1f3f5;

  /* Spacing */
  --sidebar-width: 260px;
  --statusbar-height: 28px;
  --toolbar-height: 40px;
  --tab-height: 36px;

  /* Typography */
  --font-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  --font-sans: 'Inter', -apple-system, system-ui, sans-serif;
}

/* Dark theme */
html.dark {
  --color-bg-primary: #1a1b1e;
  --color-bg-secondary: #25262b;
  --color-bg-tertiary: #2c2e33;
  --color-bg-hover: #373a40;
  --color-bg-active: #495057;
  --color-bg-sidebar: #25262b;

  --color-text-primary: #f1f3f5;
  --color-text-secondary: #c1c2c5;
  --color-text-tertiary: #909296;
  --color-text-disabled: #5c5f66;

  --color-border: #373a40;
  --color-border-strong: #495057;

  --color-accent: #4dabf7;
  --color-accent-hover: #74c0fc;
  --color-accent-subtle: #1c3a5e;

  --color-grid-row-alt: #25262b;
  --color-grid-row-hover: #1c3a5e;
  --color-grid-cell-edited: #3d3400;
  --color-grid-cell-null: #2c2e33;
}

/* Base */
body {
  font-family: var(--font-sans);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  overflow: hidden; /* Pas de scroll sur le body — chaque panel gère son propre scroll */
  -webkit-font-smoothing: antialiased;
}

/* Scrollbar custom (mince, discrète) */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--color-border-strong); }

/* Sélection */
::selection { background: var(--color-accent-subtle); }

/* Empêcher le drag natif sur les éléments interactifs */
button, input, select, textarea { user-select: none; }
```

### 8.6 shadcn/ui Configuration

#### `components.json`

Ce fichier est généré par `npx shadcn@latest init` et doit être configuré ainsi :

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/styles/globals.css",
    "baseColor": "zinc",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

**Notes importantes :**
- Style `new-york` : plus compact et moderne que `default`, adapté à un outil technique dense
- `rsc: false` : Tauri n'utilise pas React Server Components
- `baseColor: zinc` : palette neutre qui s'intègre bien avec le thème dark pour un outil de DB
- Les CSS variables sont activées pour permettre le theming dark/light via les variables définies dans `globals.css`

#### `lib/utils.ts` (requis par shadcn/ui)

```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

#### Composants shadcn/ui à installer (dans l'ordre)

```bash
# Core UI
npx shadcn@latest add button input label select textarea

# Overlays & navigation
npx shadcn@latest add dialog sheet popover dropdown-menu context-menu tooltip

# Layout & feedback
npx shadcn@latest add tabs separator scroll-area badge skeleton alert

# Data display
npx shadcn@latest add table command

# Notifications (choisir UN des deux) :
npx shadcn@latest add sonner    # Recommandé — plus léger, stack notifications
# OU
npx shadcn@latest add toast     # Alternative Radix-based
```

#### Convention de nommage

shadcn/ui génère les fichiers en **kebab-case** dans `components/ui/`. NE PAS renommer en PascalCase :

```tsx
// ✅ CORRECT — imports shadcn/ui tels que générés
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { Command, CommandInput, CommandList, CommandItem } from "@/components/ui/command";

// ❌ INCORRECT — ne pas renommer les fichiers
import { Button } from "@/components/ui/Button";
```

#### Personnalisation du thème shadcn

Les CSS variables de shadcn/ui dans `globals.css` doivent être synchronisées avec notre design system. Après `shadcn init`, **remplacer** les variables générées par celles de la section 8.5, en ajoutant les variables requises par shadcn :

```css
@layer base {
  :root {
    /* shadcn required variables — mapped to our design system */
    --background: 0 0% 100%;           /* --color-bg-primary */
    --foreground: 210 11% 15%;         /* --color-text-primary */
    --card: 210 17% 98%;               /* --color-bg-secondary */
    --card-foreground: 210 11% 15%;
    --popover: 0 0% 100%;
    --popover-foreground: 210 11% 15%;
    --primary: 210 100% 52%;           /* --color-accent */
    --primary-foreground: 0 0% 100%;
    --secondary: 210 17% 95%;          /* --color-bg-tertiary */
    --secondary-foreground: 210 11% 15%;
    --muted: 210 17% 95%;
    --muted-foreground: 210 8% 55%;    /* --color-text-tertiary */
    --accent: 210 17% 93%;
    --accent-foreground: 210 11% 15%;
    --destructive: 0 84% 60%;          /* --color-error */
    --destructive-foreground: 0 0% 100%;
    --border: 210 14% 89%;             /* --color-border */
    --input: 210 14% 89%;
    --ring: 210 100% 52%;              /* --color-accent */
    --radius: 0.5rem;
  }

  .dark {
    --background: 220 13% 10%;         /* --color-bg-primary dark */
    --foreground: 210 17% 95%;         /* --color-text-primary dark */
    --card: 220 13% 14%;
    --card-foreground: 210 17% 95%;
    --popover: 220 13% 14%;
    --popover-foreground: 210 17% 95%;
    --primary: 210 100% 66%;           /* --color-accent dark */
    --primary-foreground: 220 13% 10%;
    --secondary: 220 13% 17%;
    --secondary-foreground: 210 17% 95%;
    --muted: 220 13% 17%;
    --muted-foreground: 220 8% 57%;
    --accent: 220 13% 17%;
    --accent-foreground: 210 17% 95%;
    --destructive: 0 84% 60%;
    --destructive-foreground: 0 0% 100%;
    --border: 220 13% 22%;
    --input: 220 13% 22%;
    --ring: 210 100% 66%;
    --radius: 0.5rem;
  }
}
```

### 8.7 Raccourcis clavier à implémenter

| Raccourci | Action | Contexte |
|-----------|--------|----------|
| `Cmd/Ctrl + Enter` | Exécuter la requête courante | Éditeur SQL |
| `Cmd/Ctrl + Shift + Enter` | Exécuter la sélection uniquement | Éditeur SQL |
| `Cmd/Ctrl + E` | EXPLAIN de la requête | Éditeur SQL |
| `Shift + Alt + F` | Formater le SQL | Éditeur SQL |
| `Cmd/Ctrl + S` | Sauvegarder la requête / Appliquer les changements | Global |
| `Cmd/Ctrl + N` | Nouvel onglet de requête | Global |
| `Cmd/Ctrl + W` | Fermer l'onglet actif | Global |
| `Cmd/Ctrl + Tab` | Onglet suivant | Global |
| `Cmd/Ctrl + Shift + Tab` | Onglet précédent | Global |
| `Cmd/Ctrl + K` | Command Palette | Global |
| `Cmd/Ctrl + Z` | Undo (data changes) | Data Grid |
| `Cmd/Ctrl + Shift + Z` | Redo (data changes) | Data Grid |
| `Cmd/Ctrl + R` | Rafraîchir les données / schéma | Global |
| `Cmd/Ctrl + D` | Dupliquer la ligne | Data Grid |
| `Escape` | Annuler l'édition inline | Data Grid |
| `F2` | Éditer la cellule sélectionnée | Data Grid |
| `Delete` | Supprimer les lignes sélectionnées | Data Grid |
| `Cmd/Ctrl + ,` | Ouvrir les Settings | Global |

---

## 9. FLUX DE DONNÉES

### 9.1 Connexion

```
[UI] ConnectionForm.onSubmit(config, password)
  → [IPC] ipc.connect(config, password)
    → [Rust] commands::connection::connect()
      → ConfigStore.save_connection(config)
      → ConfigStore.store_password(config.id, password)  // keyring OS
      → ConnectionManager.connect(config, password)
        → DriverRegistry.get_factory(config.db_type)
        → factory.create_connection(config, password)
        → connection.ping()
        → DashMap.insert(connection_id, ActiveConnection)
      → EventBus.emit(ConnectionEstablished)
    → return connection_id
  → [UI] connectionStore.set({ activeConnectionId, activeConfig })
  → [UI] SchemaTree triggers load
```

### 9.2 Exécution de requête

```
[UI] User presses Cmd+Enter
  → queryStore.executeQuery(connectionId, tabId)
  → [IPC] ipc.executeQuery(connectionId, sql)
    → [Rust] commands::query::execute_query()
      → EventBus.emit(QueryStarted { query_id, sql })
      → active.connection.execute(sql)
      → ConfigStore.add_to_history(entry)
      → EventBus.emit(QueryCompleted { query_id, row_count, elapsed_ms })
    → return QueryResult
  → [UI] queryStore.tabs[tabId].result = QueryResult
  → [UI] DataGrid re-renders with new data
```

### 9.3 Navigation dans le schema tree

```
[UI] User clicks on "public" schema
  → schemaStore.loadTables(connectionId, "mydb", "public")
  → [IPC] ipc.listTables(connectionId, "mydb", "public")
    → [Rust] Check SchemaCache → miss
    → active.schema_inspector.list_tables("mydb", "public")
    → SchemaCache.set_tables(...)
    → return Vec<TableInfo>
  → [UI] schemaStore.tables["public"] = tables
  → [UI] SchemaTree re-renders children nodes
```

---

## 10. SÉCURITÉ

### 10.1 Règles absolues

1. **Les mots de passe ne sont JAMAIS stockés dans un fichier** — uniquement dans le keyring OS via le crate `keyring`.
2. **Le fichier de config SQLite interne ne contient pas de credentials** — uniquement host, port, username, db_type, etc.
3. **Pas de `eval()`** côté frontend. Le SQL est toujours envoyé au backend Rust qui l'exécute.
4. **CSP stricte** dans `tauri.conf.json` : `default-src 'self'; style-src 'self' 'unsafe-inline'`.
5. **Pas de requête réseau depuis le frontend** — tout passe par les Tauri commands.
6. Les clés SSH privées sont lues par le backend Rust, jamais exposées au frontend.

### 10.2 SSH Tunnel

Le tunnel SSH est géré dans `dataforge-engine/src/ssh_tunnel.rs` via le crate `russh`. Le tunnel doit :
- Ouvrir un port local aléatoire pour le forwarding
- Supporter l'authentification par password, clé privée, ou ssh-agent
- Avoir un keep-alive configurable (default 60s)
- Se reconnecter automatiquement en cas de déconnexion
- Fermer proprement à la déconnexion

---

## 11. PERFORMANCE

### 11.1 Objectifs chiffrés

| Métrique | Cible |
|----------|-------|
| Cold start | < 800ms |
| Connexion DB locale | < 200ms |
| SELECT 100 rows affiché | < 50ms |
| Scroll grid 100K rows | 60 FPS |
| Mémoire au repos | < 80 Mo |
| Taille binaire (macOS) | < 20 Mo |

### 11.2 Techniques obligatoires

1. **Virtualisation du Data Grid** : Utiliser `@tanstack/react-virtual`. Seules les lignes visibles + 20 lignes d'overscan sont dans le DOM.
2. **Pagination serveur** : Les SELECT sont toujours LIMIT/OFFSET. Default: 500 rows par page.
3. **Lazy loading du schéma** : L'arbre ne charge les enfants qu'à l'expansion du noeud parent.
4. **Monaco Editor lazy** : Le bundle Monaco est chargé en `React.lazy()` avec Suspense.
5. **Schema Cache** : TTL de 5 minutes sur les metadata, invalidation manuelle via Cmd+R.
6. **Serde JSON streaming** : Pour les résultats > 10K rows, utiliser le streaming IPC de Tauri si disponible, sinon paginer.

---

## 12. TESTS

### 12.1 Stratégie

| Couche | Framework | Coverage cible | Ce qu'on teste |
|--------|-----------|----------------|----------------|
| Rust Core (models, types) | `cargo test` | 90% | Sérialisation, mapping types, validation |
| Rust Drivers | `cargo test` + testcontainers | 80% | Requêtes réelles contre MySQL/PostgreSQL en conteneur Docker |
| Rust Engine | `cargo test` | 85% | ConnectionManager, SchemaCache, CommandHistory |
| Tauri Commands | integration tests | 70% | IPC round-trip, erreur handling |
| React Stores | Vitest | 80% | Actions, state transitions |
| React Components | Vitest + Testing Library | 60% | Rendering, interactions |
| E2E | Playwright | Critical paths | Connect → Query → See results → Edit → Apply |

### 12.2 Tests d'intégration Rust avec testcontainers

```rust
#[cfg(test)]
mod tests {
    use testcontainers::{clients, images::mysql};

    #[tokio::test]
    async fn test_mysql_connection() {
        let docker = clients::Cli::default();
        let container = docker.run(mysql::Mysql::default());
        let port = container.get_host_port_ipv4(3306);

        let config = ConnectionConfig {
            db_type: DatabaseType::Mysql,
            host: "localhost".to_string(),
            port,
            username: "root".to_string(),
            database: Some("mysql".to_string()),
            ..Default::default()
        };

        let factory = MySqlDriverFactory;
        let conn = factory.create_connection(&config, Some("root")).await.unwrap();
        conn.ping().await.unwrap();

        let result = conn.execute("SELECT 1 AS num").await.unwrap();
        assert_eq!(result.rows.len(), 1);
    }
}
```

---

## 13. CI/CD

### 13.1 GitHub Actions — `ci.yml`

```yaml
name: CI

on: [push, pull_request]

jobs:
  rust-checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo fmt --all -- --check
      - run: cargo clippy --workspace -- -D warnings
      - run: cargo test --workspace

  frontend-checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: pnpm install --frozen-lockfile
        working-directory: apps/desktop
      - run: pnpm tsc --noEmit
        working-directory: apps/desktop
      - run: pnpm eslint src/
        working-directory: apps/desktop
      - run: pnpm vitest run
        working-directory: apps/desktop

  build:
    needs: [rust-checks, frontend-checks]
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: pnpm install --frozen-lockfile
        working-directory: apps/desktop
      - run: pnpm tauri build
        working-directory: apps/desktop
```

---

## 14. ROADMAP D'EXÉCUTION

Exécute ces phases **dans l'ordre strict**. Ne passe pas à la phase suivante tant que la précédente ne compile pas et que les tests ne passent pas.

### Phase 0 — Scaffolding (FAIRE EN PREMIER)

1. Créer la structure de fichiers complète du monorepo (section 3)
2. Configurer `Cargo.toml` workspace + tous les `Cargo.toml` des crates
3. Initialiser le projet Tauri 2 dans `apps/desktop/`
4. Configurer React + Vite + TailwindCSS + TypeScript
5. Configurer le path alias `@/` dans `tsconfig.json` et `vite.config.ts` :
   ```json
   // tsconfig.json
   { "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } } }
   ```
   ```typescript
   // vite.config.ts
   resolve: { alias: { "@": path.resolve(__dirname, "./src") } }
   ```
6. Initialiser shadcn/ui : `npx shadcn@latest init` (style: new-york, baseColor: zinc, cssVariables: yes)
7. Installer les composants shadcn/ui de base (section 8.6)
8. Créer `globals.css` avec le design system + variables shadcn (sections 8.5 & 8.6)
9. Écrire les stubs vides (fonctions qui retournent `todo!()`) pour que tout compile
10. Vérifier que `pnpm tauri dev` lance l'application (fenêtre vide OK)

**Validation** : `cargo build --workspace` passe. `pnpm tauri dev` ouvre une fenêtre.

### Phase 1 — Domain Core

1. Implémenter tous les types dans `dataforge-core` (error.rs, models/*, ports/*)
2. Écrire les tests unitaires de sérialisation (chaque struct doit round-trip en JSON)
3. Implémenter `dataforge-config` : SQLite interne, migrations, repositories

**Validation** : `cargo test -p dataforge-core` et `cargo test -p dataforge-config` passent.

### Phase 2 — MySQL/MariaDB Driver

1. Implémenter `MySqlConnection` (execute, ping, server_version, close) avec `mysql_async`
2. Implémenter `MySqlSchemaInspector` (toutes les requêtes SQL de la section 5.2)
3. Implémenter `MySqlDialect` (backtick quoting, `?` placeholders, `LIMIT offset, count` syntax)
4. Implémenter `MySqlDriverFactory`
5. Écrire les tests d'intégration avec testcontainers

**Validation** : Tests d'intégration MySQL passent.

### Phase 3 — Engine Layer

1. Implémenter `DriverRegistry` (enregistrement des factories)
2. Implémenter `ConnectionManager` (connect, disconnect, get)
3. Implémenter `EventBus` (émission d'événements Tauri)
4. Implémenter `SchemaCache`
5. Implémenter les Tauri Commands (connection, query, schema)
6. Câbler le tout dans `lib.rs` (setup Tauri + state management)

**Validation** : `pnpm tauri dev` démarre. On peut appeler les commands depuis la console JS du devtools.

### Phase 4 — Frontend Core

1. Implémenter `lib/types.ts` et `lib/ipc.ts`
2. Implémenter les Zustand stores (connectionStore, queryStore, schemaStore, uiStore)
3. Implémenter `useTauriEvent` hook
4. Initialiser shadcn/ui (`npx shadcn@latest init`) puis installer les composants nécessaires :
   ```bash
   npx shadcn@latest add button input dialog dropdown-menu context-menu tabs tooltip badge separator scroll-area popover command table sheet skeleton alert toast
   ```
5. Créer `AppLayout` avec sidebar + panels resizables + status bar
6. Créer `ConnectionList` + `ConnectionForm` (formulaire de connexion)
7. Intégrer : pouvoir se connecter à MySQL depuis l'UI

**Validation** : On peut créer une connexion, la sauvegarder, s'y connecter.

### Phase 5 — SQL Editor + Data Grid

1. Intégrer Monaco Editor avec coloration SQL
2. Créer `EditorTabs` (onglets de requêtes)
3. Créer le `DataGrid` virtualisé avec TanStack
4. Implémenter les cell renderers (Text, Number, Boolean, Date, Json, Null)
5. Connecter : écrire une requête → exécuter → voir les résultats dans le grid

**Validation** : Flow complet : connect → write SQL → execute → see results in grid.

### Phase 6 — Schema Tree + Table Detail

1. Implémenter `SchemaTree` (react-arborist) avec lazy loading
2. Implémenter `TableDetail` (structure, columns, indexes, FK)
3. Double-clic sur une table = `SELECT * FROM table LIMIT 500` auto-exécuté

**Validation** : Navigation complète dans le schéma, inspection de tables.

### Phase 7 — Data Editing

1. Inline editing dans le DataGrid (double-clic sur cellule)
2. Pending changes tracking (cellules jaunes)
3. `PendingChanges` bar : Apply / Discard
4. Command Pattern côté Rust pour undo/redo
5. Raccourcis Cmd+Z / Cmd+Shift+Z

**Validation** : Modifier des données, voir le SQL preview, appliquer, undo.

### Phase 8 — Polish, SQLite & PostgreSQL Drivers

1. Implémenter le driver SQLite (même structure que MySQL)
2. Implémenter le driver PostgreSQL (même structure que MySQL, avec `sqlx::PgPool`, `$1/$2` placeholders, double-quote quoting)
3. Command Palette (Cmd+K)
4. Dark/Light theme toggle
5. Query History panel
6. Export CSV/JSON
7. Keyboard shortcuts complets
8. Error boundaries + toast notifications

**Validation** : Application fonctionnelle avec MySQL + SQLite + PostgreSQL.

---

## 15. CONTRAINTES NON NÉGOCIABLES

1. **JAMAIS de `unwrap()` en production** — Utilise `?` ou `.map_err()` partout. Les `unwrap()` sont uniquement autorisés dans les tests.
2. **JAMAIS de `println!()`** — Utilise le crate `tracing` (`tracing::info!`, `tracing::error!`, etc.).
3. **Tous les types publics implémentent `Serialize + Deserialize`** via serde derive.
4. **Tout le code Rust passe `clippy` sans warnings** : `cargo clippy -- -D warnings`.
5. **Tout le code TypeScript passe `tsc --noEmit`** sans erreurs.
6. **Les Tauri commands retournent `Result<T, String>`** — le frontend reçoit toujours soit une valeur, soit un message d'erreur lisible.
7. **Le frontend ne fait JAMAIS de requête réseau directe** — tout passe par les Tauri commands.
8. **Chaque crate a son propre `Cargo.toml`** avec les dépendances minimales nécessaires.
9. **Le Domain Layer (`dataforge-core`) ne dépend d'aucun crate de driver DB** (pas de sqlx, pas de rusqlite, etc.).
10. **Les mots de passe ne sont jamais sérialisés ni loggés**.
11. **Chaque phase doit compiler et les tests doivent passer avant de passer à la suivante**.
12. **Le DataGrid doit être virtualisé dès le jour 1** — pas de refactor ultérieur.
