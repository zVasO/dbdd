# Plan de remédiation — Audit VasOdb

> **Contexte de test :** le repo a ~0 couverture (2 fichiers vitest, 0 test Rust, pas de script `test`).
> Les correctifs de **fonctions pures** (splitter SQL, safety-limit, type mapping, contraste) DOIVENT recevoir un test unitaire (vitest / `#[test]` cargo) — ce sont de bons candidats TDD.
> Les correctifs touchant **DB / TLS / keyring** n'ont pas de harnais d'intégration ici : la vérification est **manuelle** contre une vraie base, et le plan le dit explicitement plutôt que d'inventer une commande de test.

**Objectif :** corriger les 31 findings de l'audit (1 CRITICAL, ~12 HIGH, ~18 MEDIUM/LOW) sans casser l'archi existante (colonnaire, pooling, streaming).

**Séquencement (raison) :** on va du plus fréquent/dommageable au plus cosmétique.
Note « perso » : l'app n'est pas distribuée pour l'instant → le batch **Sécurité au repos** (menaces : disque local, MITM réseau) est réel mais **moins urgent** que la corruption de données et les crashs. Il est donc placé après correctness/perf. À remonter en tête le jour où l'app est distribuée.

**Commits :** un commit par finding (ou par petit groupe cohérent), message `fix:`/`perf:`/`a11y:` + le fichier concerné.

---

## ⚠️ Décisions à trancher AVANT le batch concerné (ne pas coder sans ton choix)

| # | Décision | Options | Reco (à challenger) |
|---|----------|---------|---------------------|
| D1 | **Stockage de la clé maître** (`crypto.rs`) | (a) keyring OS uniquement, supprimer le backup fichier plaintext ; (b) fallback fichier mais clé chiffrée par une passphrase utilisateur dérivée (Argon2) | **(a)** — le backup plaintext annule le keyring ; le fallback passphrase est plus sûr mais ajoute une UX de déverrouillage. En perso, (a) suffit. |
| D2 | **TLS MySQL** | (a) feature `rustls-tls` de `mysql_async` ; (b) `native-tls` | **(a) rustls** — pas de dépendance OpenSSL système, build reproductible. + refuser la connexion si `Require/Verify*` et TLS KO (pas de fallback clair). |
| D3 | **Masquage de données** | (a) supprimer le code mort ; (b) le brancher (grille) sans toucher export ; (c) le brancher + gate copy/export | **(a) pour l'instant** — c'est du code mort qui donne une fausse sécurité. Le rebrancher proprement (c) est un vrai chantier produit, à planifier à part. |
| D4 | **Clés API IA** | (a) chiffrer via la même infra Rust (stronghold/keyring) ; (b) laisser en localStorage mais chiffré ; (c) statu quo | **(a)** — cohérent avec les mots de passe DB déjà protégés côté Rust. |
| D5 | **Splitter SQL** | (a) tokenizer maison dans `sql-utils.ts` ; (b) réutiliser une lib | **(a)** — dépendance `sql-formatter` déjà présente mais n'expose pas de split fiable ; un tokenizer conscient quotes/commentaires/dollar-quote est ~80 lignes testables. |

---

## Batch 0 — Quick wins (erreurs illisibles + garde-fou destructif)
*Effort : ~1 h. Impact utilisateur immédiat, aucun risque.*

### Task 0.1 — Erreurs de connexion lisibles + retry mot de passe réparé
**Files:** Modify `apps/desktop/src/components/connection/ConnectionCard.tsx:27`
- Remplacer `const msg = String(e)` par `const msg = extractErrorMessage(e)` (déjà exporté par `lib/ipc.ts:14`).
- Vérifier que les tests `msg.includes('denied'|'password'|'auth')` (l.30-36) reçoivent désormais le vrai message → `showPassword` s'affiche.
- **Vérif (manuelle) :** connexion avec mauvais mot de passe → message lisible + champ mot de passe de retry visible.

### Task 0.2 — Erreur de commit lisible
**Files:** Modify `apps/desktop/src/components/editor/EditorToolbar.tsx:57`
- `showErrorToast(\`Commit failed: ${extractErrorMessage(err)}\`)`.
- **Vérif (manuelle) :** commit violant une contrainte FK/NOT NULL → le toast nomme la contrainte.

