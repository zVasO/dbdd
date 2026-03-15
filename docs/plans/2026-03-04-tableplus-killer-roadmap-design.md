# PurrQL — "TablePlus Killer" Roadmap Design

**Date:** 2026-03-04
**Positionnement:** Client database desktop ultra-rapide, beau, et intelligent. Parité TablePlus minimum, puis différenciation par l'IA et les plugins.
**Stack:** Tauri 2.0 + React 19 + Rust (async Tokio) + Monaco Editor + Zustand

---

## Etat Actuel (v0.1.0 MVP)

- Connexions MySQL, PostgreSQL, SQLite
- Editeur SQL Monaco (syntax highlighting, autocomplete)
- Grille de données virtualisée (react-virtual)
- Export CSV, JSON, SQL
- Tabs multiples pour queries
- Command Palette (Ctrl+K)
- Dark/Light mode
- Sidebar avec navigation schema (databases → tables → columns)
- Query history (100 par connexion)
- Activity log
- SSH tunneling (infra Rust en place)
- Stockage sécurisé des mots de passe (OS keyring)

---

## PHASE 1 — Fondations & Parité Core

Objectif : Produit utilisable en production, fiable et sûr.

### 1.1 Safe Mode & Commit Workflow

Toute modification GUI reste en mémoire locale jusqu'au commit explicite.

- **Pending changes buffer** : Modifications GUI stockées en mémoire (P0)
- **Commit changes** (`Ctrl+S`) : Envoie les modifications en transaction (P0)
- **Code Preview** (`Ctrl+Shift+P`) : Affiche le SQL généré avant commit (P0)
- **Discard changes** (`Ctrl+Shift+Del`) : Annule les modifications pendantes (P0)
- **5 niveaux de Safe Mode** : Silent → Alert → Alert (sauf SELECT) → Password → Password (sauf SELECT) (P1)
- **Undo/Redo** (`Ctrl+Z` / `Ctrl+Shift+Z`) : Sur modifications pendantes (P0)
- **Visual diff indicators** : Cellules modifiées surlignées, nouvelles lignes vertes, suppressions rouges (P0)

### 1.2 Inline Editing Fonctionnel

- **Cell editing** : Double-clic pour éditer, Tab pour naviguer (P0)
- **Row insert** : Bouton `+` ou `Ctrl+I` (P0)
- **Row duplicate** : `Ctrl+D` (P1)
- **Row delete** : Touche `Delete` sur sélection (P0)
- **Copy/Paste rows** : `Ctrl+C` / `Ctrl+V` (P1)
- **Right sidebar editor** : Panel pour éditer tous les champs d'une ligne (Space) (P1)
- **Quick Edit Menu** : `Alt+Click` (P2)
- **NULL handling** : Bouton SET NULL vs chaîne vide (P0)

### 1.3 Filtres Avancés

- **Row filter** (`Ctrl+F`) : Colonne + opérateur + valeur → WHERE (P0)
- **Multiple filters** : AND/OR combinés (P0)
- **Quick filter** : Clic droit cellule → "Filter by this value" (P1)
- **Column filter** (`Ctrl+Alt+F`) : Masquer/afficher colonnes (P1)
- **Filter operators** : =, !=, LIKE, >, <, >=, <=, IS NULL, IS NOT NULL, IN, BETWEEN (P0)
- **View generated SQL** : Bouton "SQL" (P1)

### 1.4 Schema Management (CRUD)

- **Create table** : UI visuelle (nom, colonnes, types, PK, nullable, default) (P0)
- **Alter table** : Ajouter/modifier/supprimer colonnes inline (P0)
- **Drop table** : Avec confirmation + Safe Mode (P0)
- **Truncate table** : Vider données, garder structure (P1)
- **Rename table** : Inline dans sidebar (P1)
- **Index management** : CRUD index (P1)
- **Foreign key management** : CRUD FK visuel (P1)
- **Trigger management** : CRUD triggers (P2)
- **View management** : CRUD vues SQL (P1)
- **Function/Procedure management** : CRUD avec éditeur (P2)

### 1.5 Import Complet

- **Import CSV** : Mapping colonnes, détection types, création table auto (P0)
- **Import SQL dump** : Exécution fichiers .sql (P0)
- **Import JSON** : Array of objects (P1)
- **CSV config** : Delimiter, quote char, encoding (P1)

### 1.6 Backup & Restore

