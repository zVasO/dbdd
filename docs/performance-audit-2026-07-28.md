# Audit de performance & fluidité — 28 juillet 2026

Objectif : rendre l'app ultra-réactive. Audit mené sur 5 axes en parallèle (rendu React, virtualisation/grosses données, IPC Tauri, démarrage/bundle, backend Rust), chaque constat vérifié dans le code, tailles de bundle mesurées sur un build de production réel.

**État général : l'architecture est bonne.** Stockage columnar avec matérialisation paresseuse, streaming avec flush par 5 000 lignes, code splitting des 19 vues lourdes, pool de connexions, stale-while-revalidate sur `list_tables`, redimensionnement de colonnes via variables CSS hors React. Les problèmes sont des cas où ce bon travail est **court-circuité en aval** — pas des défauts de conception.

---

## P0 — Bugs de correction découverts pendant l'audit

À corriger avant toute optimisation.

| # | Bug | Où | Effet |
|---|-----|----|----|
| C1 | 3 `useCallback` placés **après** `if (!sidebarOpen) return null` | `Sidebar.tsx:123` vs `:174-217` | Crash « Rendered fewer hooks than expected » au raccourci toggle sidebar |
| C2 | La grille lit `resultStore[activeTabId]` au lieu de sa prop `result` | `DataGrid.tsx:348-352`, `TableStructureView.tsx:176-179` | Les sous-onglets Structure affichent les données de l'onglet requête actif |
| C3 | Annuler une requête streaming n'émet aucun événement terminal | `query.rs:411-417` ↔ `queryStore.ts:247` | Onglet définitivement bloqué (`isExecuting` reste vrai) + fuite de 4 listeners |
| C4 | `execute_batch` n'applique pas la limite de sécurité de 50 k lignes | `query.rs:292-343` | `SELECT 1; SELECT * FROM huge` matérialise toute la table → OOM |
| C5 | Détection LIMIT par sous-chaîne sur les 200 derniers octets | `query.rs:57-67` | `WHERE rate_limit_exceeded = true` désactive la limite ; LIMIT réel + commentaire long → double LIMIT → erreur SQL |
| C6 | Kind de colonne ré-inféré par chunk de stream, jeté au merge | `columnar.rs:311-325` ↔ `resultStore.ts:504-514` | Colonne 100 % NULL au 1er chunk taguée `Integers`, chunks suivants `Strings` → rendu faux silencieux |
| C7 | Fermer un onglet en plein stream n'annule pas la requête | `queryStore.ts:169-185` | Le backend continue d'émettre des chunks jetés à plein régime |
| C8 | `lib/fonts.ts:13,34` déclare Outfit/Geist Mono `source:'bundled'` alors qu'elles sont chargées depuis Google Fonts | `index.html:6-8` | Modèle interne faux + voir P1-1 |
| C9 | Requêtes non-streaming inannulables (`query_id` généré côté serveur, retourné seulement à la fin) | `query.rs:82,177` ↔ `EditorToolbar.tsx:125` | Browse de table / `COUNT(*)` lents inannulables |

---

## P1 — Démarrage : gains vérifiés sur build réel

### 1. Polices Google Fonts = paint bloqué par le réseau (HIGH)
`index.html:6-8` : `<link rel="stylesheet">` bloquant vers fonts.googleapis.com. Hors-ligne / VPN / portail captif → fenêtre blanche jusqu'au timeout (non borné). Une app desktop locale ne doit pas dépendre du réseau pour peindre — ni téléphoner à Google à chaque lancement.
**Fix** : `@fontsource/outfit` + `@fontsource-variable/geist-mono`, `@import` dans `globals.css`, supprimer les 3 `<link>`.

