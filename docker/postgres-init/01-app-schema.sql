-- Schéma applicatif réaliste : FKs pour la navigation, vues, index,
-- volumes moyens (~60k lignes au total).

CREATE SCHEMA app;
SET search_path TO app;

CREATE TABLE customers (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email        text NOT NULL UNIQUE,
    full_name    text NOT NULL,
    country      char(2) NOT NULL,
    vip          boolean NOT NULL DEFAULT false,
    signup_at    timestamptz NOT NULL,
    last_seen_at timestamptz,
    settings     jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE products (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sku        text NOT NULL UNIQUE,
    name       text NOT NULL,
    category   text NOT NULL,
    price      numeric(10,2) NOT NULL CHECK (price >= 0),
    weight_kg  numeric(8,3),
    attrs      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id bigint NOT NULL REFERENCES customers(id),
    status      text NOT NULL CHECK (status IN ('pending','paid','shipped','delivered','cancelled')),
    ordered_at  timestamptz NOT NULL,
    shipped_at  timestamptz,
    total       numeric(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE order_items (
    order_id   bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id bigint NOT NULL REFERENCES products(id),
    qty        int NOT NULL CHECK (qty > 0),
    unit_price numeric(10,2) NOT NULL,
    PRIMARY KEY (order_id, product_id)
);

INSERT INTO customers (email, full_name, country, vip, signup_at, last_seen_at, settings)
SELECT
    'user' || g || '@example.com',
    (ARRAY['Ada','Linus','Grace','Alan','Edsger','Barbara','Donald','Margaret'])[1 + g % 8]
      || ' ' ||
    (ARRAY['Lovelace','Torvalds','Hopper','Turing','Dijkstra','Liskov','Knuth','Hamilton'])[1 + (g / 8) % 8]
      || ' #' || g,
    (ARRAY['FR','DE','US','JP','BR','IN','GB','ES'])[1 + g % 8],
    g % 20 = 0,
    now() - (g || ' hours')::interval,
    CASE WHEN g % 5 = 0 THEN NULL ELSE now() - (g % 900 || ' minutes')::interval END,
    jsonb_build_object('theme', CASE WHEN g % 2 = 0 THEN 'dark' ELSE 'light' END,
                       'newsletter', g % 3 = 0)
FROM generate_series(1, 5000) g;

INSERT INTO products (sku, name, category, price, weight_kg, attrs)
SELECT
    'SKU-' || lpad(g::text, 6, '0'),
    'Product ' || g,
    (ARRAY['electronics','books','garden','toys','food','tools'])[1 + g % 6],
    round((random() * 500 + 1)::numeric, 2),
    CASE WHEN g % 7 = 0 THEN NULL ELSE round((random() * 20)::numeric, 3) END,
    jsonb_build_object('color', (ARRAY['red','blue','green','black'])[1 + g % 4],
                       'stock', (g * 13) % 500)
FROM generate_series(1, 2000) g;

INSERT INTO orders (customer_id, status, ordered_at, shipped_at, total)
SELECT
    1 + (g * 7) % 5000,
    (ARRAY['pending','paid','shipped','delivered','cancelled'])[1 + g % 5],
    now() - (g || ' minutes')::interval,
    CASE WHEN g % 5 IN (2,3) THEN now() - ((g - 30) || ' minutes')::interval END,
    0
FROM generate_series(1, 20000) g;

INSERT INTO order_items (order_id, product_id, qty, unit_price)
SELECT DISTINCT ON (o, p)
    o, p, 1 + (o + p) % 5,
    round((random() * 200 + 1)::numeric, 2)
FROM (
    SELECT 1 + (g * 11) % 20000 AS o, 1 + (g * 17) % 2000 AS p
    FROM generate_series(1, 45000) g
) s;

UPDATE orders o
SET total = COALESCE((SELECT sum(qty * unit_price) FROM order_items i WHERE i.order_id = o.id), 0);

CREATE INDEX ON orders (customer_id);
CREATE INDEX ON orders (status, ordered_at DESC);
CREATE INDEX ON order_items (product_id);

CREATE VIEW customer_revenue AS
SELECT c.id, c.full_name, c.country, count(o.id) AS orders, sum(o.total) AS revenue
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.id;