- **Database backup** : Dump complet → .sql (P0)
- **Database restore** : Depuis dump .sql (P0)
- **Table-level backup** : Structure + données d'une table (P1)
- **Dump scripts** : Copy as CREATE, DROP, TRUNCATE, INSERT (P1)

### 1.7 Databases Additionnelles

| Database | Driver Rust | Priorité |
|----------|-------------|----------|
| MariaDB | Via MySQL driver (compatible) | P0 |
| SQL Server (MSSQL) | `tiberius` crate | P0 |
| Redis | `redis-rs` crate | P1 |
| MongoDB | `mongodb` crate | P1 |
| CockroachDB | Via PostgreSQL driver | P1 |
| Amazon Redshift | Via PostgreSQL driver | P1 |
| DuckDB | `duckdb-rs` crate | P1 |
| ClickHouse | `clickhouse-rs` crate | P2 |
| Cassandra | `scylla` crate | P2 |
| Oracle | `sibyl` crate | P2 |
| Snowflake | REST API + Arrow | P2 |
| BigQuery | REST API | P2 |
| Vertica | ODBC | P3 |
| DynamoDB | `aws-sdk-dynamodb` | P3 |

### 1.8 Copy Formats Enrichis

- **Copy as JSON** (P0)
- **Copy as INSERT** (P0)
- **Copy as CSV** avec/sans headers (P0)
- **Copy as Markdown** (P1)
- **Copy as HTML** (P2)

---

## PHASE 2 — UX & Productivité

Objectif : Plus agréable et plus rapide que TablePlus.

### 2.1 Multi-Window & Workspaces

- **Multi-window** : Nouvelle fenêtre Tauri par connexion (P0)
- **Workspaces** : Chaque database = un workspace (P0)
- **Switch database** (`Ctrl+K`) (P0)
- **Switch connection** (`Ctrl+Shift+K`) (P0)
- **Session recovery** : Restaurer tabs/workspaces au redémarrage (P1)
- **Move tab to new window** (P2)

### 2.2 Open Anything (`Ctrl+P`)

- **Fuzzy search global** : Tables, vues, fonctions, databases, connexions (P0)
- **Quick jump** : Sélection → navigation directe (P0)
- **Recent items** : 10 derniers en haut (P1)
- **Scope icons** : Distinguer table/vue/fonction/connexion (P1)

### 2.3 Query Favorites & Keywords

- **Save query as favorite** : Nom + keyword + dossier (P0)
- **Keyword binding** : Keyword + Enter → insère la query (P1)
- **Folders** : Organisation drag & drop (P1)
- **Auto-save queries** (P1)
- **Open/Save SQL files** : `Ctrl+O` / `Ctrl+Shift+S` (P0)

### 2.4 SQL Formatter

- **Beautify SQL** (`Ctrl+I`) (P0)
- **Uglify SQL** (`Ctrl+Shift+I`) (P2)
- **Comment/Uncomment** (`Ctrl+/`) (P0)
- **Auto uppercase keywords** (P1)

### 2.5 Split Panes

- **Split editor** (`Ctrl+Shift+D`) (P1)
- **Independent execution** par pane (P1)
- **Split results into tabs** (P1)

### 2.6 Console Log

- **Query log panel** (`Ctrl+Shift+C`) (P0)
- **Filter log** : Meta / Data / All (P1)
- **Copy query from log** (P1)
- **Clear log** (P0)
- **Execution time** par query (P0)

### 2.7 Connection UX

- **Connection colors** (P0)
- **Environment tags** : Local/Dev/Testing/Staging/Production (P0)
- **Connection groups** : Dossiers drag & drop (P1)
- **Import/Export connections** : `.purrql-connections` (P1)
- **Connection URL import** : Coller URL → auto-fill (P0)
- **Keep-alive pings** : 30s configurable (P0)

### 2.8 Quick Look & Cell Viewer

- **Quick Look popup** : Middle-click ou clic droit (P0)
- **JSON viewer** : Pretty-print + syntax highlighting (P0)
- **Image preview** : BLOB/bytea (P2)
- **HEX viewer** : Données binaires (P2)

### 2.9 Foreign Key Navigation

- **FK arrows** : Indicateurs visuels (P1)
- **Click to navigate** : FK → table référencée filtrée (P1)
- **FK popup** : Hover → info relation (P2)

### 2.10 Data Grid Enhancements