### 2. Fuite clsx/zustand dans les chunks charts/flow : −688 Ko eager (HIGH, vérifié)
`manualChunks` isole recharts → `charts` (408 Ko) et xyflow/dagre → `flow` (272 Ko), mais Rollup a placé `clsx` (utilisé par le `cn()` de toute l'UI) dans `charts`, et le zustand vanilla de xyflow dans `flow`. Le chunk principal les importe donc **statiquement au démarrage**, ce qui court-circuite le lazy loading des vues, et tire aussi `flow-*.css` (15,85 Ko) en `<link>` **bloquant le rendu**.
**Fix vérifié par build** : ajouter `clsx`, `tailwind-merge`, `class-variance-authority`, `react-is`, `zustand`, `use-sync-external-store`, `tslib` à la branche `vendor` de `manualChunks` (`vite.config.ts`). Eager : 1 578 Ko / 453 Ko gz → **890 Ko / 246 Ko gz**. Sortir aussi l'import runtime `applyNodeChanges/applyEdgeChanges` de `stores/queryBuilderStore.ts:3` (seul import xyflow eager).

### 3. Cascade d'hydratation à la restauration de session (HIGH)
`App.tsx:72-103` → jusqu'à 5 allers-retours **séquentiels** avant la première donnée, pendant lesquels l'utilisateur voit WelcomePage.
- `connectionStore.ts:74` : `connect()` re-fetch **toutes** les connexions sauvegardées (avec re-déchiffrement) après chaque succès — N connexions restaurées = N appels redondants. Supprimer la ligne.
- `AppLayout.tsx:104-111` : branche séquentielle `loadDatabases → loadTables` évitable en propageant la `database` déjà persistée par `sessionRecovery`.
- Rendre WorkspacePage **optimistiquement** (squelette de sidebar) dès la restauration des onglets, sans attendre la connexion.

### 4. Fenêtre blanche avant le mount React (MEDIUM — régression)
`index.html:12` est un `<div id="root">` nu ; l'ancien build (avril) avait un spinner sombre inline. Restaurer ~10 lignes inline = le meilleur gain perçu par octet.

### 5. Divers démarrage
- `papaparse` eager via `importExportStore.ts:2` + `exportFormats.ts:1` → dynamic import comme le fait déjà `xlsx` (`exportFormats.ts:93`).
- `build.target: 'esnext'` dans vite.config.ts (WebView connue, downleveling inutile).
- 8 stores font `localStorage` + `JSON.parse` sync au scope module — garder themeStore (anti-flash), différer notes/snippets/favorites/aiStore si le profiling le justifie (LOW).

---

## P2 — Fluidité de la grille (le chemin le plus chaud)

### 1. `memo(DataGrid)` totalement neutralisé (HIGH — ~10 lignes, débloque tout le reste)
`resultStore.ts:675-690` : `getActiveResult()` fabrique un objet neuf à chaque appel, invoqué pendant le render dans `PanelLayout.tsx:477` ; + handler inline `onHighlightDone` (`PanelLayout.tsx:492`). Chaque flush de streaming, changement d'onglet ou état local de PanelLayout re-rend les 2 050 lignes de DataGrid.
**Fix** : cacher le résultat dérivé dans le store (comme `_rowsCache` existant), invalider sur `data`/`activeResultIndex` ; hoister le handler en `useCallback`.

### 2. Colonnes non virtualisées (HIGH)
`DataGrid.tsx:1522` : `useVirtualizer` ne couvre que les lignes. 200 colonnes × 30 lignes visibles = ~7 000 cellules DOM, chacune avec 4 closures + `cn()` à 6 branches, re-rendues à chaque tick de scroll.
**Fix** : second `useVirtualizer` horizontal sur `visibleColumns` (corps + header) — le schéma de largeurs par variables CSS existant (`:701`) est déjà compatible.

### 3. Lignes/cellules non mémoïsées + sélection par rectangle (HIGH)
- Corps de grille entièrement inline dans le parent (`DataGrid.tsx:1471-1658`) : extraire `<GridRow>`/`<GridCell>` `memo` avec props primitives, handlers stables lisant `data-*`.
- Drag-sélection : reconstruit un `Set<string>` couvrant tout le rectangle **à chaque mouseenter** (`:880-897`) — 10 000 allocations par événement souris sur 500×20. Stocker la sélection comme rectangle `{anchorRow, anchorCol, focusRow, focusCol}`, matérialiser le Set seulement à la copie.

### 4. Copie/export synchrones sur le main thread (HIGH)
`DataGrid.tsx:1013-1048` (copySelection), `:1294-1340` (exportData), `ExportDialog.tsx:150` → matérialisation complète + `JSON.stringify` sur le main thread ; `workers/export.worker.ts` existe mais n'est pas branché sur ces chemins. Ctrl+A/Ctrl+C sur 100 k lignes = app gelée.
**Fix** : point d'entrée columnar dans export.worker.ts (colonnes + tableau d'indices).

### 5. Boucle de cellules : scans linéaires (MEDIUM)
`getCellPendingEdit` = `.find()` par cellule (`:1528`), `isRowDeleted` = `.some()` par ligne (`:1476`) → 300 k comparaisons/render en édition bulk. Précalculer `Map` `${row}:${col}` + `Set` d'indices supprimés dans un `useMemo` ; `selectedCells` en `Map<number, Set<number>>`.

