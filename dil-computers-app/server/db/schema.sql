CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  quantity INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_category_idx ON products (category);
CREATE INDEX IF NOT EXISTS products_name_idx ON products USING gin (to_tsvector('simple', name));
