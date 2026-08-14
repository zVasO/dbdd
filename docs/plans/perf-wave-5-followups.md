# Suivi post-vague perf 5 — backend & chemins lourds (2026-08-14)

Vague livrée sur `master` (`e27fdb7..7840fcf`, 15 commits), revue finale : **prêt à merger après la vague de correctifs** (`7840fcf` : repli protocole texte sur ER 1295, `USE` supprimé du chemin B avec qualification par dialecte, événement d'annulation gaté sur la vivacité). Suites à HEAD : cargo 15 suites vertes, vitest 214/214, tsc propre, build OK.

## Tickets recommandés (par ordre d'intérêt)

1. **Corrélation des progressions de batch/import** : le frontend passe un `batch_id: Option<Uuid>` à `execute_batch_summary`/`import_csv_execute` (miroir de `query_id`), `attachQueryId` avant l'invoke → la plomberie QueryProgress de la tâche 9 s'allume pour les imports (~5 lignes de Rust). Aujourd'hui les événements de progression des batchs ne trouvent aucune entrée (no-op propre).
2. **Export/copie Markdown multilignes** : les cellules contenant `\n` cassent les lignes de tableau (contrat copyFormats hérité, l'ancien worker remplaçait par un espace) ; NULL→blanc en md/csv export également. Une ligne dans `formatMarkdown` mais change aussi copy-as-markdown — décision produit.
3. **`create` d'export : types MySQL pour tous les dialectes** (`DOUBLE` invalide en Postgres). Préexistant ; maintenant que les identifiants se quotent correctement par dialecte, c'est le dernier bloqueur d'un create-and-import Postgres fonctionnel.
4. **Unification du chemin B d'import sur `import_csv_execute`** (déjà parké) : rendrait le double parseur (papaparse navigateur vs csv Rust) et l'`escapeSQL` TS (n'échappe pas les backslashes, contrairement au `sql_literal` Rust) obsolètes.
5. **Toast « copie échouée »** partagé dans le rejet de `copyFormatted` : ferme d'un coup l'observabilité des échecs presse-papiers/worker (promesses flottantes côté grille).
6. **Test driver 1295 sur serveur vif** quand une infra DB de test existera (le classificateur est testé ; le chemin live ne peut pas l'être ici).

## Différés arbitrés « restent différés » par la revue finale (extraits saillants)

- `QueryProgress.rows_fetched` porte des comptes de *statements* pour les batchs mais l'UI dira « rows » quand la corrélation arrivera (à corriger avec le ticket 1).
- Fallback presse-papiers sans `ClipboardItem` : formate inline en synchrone (freeze sur ≥10k cellules dans cet environnement étroit, divulgué) ; suppose `navigator.clipboard` présent.
- `first_line` du sniff d'en-têtes CSV peut tronquer un en-tête quoté multiligne (dégénéré ; toujours mieux que l'ancien sniff fichier-entier).
- Postgres : NUL intérieur tronque un statement (jamais d'append) ; `NO_BACKSLASH_ESCAPES` MySQL corromprait les backslashes doublés (réglage serveur non-défaut, commenté dans le code).
- Divergence `affected_rows` sur SELECT (PG = row count, MySQL = 0) — aucun consommateur ne l'affiche.
- Doc `StatementOutcome` : « exactly one field set » devrait dire « at most one » (Rust + TS).
- Éviction absente de `countCache`/token-map bornée à 8 : dimensionnements assumés.
- Divergence aperçu/fichier du `sql-create` d'export (préexistant, reporté).
- ActivityBar : pas d'onglet de filtre `cancelled` (visible sous « All »).
- Sidebar : `nodesEqual` cast trompeur, imports type à fusionner, test tooltip timing (RTL+fake timers faisable).
- Détails complets et arbitrages : historique des revues par tâche (résumés dans les messages de commit `e27fdb7..7840fcf`).

## Sécurité (acté)

La tâche 7 a fermé **deux injections SQL atteignables depuis le contenu d'un fichier CSV** (backslash final dans une valeur sous MySQL ; backticks dans les en-têtes utilisés comme identifiants) présentes dans l'ancien chemin JS. La vague de correctifs a en outre corrigé l'import chemin B qui pouvait écrire dans la mauvaise base (USE non fiable puis cassé par le protocole binaire).

## Changements de comportement actés

- MySQL lit en protocole binaire ; les statements non préparables (USE, BEGIN/ROLLBACK, SAVEPOINT, LOCK TABLES, LOAD DATA) replient en texte sur ER 1295, une fois, sans boucle.
- Les imports chemin B qualifient `db`.`table` (MySQL) au lieu d'un `USE` préalable ; sans base sélectionnée, table nue = base par défaut de la connexion (identique à l'ancien comportement effectif).
- `QueryCancelled` (bus) signifie désormais « une requête vivante a été annulée » ; l'événement terminal `query_cancelled_{id}` qui libère l'onglet reste inconditionnel.
- Le panneau d'activité affiche `cancelled` (ambre) au lieu d'`error` pour les annulations ; les entrées terminées sont immuables dans les deux sens de course.
- MySQL DATE s'affiche « YYYY-MM-DD » (sans heure parasite) et les fractions de secondes suivent les `decimals` déclarés (deux bugs préexistants corrigés par les tests d'épinglage).

## Smoke test manuel recommandé (~2 min, jamais couvert par les suites)

Sur une vraie base : (a) Postgres 100k lignes → sélection 5k cellules → Ctrl+C + export CSV/JSON (worker) ; (b) import CSV 50k lignes MySQL via le nouveau dialogue (compteur de succès non nul) ; (c) `USE db` + `BEGIN/ROLLBACK` dans l'éditeur MySQL (repli 1295) ; (d) annuler une requête en vol (statut ambre) et une requête déjà finie (statut inchangé) ; (e) DATE/DATETIME(3)/TIME négatif MySQL affichés à l'identique de l'ancien rendu.