### 6. Divers grille (MEDIUM)
- Filtre worker : `useDeferredValue` ≠ debounce → 1 message par frappe, scan complet 20 M de cellules (`:175-178`, `grid.worker.ts:9-27`) ; + 2 bugs : flash de lignes **non filtrées** pendant le vol (`:442-446`), `sortedIndices` obsolète non purgé (`:180-190`). Debounce 150 ms + narrowing incrémental + cache lowercase.
- Worker spawné par instance de DataGrid même si inutile (`:121-143`) — lazy sur premier `useWorker === true`.
- `transition-colors duration-300` sur ~1 500 cellules (`:1539`) — retirer sur les cellules ; aucune occurrence de `contain`/`content-visibility` dans la base : ajouter `contain: layout paint` au corps virtualisé.
- Show/Hide All = 1 écriture de store **par colonne** (`ColumnFilter.tsx:28-30`) — action batch.
- `columnarData ?? []` crée une identité neuve (`:351`) — constante module `EMPTY_COLUMNS`.
- `estimateTabMemory` scanne O(lignes×colonnes) à chaque setResult (`memory-manager.ts:6-30`) — échantillonner 1 000 lignes et extrapoler.

---

## P3 — Sidebar & vues annexes

- **Sidebar non virtualisée** : 500 tables = ~1 500 instances Radix (Collapsible+ContextMenu+Tooltip par nœud, `TableNode.tsx:83-226`). Virtualiser la liste aplatie ; un seul ContextMenu/Tooltip piloté au hover.
- **Abonnement à toute la map `structures`** (`Sidebar.tsx:50`) : chaque expansion re-rend tout l'arbre. Abonner chaque `TableNode` à sa tranche. (Le store a déjà résolu ce problème pour `_columnsByDb` — même remède.)
- `TableNode`/`ColumnNode`/`DatabaseNode` non `memo` + closures inline (`Sidebar.tsx:476-487,514-515`) — chaque frappe de recherche re-rend tous les nœuds.
- `backdrop-blur-xl` plein écran sur la sidebar (`Sidebar.tsx:265`) : re-blur GPU permanent à côté d'une grille qui bouge — `backdrop-blur-sm` ou fond opaque.
- `ActivityBar` : abonnement sans sélecteur + 5 filtres non mémoïsés sur 200 entrées à chaque render (`ActivityBar.tsx:32,43-49`), toujours monté. `useShallow` + un seul `useMemo`. Même motif dans `LiveMetrics`/`AlertConfig`/`AlertHistory`/`TableDesigner`/`ImportDialog` (lazy, moins urgents).
- `EditorTabs` s'abonne à toute la map `results` pour lire un booléen (`EditorTabs.tsx:38`) — jank de la barre d'onglets pendant le streaming.
- ER diagram : `generateDiagram` complet + dagre 500 nœuds **par table chargée** (`ERDiagramView.tsx:125-129`) — debounce ~300 ms.
- `COUNT(*)` refait à **chaque alternance d'onglets table** (`PanelLayout.tsx:162-182`, garde à 1 seul élément) — `Map` keyée `db.table`.
- Dialog Data Generator : `ProviderSelect.tsx:3` importe statiquement `dataGenProviders` → tire les **3 Mo de faker** à l'ouverture, court-circuitant le lazy-load prévu dans `dataGenStore.ts:8-11`. Séparer métadonnées (~8 Ko) et closures faker.
- Code mort : `QueryTimeline.tsx` (jamais rendu, `setInterval` 30 s actif) — supprimer.

---

## P4 — Backend Rust & IPC

### 1. Pool Postgres : un ping réseau avant chaque requête (HIGH — 1 ligne)
`purrql-postgres/src/connection.rs:18-22` : `test_before_acquire` vaut true par défaut dans sqlx → RTT supplémentaire par requête, ×4 dans `get_table_structure` (4 requêtes catalogue concurrentes). **Fix** : `.test_before_acquire(false).min_connections(2)` + retry sur connexion fermée.

### 2. Résultats matérialisés 3× sans `spawn_blocking` (HIGH)
`query.rs:172` : `Vec<PgRow>` → `Vec<Row>` (`CellValue` = 40 octets même pour NULL, mesuré) → `ColumnarResult` → JSON, sur un worker Tokio partagé. 50 k×20 = 40 Mo pour le seul tableau d'enums + 50 k mallocs. Le doc-comment de `query.rs:166-169` signale déjà la sortie columnar au niveau driver comme travail futur — c'est le bon refactor (tue l'intermédiaire, la taxe 40 o/cellule et les 2 passes de transpose de `columnar.rs:200-209` d'un coup).

### 3. Cache de structures = code mort (HIGH)
`schema_cache.rs:16` : la DashMap `structures` est évincée mais jamais lue/écrite (vérifié par grep workspace). Chaque expansion sidebar / diff / table designer = 5 allers-retours catalogue. **Fix** : `get_structure`/`set_structure` en stale-while-revalidate, miroir de `get_tables` ; l'invalidation DDL (`query.rs:141`) couvre déjà la correction.

