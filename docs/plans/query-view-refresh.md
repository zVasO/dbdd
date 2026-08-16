# Query View Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un éditeur SQL visuellement cohérent dans les deux modes (le thème actuel est cassé), un ⌘K fiable qui donne accès aux requêtes, et un système de requêtes sauvegardées **par base de données** avec nommage, persisté en SQLite.

**Architecture:** Trois tâches. T1 reconstruit le thème CodeMirror sur les tokens de l'app (via `color-mix` pour les teintes dérivées — les tokens sont oklch, jamais parsables en JS sans coût), fiabilise ⌘K (binding CM6 prioritaire + audit du verrou modal + badge honnête) et polit la vue requête. T2 ajoute la persistance Rust/SQLite (`saved_queries` par connexion+base, migrations idempotentes existantes) + commandes Tauri + bindings TS. T3 construit la fonctionnalité frontend : store, dialogue de sauvegarde (modèle SnippetEditor), intégration palette ⌘K (groupe « Saved queries » par base), bouton toolbar, remplacement du stub « New from Template », suivi `savedQueryId` sur les onglets.

**Tech Stack:** React 19, Zustand 5, CodeMirror 6, cmdk, Rust (rusqlite via purrql-config), Tauri 2, vitest (node), cargo test.

## Global Constraints

