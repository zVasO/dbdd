<div align="center">

# PurrQL

**A modern, blazing-fast database IDE built with Rust and React.**

Connect, query, explore, and manage your databases — all from one elegant desktop app.

[![Tauri 2.0](https://img.shields.io/badge/Tauri-2.0-blue?logo=tauri&logoColor=white)](https://v2.tauri.app)
[![Rust](https://img.shields.io/badge/Rust-stable-orange?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![React 19](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-Private-red)]()
[![Version](https://img.shields.io/badge/Version-0.1.0-green)]()

<br />

![MySQL](https://img.shields.io/badge/MySQL-✓-4479A1?logo=mysql&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-✓-4169E1?logo=postgresql&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-✓-003B57?logo=sqlite&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-soon-47A248?logo=mongodb&logoColor=white)

</div>

---

## Why PurrQL?

Most database tools are either **bloated Electron apps** that eat your RAM, or **bare-bones CLI tools** that lack discoverability. PurrQL sits in the sweet spot:

- **Native performance** — Rust backend via Tauri, not Electron. Tiny memory footprint.
- **Beautiful UI** — React 19 + Tailwind + Radix. Dark/light themes. Feels like a native app.
- **Multi-database** — MySQL, PostgreSQL, SQLite today. MongoDB coming soon.
- **Secure by design** — OS keyring for credentials, AES-GCM encryption, SSH tunneling, CSP-locked frontend.

---

## Features

### Database Management

| Feature | Description |
|---------|-------------|
| **Multi-connection** | Connect to multiple databases simultaneously with connection pooling |
| **Schema explorer** | Browse databases, tables, views, columns, indexes, foreign keys, and constraints |
| **Inline editing** | Edit rows directly in the data grid with change tracking |
| **SSH tunneling** | Connect securely to remote databases through SSH |
| **SSL/TLS** | Full TLS configuration support for encrypted connections |

### Query Engine

| Feature | Description |
|---------|-------------|
| **SQL editor** | CodeMirror 6 with syntax highlighting, auto-completion, and formatting |
| **Streaming execution** | Stream large result sets with batched rendering — handle millions of rows |
| **Batch queries** | Execute multiple statements in a single run |
| **Query history** | Full history with search, replay, and versioning |
| **SQL snippets** | Save and reuse common query templates |

### Data Tools

| Feature | Description |
|---------|-------------|
| **Import** | CSV bulk import with column mapping |
| **Export** | CSV, SQL, Excel (`.xlsx`), JSON — large exports offloaded to Web Workers |
| **Mock data** | Generate realistic test data with Faker.js integration |
| **Data masking** | Mask sensitive columns for safe sharing |

### Visualization & Analytics

| Feature | Description |
|---------|-------------|
| **ER diagrams** | Auto-generated entity-relationship diagrams (React Flow) |
| **Query dashboard** | Analytics on execution time, frequency, and performance |
| **Health monitoring** | Database health checks and server metrics |

### Developer Experience

| Feature | Description |
|---------|-------------|
| **Command palette** | `Cmd+K` for quick actions |
| **Session recovery** | Restores tabs, connections, and editor state on restart |
| **Split editors** | Work on multiple queries side by side |
| **Find & replace** | Full-featured search across your queries |
| **Dark / Light theme** | System-aware or manually toggled, with time-based scheduling |

---

## Architecture

PurrQL follows a **clean, layered architecture** with strict separation of concerns:

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React 19)                   │
│         Zustand stores · CodeMirror · TanStack Table    │
├─────────────────────────────────────────────────────────┤
│                    IPC Layer (Tauri)                     │
│              Commands · Events · Security               │
├─────────────────────────────────────────────────────────┤
│               Application (purrql-engine)                │
│     ConnectionManager · SchemaCache · EventBus          │
├─────────────────────────────────────────────────────────┤
│                  Domain (purrql-core)                    │
│        Models · Ports (traits) · Error types            │
├────────────┬────────────┬────────────┬──────────────────┤
│  purrql-   │  purrql-   │  purrql-   │    purrql-      │
│  mysql     │  postgres  │  sqlite    │    config       │
│ mysql_async│   sqlx     │ rusqlite   │ keyring + AES   │
└────────────┴────────────┴────────────┴──────────────────┘
```

### Workspace Structure

```
purrql/
├── apps/desktop/              # Tauri desktop application
│   ├── src/                   # React frontend
│   │   ├── components/        # 27+ UI component modules
│   │   ├── stores/            # 27 Zustand state stores
│   │   ├── pages/             # Welcome, Workspace
│   │   ├── lib/               # Utilities, IPC bridge, types
│   │   └── workers/           # Web Workers (export, search)
│   └── src-tauri/             # Rust backend
│       └── src/commands/      # IPC command handlers
│
├── crates/                    # Rust library crates
│   ├── purrql-core/           # Domain models & abstract traits
│   ├── purrql-engine/         # Connection manager, cache, events
│   ├── purrql-config/         # Encrypted configuration storage
│   ├── purrql-mysql/          # MySQL driver implementation
│   ├── purrql-postgres/       # PostgreSQL driver implementation
│   └── purrql-sqlite/         # SQLite driver implementation
```

---

## Getting Started

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| **Rust** | stable | Backend compilation |
| **Node.js** | 18+ | Frontend tooling |
| **pnpm** | 9+ | Package management |
| **Platform tools** | — | Xcode (macOS) · MSVC (Windows) · build-essential (Linux) |

### Install & Run

```bash
# Clone the repository
git clone https://github.com/dgermann/dbdd.git
cd dbdd

# Install frontend dependencies
pnpm install

# Start in development mode (hot-reload)
pnpm dev
```

This launches both the Vite dev server (port `1420`) and the Tauri runtime with hot-reload.

### Build for Production

```bash
pnpm build
```

Native bundles are output to `apps/desktop/src-tauri/target/release/bundle/`.

---

## Tech Stack

### Backend (Rust)

| Crate | Role |
|-------|------|
| `tauri 2.0` | Desktop framework, IPC, window management |
| `mysql_async` | Async MySQL driver |
| `sqlx` | Async PostgreSQL driver |
| `rusqlite` | Embedded SQLite driver |
| `tokio` | Async runtime (multi-threaded) |
| `russh` | SSH tunneling |
| `keyring` + `aes-gcm` | Credential & config encryption |
| `dashmap` | Lock-free concurrent hashmap |
| `tracing` | Structured logging |

### Frontend (TypeScript)

| Library | Role |
|---------|------|
| `React 19` | UI framework |
| `Zustand 5` | State management |
| `CodeMirror 6` | SQL editor (syntax, autocomplete, formatting) |
| `TanStack Table` + `React Virtual` | Virtualized data grid (1M+ rows) |
| `@xyflow/react` | ER diagram visualization |
| `Radix UI` | Accessible UI primitives |
| `Tailwind CSS 4` | Utility-first styling |
| `Vite 6` | Build tooling |

---

## Performance

PurrQL is engineered for speed at every layer:

- **84% smaller editor bundle** — CodeMirror 6 replaced Monaco Editor
- **Streaming query results** — segment-based with batched flush
- **Virtualized rendering** — only visible rows are in the DOM
- **LRU schema cache** — 500 MB soft cap, 60s TTL
- **Web Workers** — CSV/Excel export runs off the main thread
- **Optimized Rust binary** — thin LTO, single codegen unit, stripped debuginfo

---

## Security

| Layer | Protection |
|-------|------------|
| **Credentials** | OS keyring (macOS Keychain, Windows Credential Manager, Linux Secret Service) |
| **Config storage** | Tauri Stronghold (encrypted SQLite vault) |
| **Sensitive data** | AES-256-GCM encryption at rest |
| **Network** | SSH tunneling, SSL/TLS, configurable security modes |
| **Frontend** | Content Security Policy (CSP) — no inline scripts, no external resources |
| **IPC** | Structured error codes — no stack traces or internals leak to the frontend |

---

## Roadmap

- [ ] MongoDB support
- [ ] AI-assisted query generation
- [ ] Query profiling & EXPLAIN visualization
- [ ] Database migration helper
- [ ] Plugin system
- [ ] Team collaboration features
- [ ] Linux & Windows release builds

---

## Contributing

This is currently a private project. Contributions are welcome by invitation.

---

## License

Private — All rights reserved.

---

<div align="center">

**Built with Rust and React, powered by Tauri.**

*PurrQL — because your databases deserve better.*

</div>