### 4. Une ligne d'historique SQLite par tick de polling (HIGH)
`query.rs:123-131` : INSERT inconditionnel. Monitoring 2 s + ProcessList 2 s + Health 5 s×3 ≈ 1,6 INSERT/s, ~43 k lignes/jour, **aucune rétention** (`migrations.rs:21-33`), et l'historique utilisateur est noyé sous `SHOW GLOBAL STATUS`. **Fix** : flag `record_history: bool` (ou commande interne dédiée) + purge dans la tâche 60 s existante (`lib.rs:309-315`).

### 5. Diff de schéma : N+1 doublé (HIGH)
`migrationStore.ts:220-238` : 1 `get_table_structure` par table et par côté (500 tables = 1 000 invokes simultanés). Le bulk `list_all_columns` existe déjà (même fix que le commit 13445d5 pour la sidebar) — élargir `ColumnRef` si besoin.

### 6. Import CSV : tout le dataset dans un seul invoke JSON (HIGH)
`CsvImportDialog.tsx:136-150`, `importExportStore.ts:300-313` : 100 Mo de CSV → ~20 000 INSERT dans **un** `executeBatch`, réponse = 20 000 `QueryResult` complets. Le fichier est déjà lu en Rust puis fait l'aller-retour JS pour rien. **Fix court terme** : fenêtres de ~200 statements + retour `{affected_rows, error}`. **Long terme** : commande `import_csv` 100 % Rust.

### 7. Moyennes
- Bus `app-event` : **zéro abonné** (`useTauriEvent` importé nulle part) — tout est sérialisé pour être jeté. Le brancher sur `activityStore` (fournit au passage le signal d'annulation manquant du bug C3) ou le supprimer.
- Chunks de stream : backend 1 000 lignes, frontend flush à 5 000 → 4 événements sur 5 inutiles. Passer `chunkSize: 5000` (1 ligne).
- `pg_typed_cell` matche le nom de type **par cellule** (`postgres/connection.rs:66,210`) = 1 M de comparaisons de strings pour 50 k×20 — précalculer un tag enum par colonne.
- `list_all_columns` passe par `information_schema.columns` (lent, vérifie les privilèges) au lieu de pg_catalog (`schema_inspector.rs:518-521` — la leçon de la ligne 122 du même fichier) ; c'est aussi le seul appel schéma sans `dedup()` côté TS (`ipc.ts:106`).
- MySQL en protocole texte (`mysql/connection.rs:110`) : parse UTF-8 + String par cellule — passer au binaire comme `exec` (`:169`).
- IPC binaire (Tauri 2.10 `ipc::Response`) : projet, pas patch — chunks de stream d'abord (`ChunkPayload`, `query.rs:19-23`), puis `execute_query_columnar`. ~2× sur payloads numériques + zéro parse.
- Fuite mineure : `stream_cancellers` non purgé sur le chemin d'erreur (`query.rs:501`).
- Confort dev : `[profile.dev.package."*"] opt-level = 2`.

---

## Ce qui est déjà bon — ne pas « réparer »

Columnar + matérialisation paresseuse (`resultStore.ts`), pipeline filtre/tri par index-map, merge de stream O(n) in-place, resize de colonnes via CSS vars hors React, sync fuzzy débouncée hors store réactif (`schemaStore.ts:143-171`), bridge fuzzy avec annulation + respawn, dedup des invokes en vol (`ipc.ts:26-33`), splitting des 19 vues lazy, aucun Mutex tenu à travers un await, guards DashMap correctement scopés, `tokio::join!` 4-way des inspecteurs, profil release (`lto=thin`, `codegen-units=1`), page size par défaut 100.

---

## Plan d'attaque recommandé

| Vague | Contenu | Effort | Gain |
|---|---|---|---|
| **1. Correctifs** | C1–C9 (crash sidebar, données croisées, onglet bloqué, limite 50 k, kinds de colonnes, annulation) | 1–2 j | Stabilité + débloque le reste |
| **2. Quick wins** | sqlx `test_before_acquire(false)` · manualChunks vendor (−688 Ko) · polices locales · spinner inline · `chunkSize: 5000` · suppression `connectionStore.ts:74` · flag no-history sur polling · `EMPTY_COLUMNS` | ~1 j | Démarrage divisé par 2+, latence par requête −1 RTT |
| **3. Memo boundary grille** | `getActiveResult` stable + `onHighlightDone` + GridRow/GridCell memo + sélection rectangle + Maps pendingChanges | 2–3 j | Le gros de la fluidité perçue |
| **4. Virtualisation** | Colonnes DataGrid + sidebar aplatie + slices `structures` | 2–3 j | Tables larges + gros schémas |
| **5. Gros chantiers** | Copie/export en worker · cache structures Rust · sortie columnar niveau driver · import CSV en Rust · IPC binaire | 1–2 sem | Datasets massifs |
