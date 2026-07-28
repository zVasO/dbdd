# Plan : Correctifs & quick wins performance (vagues 1–2 de l'audit du 2026-07-28)

Source : `docs/performance-audit-2026-07-28.md`. Branche : `perf/audit-wave-1-2`.

## Global Constraints

- Ne jamais casser un comportement existant : chaque tâche liste ses commandes de vérification ; elles doivent passer avant commit.
- Frontend : `cd apps/desktop && npx tsc --noEmit` doit passer ; `npx vitest run` doit passer.
- Backend : `cargo check --workspace` et `cargo test --workspace` doivent passer (lancés depuis la racine du repo).
- Style : suivre les conventions du fichier modifié (imports, nommage, densité de commentaires). Pas de commentaires expliquant le changement — seulement les contraintes que le code ne montre pas.
- Commits atomiques par sujet logique, messages en anglais, format `fix:`/`perf:` cohérent avec `git log` récent. Terminer chaque message par les trailers Co-Authored-By/Claude-Session fournis dans le contexte du dépôt.
- Les chemins ci-dessous sont relatifs à la racine du repo `/Users/vaso/Documents/GitHub/dbdd`.

## Task 1: Correctifs frontend — crash sidebar, source de données de la grille

**Fichiers** : `apps/desktop/src/components/layout/Sidebar.tsx`, `apps/desktop/src/components/grid/DataGrid.tsx`, `apps/desktop/src/components/schema/TableStructureView.tsx`, `apps/desktop/src/components/layout/PanelLayout.tsx` (lecture pour comprendre le flux ; modification minimale si nécessaire).

**1a — Crash « Rendered fewer hooks than expected » (Sidebar.tsx)**
`Sidebar.tsx:123` contient `if (!sidebarOpen) return null;` alors que trois `useCallback` sont déclarés plus bas (`handleTableClick` ~:174, `handleColumnClick` ~:208, `handleColumnDoubleClick` ~:217). Basculer la sidebar (raccourci `global.toggleSidebar`, voir `AppLayout.tsx:152`) fait varier le nombre de hooks entre renders → crash React.
Fix : déplacer le `return null` **après** la déclaration de tous les hooks du composant (juste avant le JSX), sans changer aucune logique. Vérifier qu'aucun autre hook n'est déclaré après le return déplacé.

**1b — La grille lit l'onglet actif au lieu de sa prop `result` (DataGrid.tsx)**
`DataGrid.tsx:348-352` : le composant tire `columnarData` de `useResultStore` via `activeTabId` global, et sa prop `result` n'est jamais utilisée pour rendre les cellules. Conséquence : `TableStructureView.tsx:176-179` monte des DataGrid avec un résultat synthétique (colonnes/index/FK/contraintes) mais SANS onglet propre → ces vues affichent les données de l'onglet requête actif.
Fix attendu :
- Ajouter à `DataGrid` une source de données explicite : si une prop columnar (`data`/`rowCount`, ou un `tabId` explicite) est fournie, l'utiliser ; sinon, fallback sur le comportement actuel (store de l'onglet actif). Le choix précis d'API est laissé à l'implémenteur, mais la prop `result` passée par `TableStructureView` doit devenir la source effective des cellules de ces vues.
- `TableStructureView` passe ses données synthétiques via cette nouvelle voie.
- Ne PAS refactorer la mémoïsation de `getActiveResult` (tâche ultérieure hors périmètre).

**1c — Identité stable pour le fallback vide**
`DataGrid.tsx:351` : `const columnarData: ColumnData[] = tabResult?.data ?? [];` alloue un tableau neuf quand `tabResult` est undefined, invalidant plusieurs `useMemo`/`useCallback` en aval. Introduire une constante module `const EMPTY_COLUMNS: ColumnData[] = []` et l'utiliser comme fallback (ainsi que tout autre `?? []` du même fichier portant sur les données columnar).

**Tests** : ajouter un test vitest si l'infrastructure le permet raisonnablement pour 1b (le DataGrid rend les données passées explicitement et non celles de l'onglet actif). 1a se vérifie par lecture + tsc. Vérification : `npx tsc --noEmit` + `npx vitest run` dans `apps/desktop`.

## Task 2: Rust — limite de sécurité sur execute_batch et détection LIMIT robuste

**Fichiers** : `apps/desktop/src-tauri/src/commands/query.rs`.

**2a — `execute_batch` contourne la limite de 50 k lignes (C4)**
`query.rs:292-343` : les chemins séquentiel (DDL) et concurrent (DML) appellent `conn.execute(&sql)` brut, alors que `execute_query`/`execute_query_columnar` appliquent `needs_safety_limit`/`apply_safety_limit` (`query.rs:97-101`). Le frontend route tout texte multi-instructions vers `executeBatch` (`queryStore.ts:261-266`), donc `SELECT 1; SELECT * FROM huge` matérialise la table entière.
Fix : appliquer la même paire `needs_safety_limit`/`apply_safety_limit` à chaque statement de `execute_batch`, sur les deux chemins.

