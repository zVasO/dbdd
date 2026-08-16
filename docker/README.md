# Bases de test Docker pour vasodb

## Démarrage

```bash
cd docker
docker compose up -d          # Postgres + MySQL avec seed sur mesure
docker compose --profile extra up -d   # + les jeux publics world-db et employees
```

Premier démarrage : le seed s'exécute automatiquement (~1–2 min pour MySQL).
Reset complet : `docker compose down -v && docker compose up -d`.

## Connexions

| Service | Hôte | Port | User | Mot de passe | Base |
|---|---|---|---|---|---|
| Postgres (seed) | localhost | **5433** | `vasodb` | `vasodb` | `appdb` |
| MySQL (seed) | localhost | **3307** | `vasodb` | `vasodb` | `appdb` (+ `zoo`) |
| Postgres world-db (profil `extra`) | localhost | 5434 | `world` | `world123` | `world-db` |
| MySQL employees (profil `extra`) | localhost | 3308 | `root` | `vasodb` | `employees` |

## Ce que chaque jeu de données teste

### Postgres `appdb`
- **`app.*`** — schéma réaliste avec FKs (customers→orders→order_items→products),
  index, vue `customer_revenue` : navigation FK, structure de table, jointures.
- **`perf.events`** — 250 000 lignes, tous les types (uuid, timestamptz, date,
  numeric, float, int, bool, jsonb, bytea) avec NULLs réguliers : streaming,
  limite de sécurité 50k, chemin columnar natif, scroll de la grille.
- **`perf.wide_cols`** — 200 colonnes × 5 000 lignes : virtualisation colonnes,
  resize, navigation clavier Home/End.
- **`perf.edge_cases`** — quotes, multilignes, tabs, backslashes, pipes,
  unicode, dollar-quoting : copie CSV/TSV/JSON/Markdown/INSERT, export,
  tokenizer LIMIT.
- **`zoo.t_001..t_500`** — 500 tables : virtualisation sidebar, cache de
  structures Rust, recherche fuzzy.

### MySQL `appdb` + `zoo`
- **`appdb.typed_showcase`** — la vitrine des types pinnés par les tests du
  protocole binaire : DATE (sans heure parasite), DATETIME(3)/(6) avec
  fractions, TIME négatif et > 24h (`838:59:59`), YEAR, DECIMAL, JSON, ENUM,
  SET, BLOB, BIGINT extrêmes, ligne entièrement NULL.
- **`appdb.events`** — 200 000 lignes : streaming, pagination.
- **`appdb.customers`/`orders`** — FKs + volumes moyens.
- **`zoo`** — 300 tables + `wide_cols` (120 colonnes × 3 000 lignes).

### Scénarios de smoke rapides (cf. docs/plans/perf-wave-*-followups.md)
- `SELECT * FROM perf.events` (PG) → streaming + cap 50k ; annuler en vol.
- Sélection 5 000 cellules → Ctrl+C, puis export CSV/JSON (worker).
- Import CSV vers `appdb` MySQL (le dialogue affiche des compteurs exacts).
- `USE zoo` puis `BEGIN; ROLLBACK;` dans l'éditeur MySQL (repli protocole texte).
- Parcourir `zoo` dans la sidebar (500 tables PG / 300 MySQL), survol, clic droit.

## Jeux publics inclus (profil `extra`)
- [`ghusta/postgres-world-db`](https://hub.docker.com/r/ghusta/postgres-world-db) —
  base « world » (pays, villes, langues), petite et réaliste.
- [`genschsa/mysql-employees`](https://hub.docker.com/r/genschsa/mysql-employees) —
  base « Employees » officielle MySQL : ~300k employés, 2,8 M lignes de
  salaires. Idéale pour les gros COUNT(*) et la pagination serveur.

Autres jeux notables non inclus : Pagila (PG, location DVD — s'installe en
déposant ses .sql dans `postgres-init/`), Sakila (équivalent MySQL),
Chinook (multi-SGBD, magasin de musique).