### Task 0.3 — Confirmation de suppression de connexion
**Files:** Modify `apps/desktop/src/components/connection/ConnectionCard.tsx:96-103`
- Router le bouton Delete vers `ConfirmDestructiveDialog` (déjà existant) au lieu d'appeler `deleteConnection` directement.
- **Décision mineure :** type-to-confirm (comme DROP) vs simple oui/non. Reco : simple oui/non — supprimer une connexion est recréable, moins grave qu'un DROP.
- **Vérif (manuelle) :** clic Delete → dialog, annulable.

**Commit :** `fix: surface real error messages and confirm connection deletion`

---

## Batch 1 — Correctness (données & crashs) — PRIORITÉ HAUTE
*Data integrity et panics. C'est le cœur d'un client DB.*

### Task 1.1 — Splitter SQL conscient du contexte  *(dépend de D5)*
**Files:** Create `apps/desktop/src/lib/sql-utils.ts` (fonction `splitStatements`), Modify `stores/queryStore.ts:254`, Test `lib/__tests__/sql-utils.test.ts`
- Implémenter un tokenizer qui ignore `;` dans : chaînes `'…'`/`"…"`, backticks, commentaires `--` et `/* */`, dollar-quote Postgres `$tag$…$tag$`.
- Remplacer `tab.sql.split(/;\s*/)` par `splitStatements(tab.sql)`.
- **TDD (vitest) :** cas `'a;b'` littéral, `-- note; suite`, `DO $$ ... ; ... $$`, requête simple, requête vide. C'est une fonction pure → écrire les tests d'abord.
- **Vérif :** `npx vitest run src/lib/__tests__/sql-utils.test.ts`

### Task 1.2 — NUMERIC/DECIMAL Postgres non perdus  *(perte de données)*
**Files:** Modify `crates/purrql-postgres/Cargo.toml` (feature sqlx `bigdecimal` ou `rust_decimal`), `crates/purrql-postgres/src/connection.rs:98-162`
- Ajouter le décodage `NUMERIC` via le type dédié.
- **Critique :** ne plus mapper `Err(_) => CellValue::Null` en aveugle — logger (`tracing::warn`) le type non décodé et renvoyer un `Text` de repli, pas `Null`.
- **Vérif (manuelle, vraie DB PG) :** `SELECT 1234.56::numeric` → valeur affichée, pas vide.

### Task 1.3 — Panic UTF-8 dans le safety-limit  *(crash)*
**Files:** Modify `apps/desktop/src-tauri/src/commands/query.rs:60`, Test inline `#[cfg(test)]`
- Remplacer `&trimmed[start..]` par `trimmed.get(start..).unwrap_or(trimmed)` (ou aligner via `char_indices`).
- **TDD (cargo) :** `#[test]` avec une requête > 200 octets contenant des accents à la frontière → ne panique plus. Fonction pure, testable sans DB.
- **Vérif :** `cargo test -p <crate du binaire>` (créer le premier test Rust du projet).

### Task 1.4 — Panic sur nonce corrompu
**Files:** Modify `crates/purrql-config/src/crypto.rs:144`
- `Nonce::from_slice` → vérifier `len()==12` et renvoyer `PurrqlError::Config` sinon (`try_from`).
- **Vérif (manuelle) :** altérer une ligne `encrypted_passwords.nonce` → erreur propre au lieu de crash.

### Task 1.5 — Type mapping MySQL
**Files:** Modify `crates/purrql-mysql/src/type_mapping.rs:144`, `crates/purrql-mysql/src/connection.rs:87`
- `BIGINT UNSIGNED > i64::MAX` : sérialiser en `Text(n.to_string())` au lieu de `as i64`.
- SELECT simple en protocole texte : parser les `Value::Bytes` selon `col.column_type()` (ou basculer sur protocole préparé). Corrige aussi `list_databases` (taille toujours `None`).
- **TDD (cargo) :** tests purs sur `mysql_value_to_cell` pour `UInt(u64::MAX)`, `Bytes` d'un int. **Vérif intégration :** manuelle contre MySQL.