**2b — Détection LIMIT par sous-chaîne cassée dans les deux sens (C5)**
`query.rs:57-67` : la détection cherche la sous-chaîne "LIMIT" dans les ~200 derniers octets. Faux positif : `WHERE rate_limit_exceeded = true` contient "limit" → limite de sécurité non appliquée (chemin OOM). Faux négatif : un LIMIT réel suivi de >200 octets de commentaire → double LIMIT → erreur SQL.
Fix : réécrire `needs_safety_limit` pour analyser les tokens de fin de requête : retirer d'abord les commentaires (`-- …\n`, `/* … */`) et le `;` final, puis chercher le mot-clé `LIMIT` (et `FETCH FIRST`/`OFFSET … LIMIT` selon les dialectes déjà gérés) en tant que token (délimité par des non-alphanumériques), pas en sous-chaîne. Conserver le comportement : uniquement pour les SELECT sans limite. Étudier la fonction existante et les helpers du fichier avant de réécrire.
**Tests obligatoires** (cargo test, dans le module de tests du fichier ou à côté des tests existants) :
- `select * from t` → limite appliquée ;
- `select * from t limit 10` → pas de double limite ;
- `select * from t where rate_limit_exceeded = true` → limite appliquée ;
- `select * from t limit 10 -- long commentaire de plus de 200 caractères …` → pas de double limite ;
- `select 'LIMIT'` (chaîne littérale) : comportement raisonnable documenté (au pire, faux négatif de limite mais jamais de SQL invalide) ;
- une instruction non-SELECT (INSERT/UPDATE) → jamais modifiée.

**Vérification** : `cargo check --workspace` + `cargo test --workspace`.

## Task 3: Cycle de vie du streaming — annulation, fermeture d'onglet, requêtes annulables

**Fichiers** : `apps/desktop/src-tauri/src/commands/query.rs`, `apps/desktop/src/stores/queryStore.ts`, `apps/desktop/src/lib/ipc.ts`, `apps/desktop/src/components/editor/EditorToolbar.tsx`, `apps/desktop/src/stores/resultStore.ts` (lecture ; modification minimale).

**3a — Annuler un stream émet un événement terminal (C3)**
`query.rs:411-417` : la branche d'annulation dans la boucle de chunks émet seulement `AppEvent::QueryCancelled` sur le canal global `app-event` (qui n'a AUCUN abonné côté front) puis `return` — jamais de `query_done_{id}`/`query_error_{id}`. Côté front, `queryStore.ts` ne fait le cleanup des 4 `listen()` que dans `onDone`/`onError`, et `executeQuery` garde `if (tab.isExecuting) return;` (`queryStore.ts:247`) → onglet définitivement bloqué après une annulation.
Fix : émettre un événement terminal par requête sur la branche d'annulation (soit `query_done_{id}` avec un flag `cancelled`, soit un nouvel événement `query_cancelled_{id}` écouté par le front). Le front doit remettre `isExecuting: false`, désinscrire les 4 listeners et marquer le résultat partiel comme tel. Purger aussi `stream_cancellers` sur le chemin d'erreur de setup (`query.rs:501` : la branche `Err` retourne sans `remove`).

**3b — Fermer un onglet annule son stream (C7)**
`queryStore.ts:169-185` : `closeTab` appelle `clearResult(tabId)` mais n'annule ni la requête ni les listeners → le backend continue d'émettre des chunks pour un onglet mort (`resultStore.appendChunk` recrée un buffer et jette les données au flush). Fix : dans `closeTab`, si l'onglet a un `activeQueryId`, appeler `ipc.cancelQuery` et le disposer des listeners. Pour cela, stocker le disposer de `listenToStream` de façon accessible depuis `closeTab` (par ex. Map module-scope `tabId → dispose`), pas seulement dans les closures des callbacks. Couvrir aussi le changement de connexion si le même chemin s'applique naturellement.

**3c — Requêtes non-streaming annulables (C9)**
`query.rs` : `execute_query` (:82) et `execute_query_columnar` (:177) génèrent `query_id` côté serveur et ne le retournent qu'à la fin → le client ne peut pas annuler une requête en cours. `execute_query_stream` accepte déjà un id client (:353).
Fix : accepter un paramètre optionnel `query_id: Option<Uuid>` sur `execute_query` et `execute_query_columnar` (générer si absent, comportement inchangé pour les appels existants) et enregistrer un canceller consultable pour ces chemins si le mécanisme existant (`stream_cancellers` / watch) peut être réutilisé proprement ; côté TS, générer l'id dans `ipc.ts`, le stocker dans `activeQueryId` AVANT l'await sur toutes les branches (`queryStore.ts:290-312`), pour que le bouton Cancel (`EditorToolbar.tsx:125`, condition `isExecuting && activeQueryId`) apparaisse aussi sur ces requêtes. Si l'annulation effective côté SQL n'est pas réalisable sans refonte du driver, l'annulation doit au minimum abandonner l'attente côté commande et libérer l'onglet (documenter le choix dans le rapport).