- **Pagination** : 300/500/1000/all configurable (P0)
- **Column sorting** : Clic header DESC → ASC → cancel (P0)
- **Column resize** : Drag bordures (P0)
- **Column reorder** : Drag & drop (P2)
- **Alternating row colors** (P1)
- **Streaming results** : Non-bloquant (P1)
- **Estimate row count** : Stats plutôt que COUNT(*) (P1)

### 2.11 Preferences Complètes

- **Page Preferences dédiée** (P0)
- **General** : Theme, startup, session recovery (P0)
- **Editor** : Font, taille, autocomplete, auto-uppercase (P1)
- **Data Table** : Font, padding, alternating colors, pagination (P1)
- **Connections** : Timeout, keep-alive, SSH defaults (P1)
- **CSV** : Delimiter, quote char, encoding (P1)
- **Keyboard shortcuts** : Customizable (P2)
- **Security** : Safe Mode default, passcode (P1)

---

## PHASE 3 — Différenciation & Kill Features

Objectif : Dépasser TablePlus. Devenir le #1.

### 3.1 LLM / AI Intégré

- **NL-to-SQL** : Langage naturel → SQL (P0)
- **AI sidebar chat** : Panel contextuel (connaît le schema) (P0)
- **Multi-provider** : OpenAI, Anthropic, Ollama (local), GitHub Copilot (P0)
- **Privacy-first** : Seul le DDL envoyé, JAMAIS les données (P0)
- **Query explanation** : "Explain this" (P1)
- **Query optimization** : Suggestions d'index, réécriture (P1)
- **Error fix** : "Fix with AI" en un clic (P1)
- **Auto-documentation** : Commentaires/descriptions pour tables et colonnes (P2)
- **Test data generation** : "Generate 100 realistic users" (P2)

### 3.2 Plugin System (JS)

- **Plugin runtime** : JS sandboxé (P1)
- **Plugin API** : Accès schema, résultats, éditeur (P1)
- **Plugin manager** (`Ctrl+L`) (P1)
- **Built-in plugins** : SQL Formatter, Dump Table, Open URL (P1)
- **Community plugins** : Marketplace ou GitHub (P2)
- **Laravel Migration export** (P2)

### 3.3 ER Diagrams

- **Auto-generate** : Depuis database, détection FK (P1)
- **Interactive** : Drag & drop, zoom, pan (P1)
- **Export** : PNG, SVG, PDF (P1)
- **Filter** : Sélection des tables à inclure (P2)

### 3.4 Metrics Board / Dashboards

- **Dashboard builder** : Drag & drop widgets (P2)
- **Chart types** : Bar, Line, Pie, Scoreboard (P2)
- **Data tables** : Widgets SQL custom (P2)
- **Input fields** : Variables liées aux queries (P2)
- **Auto-refresh** : Configurable par widget (P2)

### 3.5 Process List

- **View active queries** : Processus serveur (P1)
- **Kill query** : Depuis l'UI (P1)
- **Sort/filter** : Par durée, user, database (P2)

### 3.6 User Management

- **Create/edit users** : Username, password, privileges (P2)
- **Global privileges** (P2)
- **Database privileges** : Per-database (P2)
- **Resource limits** (P3)

### 3.7 PurrQL Exclusives

- **Query versioning** : Git-like history, diff, revert (P2)
- **Schema diff** : Comparer 2 databases (P2)
- **Schema snapshots** : Sauvegarder état d'un schema (P2)
- **Team sync** : Partage connexions/queries (cloud optionnel) (P3)
- **Data masking** : Masquer données sensibles en lecture (P3)
- **Performance dashboard** : Slow queries, index usage, table stats (P3)

---

## Positionnement Prix

| Tier | TablePlus | PurrQL |
|------|-----------|-----------|
| Free | 2 tabs, 2 windows | 3 tabs, 2 windows, AI limité (5 queries/jour) |
| Pro | $89 one-time | $69 one-time OU $7/mois |
| Team | N/A | $12/mois/user (sync, shared queries) |

L'AI gratuit limité est le hook d'acquisition — aucun concurrent ne propose ça.

---

## Résumé

| Phase | Features | Résultat |
|-------|----------|----------|
| P1 | ~45 features | Produit utilisable en production |
| P2 | ~50 features | Parité TablePlus atteinte |
| P3 | ~35 features | PurrQL > TablePlus |
| Total | ~130 features | #1 du marché |
