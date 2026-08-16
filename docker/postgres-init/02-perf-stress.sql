-- Tables de stress ciblant les optimisations de l'app :
--   perf.events      250k lignes, tous les types (streaming, limite 50k, columnar)
--   perf.wide_cols   200 colonnes  (virtualisation colonnes)
--   perf.edge_cases  quotes / multilignes / unicode (copie, CSV, LIMIT tokenizer)
--   zoo.t_001..500   500 tables    (virtualisation sidebar, cache structures)

CREATE SCHEMA perf;

CREATE TABLE perf.events (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_uuid uuid NOT NULL DEFAULT gen_random_uuid(),
    ts         timestamptz NOT NULL,
    day        date NOT NULL,
    kind       text NOT NULL,
    amount     numeric(12,4),
    ratio      double precision,
    count_i32  int,
    count_i64  bigint,
    flag       boolean,
    payload    jsonb,
    note       text,
    raw        bytea
);

INSERT INTO perf.events (ts, day, kind, amount, ratio, count_i32, count_i64, flag, payload, note, raw)
SELECT
    now() - (g || ' seconds')::interval,
    (now() - (g || ' hours')::interval)::date,
    (ARRAY['click','view','purchase','refund','login','error'])[1 + g % 6],
    CASE WHEN g % 11 = 0 THEN NULL ELSE round((g % 100000)::numeric / 7, 4) END,
    CASE WHEN g % 13 = 0 THEN NULL ELSE g::float / 3.14159 END,
    CASE WHEN g % 7  = 0 THEN NULL ELSE (g * 31) % 2147483647 END,
    g::bigint * 1000003,
    CASE WHEN g % 5  = 0 THEN NULL ELSE g % 2 = 0 END,
    CASE WHEN g % 3  = 0 THEN NULL
         ELSE jsonb_build_object('n', g, 'nested', jsonb_build_object('ok', g % 2 = 0),
                                 'arr', jsonb_build_array(g, g+1)) END,
    CASE WHEN g % 17 = 0 THEN E'multi\nline note #' || g
         WHEN g % 19 = 0 THEN 'quote '' and "double" #' || g
         ELSE 'note ' || g END,
    CASE WHEN g % 23 = 0 THEN decode(md5(g::text), 'hex') END
FROM generate_series(1, 250000) g;

CREATE INDEX ON perf.events (ts DESC);
CREATE INDEX ON perf.events (kind);

-- 200 colonnes, 5 000 lignes.
DO $$
DECLARE cols text;
BEGIN
    SELECT string_agg('col_' || i || CASE
             WHEN i % 10 = 0 THEN ' text'
             WHEN i % 7  = 0 THEN ' numeric(10,2)'
             WHEN i % 5  = 0 THEN ' timestamptz'
             WHEN i % 3  = 0 THEN ' double precision'
             ELSE ' int' END, ', ')
      INTO cols FROM generate_series(1, 200) i;
    EXECUTE 'CREATE TABLE perf.wide_cols (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, ' || cols || ')';

    SELECT string_agg('col_' || i, ', ') INTO cols FROM generate_series(1, 200) i;
    EXECUTE 'INSERT INTO perf.wide_cols (' || cols || ') SELECT '
         || (SELECT string_agg(CASE
                WHEN i % 10 = 0 THEN '''txt_'' || g'
                WHEN i % 7  = 0 THEN 'round((g * ' || i || ')::numeric / 100, 2)'
                WHEN i % 5  = 0 THEN 'now() - (g || '' minutes'')::interval'
                WHEN i % 3  = 0 THEN '(g * ' || i || ')::float / 7'
                ELSE '(g * ' || i || ') % 10000' END, ', ')
             FROM generate_series(1, 200) i)
         || ' FROM generate_series(1, 5000) g';
END $$;

CREATE TABLE perf.edge_cases (
    id          int PRIMARY KEY,
    description text,
    tricky      text
);

INSERT INTO perf.edge_cases VALUES
 (1,  'newline in value',        E'line1\nline2\nline3'),
 (2,  'tab and CR',              E'a\tb\rc'),
 (3,  'single quotes',           'it''s a ''test'''),
 (4,  'double quotes',           'she said "hi"'),
 (5,  'backslashes',             E'C:\\temp\\file and trailing \\'),
 (6,  'pipes for markdown',      'a | b | c'),
 (7,  'commas for csv',          'one, two, and "three"'),
 (8,  'unicode',                 'héllo wörld — 日本語 🚀 עברית'),
 (9,  'empty string',            ''),
 (10, 'null value',              NULL),
 (11, 'very long value',         repeat('lorem ipsum dolor sit amet ', 200)),
 (12, 'looks like sql',          'SELECT * FROM t; DROP TABLE x; -- LIMIT 5'),
 (13, 'dollar quoting bait',     '$$)($$ inner'),
 (14, 'json as text',            '{"not": "jsonb", "just": "text"}'),
 (15, 'zero width space',        E'a\u200Bb');

-- 500 petites tables pour la sidebar.
DO $$
BEGIN
    EXECUTE 'CREATE SCHEMA zoo';
    FOR i IN 1..500 LOOP
        EXECUTE format(
            'CREATE TABLE zoo.t_%s (id serial PRIMARY KEY, name text, val numeric(8,2), at timestamptz DEFAULT now())',
            lpad(i::text, 3, '0'));
        EXECUTE format(
            'INSERT INTO zoo.t_%s (name, val) SELECT ''row '' || g, g * 1.5 FROM generate_series(1, %s) g',
            lpad(i::text, 3, '0'), 5 + i % 20);
    END LOOP;
END $$;

ANALYZE;