### Task 1.6 — Ne plus avaler les erreurs de catalogue (schéma faux silencieux)
**Files:** Modify `crates/purrql-postgres/src/schema_inspector.rs:282,363,457`, `crates/purrql-mysql/src/schema_inspector.rs:213,256,309`
- Remplacer `.unwrap_or_else(|_| QueryResult{rows:vec![],..})` par un `.unwrap_or_else(|e| { tracing::warn!(...); ... })` **et** remonter un flag « partiel » dans `TableStructure` (index/FK/contraintes peuvent manquer).
- **Décision mineure :** propager jusqu'à l'UI (badge « schéma partiel ») ou seulement logger. Reco : au moins logger maintenant, badge UI en suivant.

**Commits :** un par task (`fix: sql-aware statement splitting`, `fix: preserve postgres numeric values`, etc.)

---

## Batch 2 — Performance
*Le CRITICAL annule toute l'archi colonnaire — à traiter tôt.*

### Task 2.1 — Ne plus matérialiser tout le résultat en lignes  *(CRITICAL)*
**Files:** Modify `apps/desktop/src/components/layout/PanelLayout.tsx:477`, `stores/resultStore.ts` (`getAllResults`), `components/import-export/ExportDialog.tsx:101`
- `DataGrid` ne lit `result.rows` qu'en `.length` (DataGrid.tsx:328) : lui passer `{ columns, rowCount }` seulement.
- Réserver `getAllResults`/`columnarToRows` aux vrais consommateurs format-ligne (export effectif, diff), idéalement par tranche.
- `ExportDialog` preview : ne matérialiser que les 5 lignes de l'aperçu, pas tout.
- **Vérif (manuelle) :** `SELECT` ~1M lignes → plus de gel à l'affichage ; mémoire ≈ colonnaire seul.
- **Suivi :** faire compter ce cache par `memory-manager.ts:6` (`estimateTabMemory`) — voir Task 2.4.

### Task 2.2 — Merge de stream sans O(n²)
**Files:** Modify `apps/desktop/src/stores/resultStore.ts:196` (`mergeColumnArrays`), `appendChunk:533`
- Conserver les chunks en liste de segments, n'aplatir qu'à `finishStream` (ou `push` dans les tableaux colonnaires existants au lieu de réallouer).
- **Vérif (manuelle) :** stream 1M lignes → plus de micro-freezes croissants pendant la réception.

### Task 2.3 — Ne plus cloner tout le dataset vers le worker à chaque frappe
**Files:** Modify `apps/desktop/src/components/grid/DataGrid.tsx:151,160-166`
- Transférer les colonnes en `ArrayBuffer`/`TypedArray` transférables (zéro-copie) **ou** garder une copie persistante côté worker et n'envoyer que le delta / le `filterText`.
- Ne pas reposter quand `filterText` est vide sur simple changement de `data`.
- **Vérif (manuelle) :** filtre sur 500k lignes → plus de pause de sérialisation par frappe.

### Task 2.4 — Comptabiliser le cache de lignes dans le cap mémoire
**Files:** Modify `apps/desktop/src/lib/memory-manager.ts:6`
- Inclure `_allResultsCache` dans `estimateTabMemory` (dépend de 2.1 : si le cache disparaît, ce task devient sans objet — réévaluer après 2.1).

### Task 2.5 — Widgets dashboard bornés
**Files:** Modify `apps/desktop/src/components/dashboard/charts/DataTableWidget.tsx:45` + les 5 widgets recharts (`Line/Scatter/Bar/Area/Pie`)
- Cap/agrégation avec avertissement ; virtualiser `DataTableWidget`.

### Task 2.6 — `get_table_structure` en parallèle
**Files:** Modify `crates/purrql-mysql/src/schema_inspector.rs` + `crates/purrql-postgres/src/schema_inspector.rs`
- `tokio::try_join!` sur les 5 requêtes indépendantes (colonnes/index/FK/contraintes/commentaire).
- **Vérif (manuelle, DB distante) :** ouverture de structure ~5× plus rapide.

### Task 2.7 — Index fuzzy en delta
**Files:** Modify `apps/desktop/src/stores/schemaStore.ts:121-145`
- Envoyer au worker la seule nouvelle structure au lieu de tout reconstruire.

