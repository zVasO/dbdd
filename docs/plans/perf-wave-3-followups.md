# Suivi post-vague perf 3 — grid memo boundary (2026-08-13)

Vague livrée sur `master` (`07a5154..279d645`), revue finale : prêt à merger après le fix `279d645` (écriture render-phase éliminée de `getActiveResult`). Restes non bloquants, arbitrés « restent différés » par la revue finale.

## À faire avant de considérer la vague validée côté UX

- **Smoke test manuel (~30 s)** : la surface gestuelle de la grille a été mécaniquement réécrite vers des handlers lisant `data-*` (`currentTarget.dataset`) sous le dispatch enter/leave synthétique de React, sans infra de test DOM. Vérifier à la main : drag-sélection de cellules, drag sur la gouttière de lignes, shift-clic, ctrl-clic, double-clic → édition (Enter/Escape/blur/bouton NULL), menu contextuel cellule et ligne, copie, clic sur valeur FK, pulse de surbrillance de colonne.

## Différés (polish pass, par ordre d'intérêt)

1. `GridCell` reçoit tout `columnarData` → toutes les cellules visibles re-rendent à chaque flush de stream ; passer une tranche par colonne ou un tick de version rendrait le flush O(cellules changées). (revue finale)
2. Blocs legacy quasi morts de navigation flèches (`DataGrid.tsx:1295-1319`) — n'est atteignable que si `focusedCell` est null ; à supprimer ou fusionner. (revue finale)
3. `bodyState` réalloué à chaque render (objet de 14 champs publié dans `useLayoutEffect`) — mutualiser l'objet. (revue finale)
4. Regrouper les huit `useCallback(fn, [])` du handlers object en un seul `useMemo(() => ({...}), [])` pour rendre l'invariant deps-vides structurel. (revue T5)
5. `columnarCellValue`/`formatCell` déplacés dans `GridRow.tsx` faute de mieux ; les extraire dans `gridCellValue.ts` (pas de cycle, convention du dossier). (revue T5)
6. `data-arow` posé sur le div de ligne mais jamais lu (`GridRow.tsx:964`). (revue T5)
7. Ctrl-clic avant toute ancre puis shift-clic perd la cellule togglée (branche anchor-null d'`extendTo`, gap hérité du code de référence du plan). (revue T4)
8. `selectionSize()` appelé deux fois par render (footer + label menu contextuel), O(added+removed) chacun — trivial. (revue T4)
9. Le rapport T5 surestime « typing re-renders exactly one component » : DataGrid re-rend à chaque frappe, seuls les sous-arbres sont élagués — noté pour lecture future. (revue T5)

## Changement de comportement acté (documenté au plan)

- Les gestes de plage shift (shift-clic, shift-flèches) sont désormais une extension pure de rectangle depuis l'ancre (sémantique tableur) ; un `extendTo` efface les toggles ctrl précédents (« rect wins »). Le ctrl-clic ne ré-ancre plus le shift-range.

## Chantiers suivants de l'audit (cf. docs/performance-audit-2026-07-28.md)

Vague 4 : virtualisation colonnes DataGrid + sidebar aplatie + slices `structures`. Vague 5 : copie/export en worker, cache structures Rust, sortie columnar niveau driver, import CSV en Rust, IPC binaire. Candidats hors grille notés par l'éclaireur : props inline de SqlEditor/EditorToolbar/EditorTabs/FilterBar.
