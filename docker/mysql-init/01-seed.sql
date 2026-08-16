-- Seed MySQL : vitrine de types (dont les rendus pinnés par les tests du
-- protocole binaire : DATE sans heure, DATETIME(3) avec .fff, TIME négatif
-- et > 24h, YEAR), gros volume (200k lignes), et 300 tables pour la sidebar.

USE appdb;

CREATE TABLE typed_showcase (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    d_date        DATE,
    d_datetime    DATETIME,
    d_datetime3   DATETIME(3),
    d_datetime6   DATETIME(6),
    d_time        TIME,
    d_time3       TIME(3),
    d_timestamp   TIMESTAMP NULL,
    d_year        YEAR,
    n_dec         DECIMAL(12,4),
    n_float       FLOAT,
    n_double      DOUBLE,
    n_tiny        TINYINT,
    n_big         BIGINT,
    n_utiny       TINYINT UNSIGNED,
    b_bool        BOOLEAN,
    s_char        CHAR(8),
    s_varchar     VARCHAR(200),
    s_text        TEXT,
    s_enum        ENUM('alpha','beta','gamma'),
    s_set         SET('read','write','admin'),
    j_json        JSON,
    r_blob        BLOB,
    r_binary      BINARY(16)
);

INSERT INTO typed_showcase
    (d_date, d_datetime, d_datetime3, d_datetime6, d_time, d_time3, d_timestamp, d_year,
     n_dec, n_float, n_double, n_tiny, n_big, n_utiny, b_bool,
     s_char, s_varchar, s_text, s_enum, s_set, j_json, r_blob, r_binary)
VALUES
 ('2024-01-15', '2024-01-15 10:30:00', '2024-01-15 10:30:00.123', '2024-01-15 10:30:00.123456',
  '10:30:00', '10:30:00.500', '2024-06-01 08:00:00', 2024,
  1234.5678, 3.14, 2.718281828, 127, 9007199254740993, 255, TRUE,
  'ABC', 'plain value', 'some longer text content', 'alpha', 'read,write',
  JSON_OBJECT('k', 1, 'nested', JSON_ARRAY(1,2,3)), X'DEADBEEF', X'0123456789ABCDEF0123456789ABCDEF'),
 ('1999-12-31', '1999-12-31 23:59:59', '2000-01-01 00:00:00.000', '2000-01-01 00:00:00.000001',
  '-05:30:00', '26:03:04.007', NULL, 1999,
  -0.0001, -1.5, 1e-300, -128, -9223372036854775808, 0, FALSE,
  NULL, 'it''s got ''quotes'' and "doubles"', CONCAT('multi', CHAR(10), 'line', CHAR(10), 'text'),
  'beta', 'admin', JSON_ARRAY('a', 2, TRUE, NULL), NULL, NULL),
 ('2038-01-19', '2038-01-19 03:14:07', '2038-01-19 03:14:07.999', '2038-01-19 03:14:07.999999',
  '838:59:59', '-838:59:59.000', '2038-01-19 03:14:07', 2155,
  99999999.9999, NULL, NULL, NULL, NULL, NULL, NULL,
  'ZZZ', 'backslash \\ and trailing \\', 'a | b | c pipes', 'gamma', 'read,write,admin',
  NULL, X'00', NULL),
 (NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

CREATE TABLE events (
    id        BIGINT AUTO_INCREMENT PRIMARY KEY,
    ts        DATETIME(3) NOT NULL,
    day       DATE NOT NULL,
    kind      ENUM('click','view','purchase','refund','login','error') NOT NULL,
    amount    DECIMAL(12,4),
    ratio     DOUBLE,
    count_i   INT,
    flag      BOOLEAN,
    payload   JSON,
    note      VARCHAR(500),
    KEY idx_ts (ts),
    KEY idx_kind (kind)
);

SET SESSION cte_max_recursion_depth = 200001;
INSERT INTO events (ts, day, kind, amount, ratio, count_i, flag, payload, note)
WITH RECURSIVE seq(g) AS (
    SELECT 1 UNION ALL SELECT g + 1 FROM seq WHERE g < 200000
)
SELECT
    NOW(3) - INTERVAL g SECOND,
    DATE(NOW() - INTERVAL g HOUR),
    ELT(1 + (g % 6), 'click','view','purchase','refund','login','error'),
    IF(g % 11 = 0, NULL, ROUND(g / 7, 4)),
    IF(g % 13 = 0, NULL, g / 3.14159),
    IF(g % 7 = 0, NULL, (g * 31) % 2147483647),
    IF(g % 5 = 0, NULL, g % 2),
    IF(g % 3 = 0, NULL, JSON_OBJECT('n', g, 'ok', g % 2 = 0)),
    CASE
      WHEN g % 17 = 0 THEN CONCAT('multi', CHAR(10), 'line #', g)
      WHEN g % 19 = 0 THEN CONCAT('quote '' and "double" #', g)
      ELSE CONCAT('note ', g)
    END
FROM seq;

CREATE TABLE customers (
    id        BIGINT AUTO_INCREMENT PRIMARY KEY,
    email     VARCHAR(190) NOT NULL UNIQUE,
    full_name VARCHAR(120) NOT NULL,
    country   CHAR(2) NOT NULL,
    signup_at DATETIME NOT NULL
);

SET SESSION cte_max_recursion_depth = 5001;
INSERT INTO customers (email, full_name, country, signup_at)
WITH RECURSIVE seq(g) AS (SELECT 1 UNION ALL SELECT g + 1 FROM seq WHERE g < 5000)
SELECT
    CONCAT('user', g, '@example.com'),
    CONCAT(ELT(1 + g % 8, 'Ada','Linus','Grace','Alan','Edsger','Barbara','Donald','Margaret'),
           ' #', g),
    ELT(1 + g % 8, 'FR','DE','US','JP','BR','IN','GB','ES'),
    NOW() - INTERVAL g HOUR
FROM seq;

CREATE TABLE orders (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    customer_id BIGINT NOT NULL,
    status      ENUM('pending','paid','shipped','delivered','cancelled') NOT NULL,
    ordered_at  DATETIME NOT NULL,
    total       DECIMAL(12,2) NOT NULL DEFAULT 0,
    CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
    KEY idx_customer (customer_id)
);

SET SESSION cte_max_recursion_depth = 30001;
INSERT INTO orders (customer_id, status, ordered_at, total)
WITH RECURSIVE seq(g) AS (SELECT 1 UNION ALL SELECT g + 1 FROM seq WHERE g < 30000)
SELECT
    1 + (g * 7) % 5000,
    ELT(1 + g % 5, 'pending','paid','shipped','delivered','cancelled'),
    NOW() - INTERVAL g MINUTE,
    ROUND(RAND(g) * 500, 2)
FROM seq;