### Task 2.8 (LOW) — Mémoïser le tableau identité
**Files:** Modify `apps/desktop/src/components/grid/DataGrid.tsx:410-429` — mémoïser sur `rowCount` seul.

---

## Batch 3 — Bugs frontend (races & état)

### Task 3.1 — Timers de requêtes planifiées : lire l'état frais
**Files:** Modify `apps/desktop/src/stores/alertStore.ts:95-192` (`executeAndCheck(id)` au lieu de l'objet figé) + `updateScheduledQuery:214` (réarmer le timer si `sql`/`intervalMs`/`enabled` changent)
- **Vérif (manuelle) :** alerte ne spamme plus après cooldown ; `result_changed` se déclenche ; édition prise en compte.

### Task 3.2 — Garde de génération sur `loadTableStructure`
**Files:** Modify `apps/desktop/src/stores/schemaStore.ts:76-99`
- Appliquer le pattern `_loadGeneration` déjà présent dans `loadTables` (l.56-74).
- **Vérif (manuelle) :** cliquer table lente puis table rapide → structure affichée = dernière cliquée.

### Task 3.3 — `executeQuery` non ré-entrante
**Files:** Modify `apps/desktop/src/stores/queryStore.ts:241`, `components/layout/PanelLayout.tsx:344`
- Si `tab.isExecuting`, annuler (`cancelQuery` + `cleanup`) le stream courant avant d'en relancer un, ou refuser. Le raccourci Cmd+Enter doit respecter `isExecuting`.
- **Vérif (manuelle) :** marteler Cmd+Enter pendant un gros stream → pas de lignes entrelacées.

### Task 3.4 — BLOB/Array non « [object Object] » en batch
**Files:** Modify `apps/desktop/src/stores/resultStore.ts:117-123` (`queryResultToColumnar`)
- Sérialiser `Bytes` via `.preview` et `Array` explicitement au lieu de `String(cell.value)`.
- **TDD (vitest) :** fonction pure → test direct.

### Task 3.5 — Avertir avant perte de modifications non commitées
**Files:** Modify `apps/desktop/src/App.tsx` (handler close Tauri), `lib/sessionRecovery.ts:20-31`
- Sur fermeture, si `changeStore.pending > 0`, avertir ; flush de session au close (au lieu du debounce 1 s seul).
- **Décision mineure :** persister `pending` dans la session (récupérable) ou juste avertir. Reco : avertir maintenant, persister en suivant.

### Task 3.6 — Annulation des requêtes single-shot/batch
**Files:** Modify `apps/desktop/src/stores/queryStore.ts:258-295`
- Générer un `queryId` aussi sur ces chemins pour que le bouton Stop (`EditorToolbar.tsx:125`) s'affiche.

### Task 3.7 — Statut de connexion dégradé après coupure
**Files:** Modify `apps/desktop/src/App.tsx:113-127`
- Sur échec de ping, marquer la connexion déconnectée/dégradée au lieu de « silently ignore ».

---

## Batch 4 — Sécurité au repos *(dépend de D1–D4 ; moins urgent en usage perso)*

### Task 4.1 — Clé maître  *(D1)* — `crates/purrql-config/src/crypto.rs:27-32,92-107`
Selon D1(a) : supprimer `store_key_to_file`/le backup plaintext quand le keyring fonctionne ; corriger le commentaire mensonger « encrypted file ».

### Task 4.2 — TLS MySQL  *(D2)* — `crates/purrql-mysql/Cargo.toml`, `connection.rs:24-34`
Activer la feature TLS, construire `SslOpts` depuis `config.ssl_mode`, refuser si `Require/Verify*` et TLS indisponible.

### Task 4.3 — Clés API IA  *(D4)* — `stores/aiStore.ts:24,51-53` + nouvelle commande Tauri
Selon D4(a) : stocker via l'infra Rust, ne pas renvoyer la clé en clair au front.

### Task 4.4 — Masquage  *(D3)* — `lib/dataMasking.ts`, `masking/*`
Selon D3(a) : retirer le code mort (ou brancher, selon ton choix).

### Task 4.5 (LOW) — SQL hors des logs — `commands/query.rs:75,170,345`
Ajouter `sql` (et `connection_id`) au `skip(...)` de `#[instrument]`.

### Task 4.6 (LOW) — Mot de passe orphelin à la suppression — `commands/connection.rs:109-119`
Supprimer aussi la ligne `encrypted_passwords` + l'entrée keyring.

### Task 4.7 (LOW) — Échapper le markdown des notes — `notes/NoteEditor.tsx:51-81`
Échapper le HTML avant regex, ou rendre en nœuds React.

### Task 4.8 (LOW) — Valider les valeurs de thème — `lib/themeTypes.ts:142-217`
Whitelist de formats couleur, refus de `url(`/`;` avant `setProperty`.

### Task 4.9 (LOW) — Défaut `ssl_mode` — `crates/purrql-core/src/models/connection.rs:68`
`SslMode::default()` → `Prefer` au lieu de `Disable`.

---

## Batch 5 — Accessibilité & UI

### Task 5.1 (HIGH) — Noms accessibles sur boutons-icônes
**Files:** `settings/SettingsPage.tsx:104`, `editor/EditorTabs.tsx:112,127,137`, `grid/FilterBar.tsx:194`, `query-builder/FilterPanel.tsx:150,413`, `dashboard/DashboardManager.tsx:114,121,146,158,194,202`
- Ajouter `aria-label` explicite sur chacun.

### Task 5.2 (HIGH) — Toggle table ER au clavier — `er-diagram/TableNode.tsx:77-96`
`<div onClick>` → `<button>` + `aria-expanded`.

### Task 5.3 (HIGH) — Toggle mot de passe IA — `ai/AiProviderConfig.tsx:76-85`
Retirer `tabIndex={-1}`, ajouter `aria-label` + `aria-pressed`.

### Task 5.4 (MED) — Contraste des thèmes livrés + garde-fou éditeur
**Files:** `lib/builtInThemes.ts` (assombrir `primary`/`accent` en dark : Nord/Solarized/Dracula/Monokai < 3:1), `settings/ThemeEditor.tsx` (afficher le ratio WCAG par paire fg/bg)
- **TDD (vitest) possible :** extraire le calcul de contraste en fonction pure testée, puis l'utiliser dans l'éditeur.

### Task 5.5 (MED) — Menu contextuel de grille au clavier — `grid/DataGrid.tsx:1801`
Réutiliser le `ContextMenu` radix de `ui/` (rôles + navigation flèches + Shift+F10).

### Task 5.6 (MED) — Focus visible sur les champs de recherche
**Files:** `snippets/SnippetPalette.tsx:206`, `layout/Sidebar.tsx:360`, `layout/CommandPalette.tsx:129`, `layout/OpenAnything.tsx:79`
- Ajouter `focus-visible:ring-1 focus-visible:ring-ring`.

### Task 5.7 (MED) — Tokens de couleur sémantiques  *(gros, ~38 fichiers)*
Introduire `--success`/`--warning`/`--info` mappés par thème, remplacer les 198 `text-blue-500`/`bg-green-500/10` en dur. À faire par lots de fichiers.

### Task 5.8 (LOW) — Plancher typographique
Remonter les `text-[8px]`/`text-[9px]` à `text-xs` (12px) min ; remplacer les px inline (`DataGrid.tsx:1342`) par un token.

---

## Auto-revue du plan
- **Couverture :** 31 findings de l'audit → tous mappés (Batch 0 : 3 ; Batch 1 : 6 ; Batch 2 : 8 ; Batch 3 : 7 ; Batch 4 : 9 ; Batch 5 : 8). Certains findings groupés (erreurs `String(e)` = Task 0.1/0.2 ; `try_join!` schema = perf + backend fusionnés en 2.6).
- **Décisions ouvertes :** D1–D5 bloquent Batch 4 et Task 1.1 — à trancher avant de coder ces parties.
- **Réalisme test :** TDD réel sur fonctions pures (1.1, 1.3, 1.5 partiel, 3.4, 5.4) ; vérif manuelle honnêtement notée ailleurs (pas de harnais DB/keyring).