- Vérification par tâche : `npx tsc --noEmit`, `npx vitest run` (apps/desktop, 214 verts aujourd'hui), `pnpm --filter desktop build:frontend` (racine) ; + `cargo check --workspace` et `cargo test --workspace` pour les tâches touchant le Rust. Tout doit passer avant commit.
- Travail direct sur `master`, push après chaque tâche (`git push origin master` ; fetch+rebase si rejet).
- Trailers exacts sur chaque commit :
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01CVerLtPhHhQbDjA6p7ZMaG`
- Diffs chirurgicaux ; pas de commentaires expliquant le changement.
- Invariants des vagues perf (intouchables) : handlers stables `[]`+snapshot ref de DataGrid/Sidebar ; memo boundaries ; `useKeyboardShortcut` reste à un seul listener window ; l'ordre de `SHORTCUT_DEFS` décide du premier match.
- Design tokens : n'utiliser QUE les variables de `globals.css` (`--background`, `--foreground`, `--muted(-foreground)`, `--primary`, `--accent`, `--border`, `--radius`…) ou des `color-mix(in oklab, var(--x) N%, …)` / littéraux `oklch()` choisis ici. Aucun hex VS Code résiduel.
- Toute nouvelle boîte de dialogue enregistre/désenregistre son id modal (`useUIStore.pushModal/popModal` dans un effet, pattern CommandPalette.tsx:60-65) — sinon elle tue tous les raccourcis globaux.
- Fichiers d'état/localStorage : les requêtes sauvegardées vont en **SQLite** (config store), pas en localStorage — c'est le point du ticket (persistant, par base, partageable plus tard).

---

### Task 1: Thème éditeur reconstruit + ⌘K fiable + polish de la vue

Le commit utilisateur e57f9e4 a remplacé un `cssVarToHex` mort-né (il ne parsait que du HSL ; tous les tokens sont oklch → fallback VS Code permanent) par des `var()` bruts. Résultat : palette incohérente — en dark `--accent` (oklch L=0.213) est PLUS SOMBRE que `--background` (L=0.268) donc la ligne active est une bande noire ; en light la sélection `#add6ff` et les couleurs de syntaxe VS Code jurent avec le thème orange/neutre. Reconstruire proprement. En même temps : ⌘K doit fonctionner partout (y compris focus éditeur) et le badge de la status bar ment (« Ctrl+K » codé en dur, StatusBar.tsx:182).

**Files:**
- Modify: `apps/desktop/src/components/editor/codemirror/theme.ts` (réécriture de la palette)
- Modify: `apps/desktop/src/components/editor/codemirror/keybindings.ts` (+ binding palette)
- Modify: `apps/desktop/src/components/editor/CodemirrorEditor.tsx` (si le keymap a besoin d'un callback palette)
- Modify: `apps/desktop/src/components/layout/StatusBar.tsx` (badge honnête + cliquable)
- Modify: `apps/desktop/src/stores/uiStore.ts` SEULEMENT si l'audit modal révèle un leak (voir Step 3)
- Test: aucun nouveau (pas d'infra DOM) — vérification tsc/build + revue ; le mapping pur de keybindings est déjà couvert par l'usage

**Interfaces:**
- Produces: `purrqlTheme(isDark)` même signature ; keybindings gagne une entrée optionnelle `onCommandPalette?: () => void` dans `buildEditorKeymap` (T3 n'en dépend pas).

- [ ] **Step 1: Réécrire la palette de `purrqlTheme`**

Remplacer les sept locals + trois hardcodés par (exactement ces valeurs, ajustables par la revue si un contraste est insuffisant) :

```ts
const bg = 'var(--background)';
const fg = 'var(--foreground)';
const mutedFg = 'var(--muted-foreground)';
const primary = 'var(--primary)';
const border = 'var(--border)';
const selection = 'color-mix(in oklab, var(--primary) 24%, transparent)';
const activeLine = 'color-mix(in oklab, var(--foreground) 5%, transparent)';
const matchBg = 'color-mix(in oklab, var(--primary) 14%, transparent)';
const stringColor = isDark ? 'oklch(0.76 0.11 145)' : 'oklch(0.45 0.11 145)';
const numberColor = isDark ? 'oklch(0.78 0.10 80)'  : 'oklch(0.52 0.12 65)';
const keywordColor = primary;
```

Règles du `EditorView.theme` (garder la structure actuelle, corriger/ajouter) :
- `&`: `{ backgroundColor: bg, color: fg, height: '100%' }` et `&.cm-focused { outline: 'none' }` — le focus ring bleu natif est une cause probable des « lignes bleues » du screenshot.
- `.cm-content`: `caretColor: primary`, `padding: '8px 0'`.
- `.cm-line`: `padding: '0 12px'`.
- `.cm-cursor, .cm-dropCursor`: `borderLeftColor: primary, borderLeftWidth: '2px'`.
- Sélection (focused + non) : `selection`.
- `.cm-activeLine` et `.cm-activeLineGutter`: `activeLine` (JAMAIS `--accent`).
- `.cm-gutters`: `{ backgroundColor: 'transparent', color: mutedFg, border: 'none', paddingLeft: '4px' }` — la bordure droite actuelle + fond opaque datent du look VS Code ; le fond transparent fond la gouttière dans l'éditeur.
- `.cm-selectionMatch`, `.cm-searchMatch`: `matchBg` ; `.cm-searchMatch-selected`: `selection`.
- `&.cm-focused .cm-matchingBracket`: `{ backgroundColor: matchBg, outline: '1px solid ' + border }`.
- `.cm-tooltip`, `.cm-panels`: fond `var(--popover, var(--background))`, bordure `border`, `borderRadius: 'calc(var(--radius) - 8px)'`.
- `.cm-tooltip-autocomplete > ul > li[aria-selected]`: fond `selection`, couleur `fg`.
- `.cm-placeholder`: `mutedFg`.

`HighlightStyle` : keyword → `keywordColor` + bold ; string → `stringColor` ; number → `numberColor` ; comment → `mutedFg` + italic ; operator → `fg` ; typeName/function → `keywordColor` sans bold ; `propertyName` → `fg`. Vérifier dans setup.ts quels tags sont réellement mappés par le langage SQL et couvrir `tags.function(tags.variableName)` si présent.

- [ ] **Step 2: ⌘K inarrêtable**

1. `keybindings.ts` : ajouter à `buildEditorKeymap` un binding `Mod-k` en `Prec.highest` appelant `useUIStore.getState().setCommandPaletteOpen(true)` et retournant `true` (import direct du store, comme les autres fichiers font ; ou paramètre callback si le fichier est aujourd'hui pur — regarder et suivre la convention du fichier). Sans lui, un focus dans l'éditeur laisse marcher le handler window (pas de binding CM sur Mod-k) MAIS le rend dépendant de la propagation — le binding explicite garantit le comportement et documente l'intention.
2. Audit du verrou modal : `grep -n "pushModal\|popModal" apps/desktop/src -r` — vérifier que CHAQUE pushModal a son popModal dans le cleanup du même effet, y compris les dialogs lazy (CsvImportDialog, ImportDialog, ExportDialog, DataGeneratorDialog, ShareDialog, ConnectionDialog, NotesPanel, PreferencesDialog, SnippetPalette, OpenAnything). Un id qui reste dans la pile après fermeture tue TOUS les raccourcis (`when: !isModalOpen()`) — c'est l'explication la plus probable du « ⌘K ne fait rien » de l'utilisateur. Corriger tout déséquilibre trouvé et le nommer dans le rapport. Ajouter en défense : dans `useKeyboardShortcut` RIEN ; dans `uiStore`, si le même id est push deux fois, dédupliquer (Set-like) pour rendre le leak inoffensif — seulement si un leak a été trouvé.
3. `StatusBar.tsx:182` : remplacer le `<kbd>Ctrl+K</kbd>` codé en dur par le binding réel formaté (le shortcutStore expose la définition ; utiliser le même helper d'affichage que ShortcutsSection — `formatBinding` ou équivalent, afficher ⌘K sur macOS) et rendre le badge cliquable (`onClick={() => setCommandPaletteOpen(true)}`).

- [ ] **Step 3: Polish minimal de la vue requête** (dans le périmètre « refonte », sans toucher à la structure)

- `SqlEditor`/CodemirrorEditor : ajouter un `placeholder` CM6 (« Écrire une requête… ⌘↵ pour exécuter ») via l'extension `placeholder()` de @codemirror/view.
- L'état vide des résultats (« Run a query to see results », PanelLayout.tsx:533-537) : remplacer par un empty-state centré avec l'icône Play, le raccourci ⌘↵ dans un `<kbd>`, et une ligne « ⌘K — palette de commandes ». Classes tokens uniquement.
- Le handle de split vertical (PanelLayout SplitEditorResults `h-1 bg-border`) : passer à `h-[3px] bg-transparent hover:bg-primary/40 active:bg-primary/60` avec une zone de hit de 7px (`before:` ou padding) — l'actuel est un trait dur.

- [ ] **Step 4: Vérification, commit, push**

Trio frontend. Self-check avant commit : grep `#264f78|#add6ff|#ce9178|#a31515|#b5cea8|#098658` dans theme.ts → zéro ; les deux modes lisibles (raisonner sur les L oklch : light bg L≈0.98 / dark bg L≈0.27).

```bash
git add apps/desktop/src/components/editor/ apps/desktop/src/components/layout/StatusBar.tsx apps/desktop/src/components/layout/PanelLayout.tsx apps/desktop/src/stores/uiStore.ts
git commit -m "fix: rebuild the editor theme on app tokens and make the command palette shortcut reliable"
git push origin master
```

---

### Task 2: Persistance Rust des requêtes sauvegardées

Le config store (purrql-config, SQLite `purrql.db`) n'a aucune notion de requête sauvegardée. Ajouter la table, les méthodes, les commandes Tauri et les bindings TS. Le schéma migrations est un unique `execute_batch` idempotent (`CREATE TABLE IF NOT EXISTS`, migrations.rs:12-40) — y ajouter la table suffit.

**Files:**
- Modify: `crates/purrql-config/src/migrations.rs` (+ table + index)
- Modify: `crates/purrql-config/src/store.rs` (+ 4 méthodes + tests)
- Modify: `apps/desktop/src-tauri/src/commands/query.rs` ou nouveau `commands/saved_queries.rs` (+ 4 commandes ; suivre la convention du dossier), `apps/desktop/src-tauri/src/lib.rs` (registre)
- Modify: `apps/desktop/src/lib/ipc.ts`, `apps/desktop/src/lib/types.ts`
- Test: `mod tests` dans store.rs (le fichier en a déjà — suivre le pattern)

**Interfaces (T3 consomme ces noms exacts):**

SQL :
```sql
CREATE TABLE IF NOT EXISTS saved_queries (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    database TEXT,
    name TEXT NOT NULL,
    description TEXT,
    sql TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_queries_conn
ON saved_queries(connection_id, database, name);
```

Rust (store.rs, même style spawn_blocking + Arc<Mutex<Connection>> que l'existant) :
```rust
pub struct SavedQuery { pub id: Uuid, pub connection_id: Uuid, pub database: Option<String>,
    pub name: String, pub description: Option<String>, pub sql: String,
    pub created_at: String, pub updated_at: String }   // Serialize + Deserialize + Clone
pub async fn upsert_saved_query(&self, q: SavedQuery) -> Result<()>          // INSERT OR REPLACE ; updated_at côté appelant
pub async fn list_saved_queries(&self, connection_id: &Uuid) -> Result<Vec<SavedQuery>>  // ORDER BY database NULLS FIRST, name
pub async fn delete_saved_query(&self, id: &Uuid) -> Result<()>
```
(Le rename passe par upsert. Le filtre par base se fait côté frontend — une connexion a rarement > quelques centaines de requêtes.)

Commandes Tauri : `save_saved_query(state, query: SavedQuery)`, `list_saved_queries(state, connection_id: Uuid)`, `delete_saved_query(state, id: Uuid)` — mêmes conventions IpcError que `list_saved_connections` (connection.rs:99-133).

TS (types.ts) :
```ts
export interface SavedQuery {
  id: string; connection_id: string; database: string | null;
  name: string; description: string | null; sql: string;
  created_at: string; updated_at: string;
}
```
ipc.ts : `saveSavedQuery(query: SavedQuery)`, `listSavedQueries(connectionId)` (dédupé `savedQueries:${connectionId}`), `deleteSavedQuery(id)`.

- [ ] **Step 1: TDD store** — tests d'abord dans store.rs (pattern existant, base temporaire) : upsert puis list (tri database/name, NULL database en premier) ; upsert même id = update (updated_at change, count stable) ; delete ; list d'une connexion sans requêtes = vide ; les requêtes d'une autre connexion n'apparaissent pas. Rouge (méthodes absentes) → implémenter → vert.
- [ ] **Step 2: Migration + commandes + registre + bindings TS.** La suppression d'une connexion sauvegardée doit nettoyer ses requêtes : ajouter le DELETE dans `delete_connection` (store.rs:133+, où les passwords sont déjà nettoyés — vérifier et faire pareil) + un test.
- [ ] **Step 3: Vérification (les cinq commandes), commit, push**

```bash
git add crates/purrql-config/ apps/desktop/src-tauri/ apps/desktop/src/lib/ipc.ts apps/desktop/src/lib/types.ts
git commit -m "feat: persist named saved queries per connection and database"
git push origin master
```

---

### Task 3: Fonctionnalité frontend — sauvegarder, retrouver, ouvrir

Le flux complet : bouton « Save query » dans la toolbar → dialogue de nommage (nom, description, base pré-remplie depuis l'onglet) → toast. Retrouver : groupe « Saved queries » dans la palette ⌘K (groupé par base, recherchable) → ouvre un onglet avec le SQL, le titre = nom, la base de l'onglet = celle de la requête. Gérer : renommer/supprimer depuis un dialogue de gestion. L'onglet garde le lien (`savedQueryId`) : re-sauvegarder propose « Mettre à jour "<nom>" » ou « Sauvegarder comme nouvelle ».

**Files:**
- Create: `apps/desktop/src/stores/savedQueryStore.ts`
- Create: `apps/desktop/src/components/editor/SaveQueryDialog.tsx` (modèle : snippets/SnippetEditor.tsx — Dialog shadcn, Label+Input, footer Cancel/Save, reset on close, pushModal/popModal)
- Create: `apps/desktop/src/components/editor/SavedQueriesDialog.tsx` (liste gérable : recherche, groupes par base, renommer inline ou via SaveQueryDialog, supprimer avec confirm)
- Modify: `apps/desktop/src/components/editor/EditorToolbar.tsx` (+ bouton Save query — icône Bookmark/BookmarkPlus, entre « Save SQL file » et le divider AI ; ouvre SaveQueryDialog ; si `tab.savedQueryId`, le clic met à jour directement + toast, et un chevron/dropdown offre « Save as new »)
- Modify: `apps/desktop/src/components/layout/CommandPalette.tsx` (+ groupe « Saved queries » : items = nom + badge base ; sélection → `openSavedQuery` ; + action « Manage saved queries… » ouvrant SavedQueriesDialog ; + l'action « New Query Tab » reste)
- Modify: `apps/desktop/src/components/editor/EditorTabs.tsx` (le stub « New from Template » (:156-164, console.log) devient « From saved query… » → ouvre SavedQueriesDialog en mode pick)
- Modify: `apps/desktop/src/stores/queryStore.ts` (`QueryTab.savedQueryId?: string` + `openSavedQuery(q: SavedQuery)` qui crée l'onglet avec sql/titre/database/savedQueryId ; `updateSql` NE casse PAS le lien — le lien signifie « issu de », l'update est explicite)
- Modify: `apps/desktop/src/lib/sessionRecovery.ts` (persister `savedQueryId` dans SavedTab — champ optionnel, migration transparente)
- Test: `apps/desktop/src/stores/__tests__/savedQueryStore.test.ts` (store pur : load/refresh par connexion, groupement par base (NULL = « Toutes les bases » en premier), upsert local optimiste, delete local ; mock ipc par injection comme les tests de store existants — lire connectionStore.connect.test.ts pour le pattern de mock)

**Interfaces:**
- Consumes: T2's `SavedQuery`, `ipc.saveSavedQuery/listSavedQueries/deleteSavedQuery` ; SnippetEditor comme modèle de dialogue ; `showSuccessToast/showErrorToast`.
- Produces:
  ```ts
  // savedQueryStore.ts
  interface SavedQueryState {
    byConnection: Record<string, SavedQuery[]>;
    load(connectionId: string): Promise<void>;                    // ipc.listSavedQueries, remplace la tranche
    save(q: Omit<SavedQuery,'created_at'|'updated_at'> & {created_at?: string}): Promise<SavedQuery>; // stampe les dates, upsert local + ipc
    remove(id: string, connectionId: string): Promise<void>;
  }
  export const groupByDatabase: (queries: SavedQuery[]) => Array<{ database: string | null; queries: SavedQuery[] }>;
  ```
  `useQueryStore.openSavedQuery(q)` — crée/active l'onglet.

- [ ] **Step 1: TDD savedQueryStore** — tests d'abord (groupByDatabase pur : tri, NULL premier ; save stampe updated_at et remplace l'entrée locale ; remove retire ; load remplace la tranche sans toucher les autres connexions). Rouge → implémenter → vert.
- [ ] **Step 2: Dialogues + toolbar.** SaveQueryDialog : champs Nom (requis), Description, Base (Select alimenté par schemaStore.databases + option « Toutes les bases » = NULL, pré-sélection = `tab.database ?? null`) ; en mode update, pré-rempli. SavedQueriesDialog : `Command` de cmdk OU liste simple ScrollArea groupée — choisir le plus simple cohérent avec l'existant ; chaque ligne : nom, base badge, aperçu SQL tronqué, actions Ouvrir/Renommer/Supprimer (confirm inline, pas de nouveau dialog). Les DEUX dialogues push/popModal.
- [ ] **Step 3: Palette + tabs + queryStore + session.** Le groupe palette n'apparaît que si la connexion active a des requêtes ; `load(connectionId)` est déclenché à l'ouverture de la palette et au connect (chercher où `loadSavedConnections`-équivalent se fait au connect — connectionStore.connect — et suivre). Ouvrir une requête déjà ouverte dans un onglet (même savedQueryId) ACTIVE l'onglet existant au lieu d'en créer un deuxième.
- [ ] **Step 4: Vérification (trio frontend), commit, push**

```bash
git add apps/desktop/src/stores/ apps/desktop/src/components/editor/ apps/desktop/src/components/layout/CommandPalette.tsx apps/desktop/src/lib/sessionRecovery.ts
git commit -m "feat: saved queries — name, browse per database, open from the command palette"
git push origin master
```

---

## Explicitly out of scope

- Variables/placeholders dans les requêtes sauvegardées (les snippets couvrent ça) ; migration des snippets localStorage vers SQLite ; partage/export des requêtes sauvegardées ; dossier/tags ; QueryHistory UI (composant mort, chantier séparé) ; refonte structurelle de PanelLayout.

## Self-review notes

- T1 seul est mergeable (fix visuel + ⌘K) ; T2 sans T3 est invisible mais inerte ; T3 dépend strictement de T2.
- Cohérence de types : `SavedQuery` (T2 Rust/TS) consommé par T3 ; `openSavedQuery` défini T3 ; `buildEditorKeymap` étendu T1 sans impact T3.
- Lignes citées à jour du scouting (HEAD e45e0e8) ; grep avant édition.