**3d — Aligner la taille des chunks**
Backend défaut 1 000 lignes/chunk (`query.rs:356`), frontend flush à 5 000 (`resultStore.ts:190` `FLUSH_THRESHOLD`) → 4 événements sur 5 inutiles. Passer `chunkSize: 5000` depuis `executeQueryStream` côté `ipc.ts`/`queryStore.ts` (constante partagée avec `FLUSH_THRESHOLD`).

**Tests** : côté Rust, test unitaire si faisable sur la purge des cancellers ; côté TS, test vitest du comportement de `closeTab` (annulation appelée) si l'infra de mock IPC existe ; sinon vérification manuelle documentée dans le rapport. Vérification : `cargo check --workspace`, `cargo test --workspace`, `npx tsc --noEmit`, `npx vitest run`.

## Task 4: Kinds de colonnes de stream déterminés une fois depuis les métadonnées (C6)

**Fichiers** : `crates/purrql-core/src/models/columnar.rs`, `apps/desktop/src-tauri/src/commands/query.rs`, `apps/desktop/src/stores/resultStore.ts` (lecture ; le front garde les kinds de `initStream`).

Problème : `rows_to_columnar_chunk`/`determine_chunk_column_kind` (`columnar.rs:311-325`) ré-infèrent le kind de chaque colonne **par chunk** depuis la première cellule non-NULL du chunk (défaut `Integers` si tout-NULL). Le front fixe les kinds une fois dans `initStream` depuis `meta.columns[].data_type` et `mergeColumnArrays` (`resultStore.ts:504-514`) pousse les valeurs brutes en gardant le wrapper de base → incohérences silencieuses (colonne tout-NULL au chunk 1 taguée `Integers`, chunks suivants `Strings`).
Fix : déterminer les kinds **une seule fois** au démarrage du stream (depuis les métadonnées de colonnes déjà envoyées dans `meta`), les passer à `rows_to_columnar_chunk` qui les applique sans ré-inférence. Supprime au passage un scan par chunk. S'assurer que le kind déterminé côté Rust pour `meta.columns` et celui appliqué aux chunks proviennent de la même source.
**Tests obligatoires** : cargo test sur `rows_to_columnar_chunk` avec kinds imposés — colonne tout-NULL au premier chunk puis valeurs string au second → kind stable ; colonne numérique → valeurs numériques préservées.
Vérification : `cargo check --workspace` + `cargo test --workspace` + `npx tsc --noEmit`.

## Task 5: Quick wins backend — pool sqlx, historique de polling

**Fichiers** : `crates/purrql-postgres/src/connection.rs`, `apps/desktop/src-tauri/src/commands/query.rs`, `apps/desktop/src/lib/ipc.ts`, call sites de polling côté front, `apps/desktop/src-tauri/src/lib.rs`, `crates/purrql-config/src/` (rétention).

**5a — Pool Postgres**
`purrql-postgres/src/connection.rs:18-22` : `PgPoolOptions::new()` nu → `test_before_acquire` vaut true (un `ping()` réseau avant CHAQUE acquisition, vérifié dans sqlx 0.8) et `min_connections` vaut 0 (handshake à froid après idle).
Fix : `.test_before_acquire(false)` + `.min_connections(2)`. En contrepartie, ajouter une gestion de reprise : sur erreur « connexion fermée » (io::ErrorKind ou code sqlx correspondant), un retry unique de l'exécution. Examiner comment les erreurs sqlx remontent dans ce crate pour placer le retry au bon niveau (probablement dans la fonction d'exécution de requête du crate postgres). MySQL (`purrql-mysql`) : appliquer la même chose si le pool y a les mêmes défauts.

