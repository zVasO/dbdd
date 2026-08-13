# Suivi post-vague perf 1–2 (2026-07-28)

Vague livrée sur `master` (`13445d5..515654c`), revue finale : prêt à merger. Restes non bloquants, arbitrés en fin de processus, à traiter dans une vague ultérieure.

## Priorité haute (petits fixes, direction « SQL invalide » ou annulation)

> **Traité le 2026-08-13** (commits `b78b5e5` + `17110f3`) : repli conservateur quand le scan finit déséquilibré, annulation driver avant réveil du waiter, bornée à 2 s (`DRIVER_CANCEL_TIMEOUT`) pour ne pas bloquer l'onglet sur pool saturé. Le point 3 (doc-comments contradictoires) est corrigé au passage.

1. **Garde-fou LIMIT : repli quand le scan est incertain.** `depth_tagged_tokens` (`apps/desktop/src-tauri/src/commands/query.rs:141-214`) ne connaît ni les échappements backslash MySQL (`'a\'( b'`) ni le dollar-quoting Postgres (`$$…$$`) : une parenthèse *déséquilibrée* dans un littéral mal parsé peut pousser un LIMIT top-level réel à profondeur > 0 → double LIMIT → erreur de syntaxe sur une requête valide. Containment recommandé par la re-revue (~4 lignes) : si le scan se termine avec `depth != 0` ou `quote.is_some()`, considérer le parse comme non fiable et retomber sur l'ancien comportement « tout token LIMIT/FETCH compte » (faux négatif sûr, jamais de SQL invalide). Les tests existants restent inchangés (tous se terminent équilibrés).
2. **Race étroite annulation non-streaming : lire le pid avant de signaler.** `commands/query.rs:496-499` × `purrql-postgres/connection.rs:110` : `signal_cancel` peut réveiller la tâche de requête, dont le drop exécute `forget_pid` avant le `lookup_pid` de la tâche d'annulation → aucun `pg_cancel_backend` envoyé (la requête serveur continue). Fenêtre de quelques centaines de ns ; perdre la course reste meilleur que l'ancien comportement. Fix : lire le pid avant d'émettre le signal. Le streaming n'est pas concerné.

## Cohérence / dette

3. Deux doc-comments se contredisent sur `SELECT 'LIMIT'` (« false positive » en `query.rs:138` vs « false negative » en `query.rs:228`) — en corriger un.
4. `strip_comments` et `depth_tagged_tokens` dupliquent la logique de scan de guillemets avec des mécaniques d'échappement légèrement différentes — facteur de divergence future ; à factoriser.
5. `(select …)` top-level désormais plafonné (changement de comportement sûr, documenté `query.rs:233-234`) — rien à faire, noté pour mémoire.

## Différés hérités des tâches (arbitrés « restent différés » par la revue finale)

- Statut d'activité `cancelled` manquant : les annulations s'affichent en erreur (rouge) dans le panneau d'activité (`queryStore.ts` logError('Cancelled')).
- Bouton Cancel absent sur les exécutions batch (nécessite des query ids par statement).
- Fenêtre d'orphelinage de stream avant enregistrement backend (ms) ; les événements terminaux libèrent l'onglet.
- `watch::Receiver::changed()` : `Result` ignoré (inatteignable aujourd'hui, piège latent).
- `last_used_at` jamais persisté côté backend (`update_last_used` non implémenté/jamais appelé) — le tri « récents » de WelcomeScreen retombe sur `created_at` après reload.
- `sort_order` : divergence locale (length) vs backend (0) — inerte tant que rien ne trie dessus.
- Purge d'historique : tri sans index utilisable sur `executed_at` (négligeable au cap de 10 k) ; échecs silencieux au-delà du warn.
- Rafraîchissement manuel des widgets santé/dashboard : n'écrit pas l'historique (fonction partagée avec l'auto-refresh) — revisiter seulement sur retour utilisateur.
- Pas d'infra jsdom/RTL : la liaison DataGrid/TableStructureView n'est testée qu'au niveau fonction pure.
- Aperçu ExportDialog : flash vide au changement de format (cosmétique).
- Round-trip supplémentaire `pg_backend_pid()` par requête utilisateur trackée (adjugé acceptable — pas de route moins chère via sqlx).

## Chantiers suivants de l'audit (vagues 3–5, cf. docs/performance-audit-2026-07-28.md)

Vague 3 : frontière de memo de la grille (getActiveResult stable, GridRow/GridCell memo, sélection rectangle, Maps pendingChanges). Vague 4 : virtualisation colonnes + sidebar. Vague 5 : export en worker, cache structures Rust, sortie columnar niveau driver, import CSV en Rust, IPC binaire.