**5b — Le polling n'écrit plus l'historique (C-perf)**
`query.rs:123-131` : `execute_query` INSÈRE une entrée `query_history` par appel, inconditionnellement. Les timers (`monitoringStore.ts:151` 2 s, `ProcessList.tsx:158` 2 s, `HealthDashboard.tsx:39` 5 s×3, `alertStore.ts:67`, `DashboardView.tsx:70`) génèrent ~1,6 INSERT/s et noient l'historique utilisateur.
Fix : paramètre optionnel `record_history: Option<bool>` (défaut true) sur `execute_query` (et `execute_query_columnar` si l'historique y existe aussi) ; exposer dans `ipc.ts` ; passer `false` sur TOUS les call sites de polling listés ci-dessus (les repérer par `setInterval`/scheduler). Les requêtes tapées par l'utilisateur restent enregistrées.
**5c — Rétention de l'historique** : ajouter une purge (par ex. garder 10 000 entrées ou 90 jours) dans la tâche périodique de 60 s existante (`lib.rs:309-315`) ou à l'initialisation du store config. Table créée dans `purrql-config` (`migrations.rs:21-33`).

Vérification : `cargo check --workspace` + `cargo test --workspace` + `npx tsc --noEmit` + `npx vitest run`.

## Task 6: Démarrage & bundle — chunks, polices locales, spinner, imports paresseux

**Fichiers** : `apps/desktop/vite.config.ts`, `apps/desktop/index.html`, `apps/desktop/src/styles/globals.css`, `apps/desktop/src/lib/fonts.ts`, `apps/desktop/package.json`, `apps/desktop/src/stores/queryBuilderStore.ts`, `apps/desktop/src/stores/importExportStore.ts`, `apps/desktop/src/lib/exportFormats.ts`, `apps/desktop/src/stores/connectionStore.ts`.

**6a — manualChunks : épingler les petites deps partagées dans `vendor`**
Bug mesuré : Rollup place `clsx` dans le chunk `charts` et le zustand vanilla de xyflow dans `flow` → le chunk principal importe statiquement `charts` (408 Ko) + `flow` (272 Ko) + `flow-*.css` (15,85 Ko, `<link>` bloquant) au démarrage. Fix vérifié : dans `vite.config.ts` `manualChunks`, ajouter à la branche `vendor` : `clsx`, `tailwind-merge`, `class-variance-authority`, `react-is`, `zustand`, `use-sync-external-store`, `tslib`. Résultat attendu (à vérifier par build) : imports statiques de l'entrée = [vendor, icons, tanstack] (papaparse part en 6e), eager total ≈ 890 Ko au lieu de 1 578 Ko.
**6b — Sortir l'import runtime xyflow du store eager** : `stores/queryBuilderStore.ts:3` importe `applyNodeChanges, applyEdgeChanges` (runtime) — les `import type` peuvent rester. Déplacer l'usage runtime vers les composants lazy de `components/query-builder/` (par ex. passer les changes bruts au store, ou importer dynamiquement) sans changer le comportement du query builder.
**6c — Polices locales (C8)** : `index.html:6-8` charge Outfit + Geist Mono depuis Google Fonts en `<link rel="stylesheet">` bloquant ; `lib/fonts.ts:13,34` les déclare faussement `source:'bundled'`. Fix : ajouter `@fontsource/outfit` et `@fontsource-variable/geist-mono` aux dépendances (`pnpm --filter desktop add …`), importer les poids utilisés (300–700 pour Outfit, 400–600 pour Geist Mono) dans `styles/globals.css`, supprimer les 3 `<link>` de `index.html`. Les déclarations `source:'bundled'` de fonts.ts deviennent alors exactes. Le loader Google Fonts opt-in de `fonts.ts:72-79` reste inchangé.
**6d — Spinner inline avant le mount React** : `index.html:12` est un `<div id="root">` nu (régression vs build d'avril). Ajouter ~10 lignes inline dans `index.html` : fond sombre (couleur de fond du thème par défaut) + spinner CSS centré, remplacé naturellement au mount. Respecter `prefers-reduced-motion` (opacité pulsée plutôt que rotation).
**6e — `build.target: 'esnext'`** dans vite.config.ts (WebView Tauri connue).
**6f — papaparse en dynamic import** : `stores/importExportStore.ts:2` et `lib/exportFormats.ts:1` importent Papa statiquement (`AppLayout` importe le store eager) ; suivre le modèle xlsx déjà présent (`exportFormats.ts:93` : `const XLSX = await import('xlsx')`).
**6g — Restauration : supprimer le rechargement redondant** : `stores/connectionStore.ts:74` — `connect()` termine par `await get().loadSavedConnections()`, redondant (le caller `App.tsx:85` a déjà chargé ; N connexions restaurées = N re-déchiffrements). Supprimer la ligne et mettre à jour l'état local si nécessaire (vérifier que l'UI des connexions sauvegardées reste correcte après un connect frais — au besoin, mettre à jour l'entrée localement au lieu de tout recharger).

**Vérification** : `npx tsc --noEmit`, `npx vitest run`, puis `pnpm --filter desktop build:frontend` et confirmer dans la sortie : (1) les imports statiques du chunk d'entrée n'incluent plus charts/flow/papaparse (inspecter `dist/index.html` et le head du chunk index), (2) plus de `flow-*.css` dans `index.html`, (3) plus de référence à fonts.googleapis.com.
