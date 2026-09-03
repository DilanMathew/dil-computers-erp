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

CREATE TABLE IF NOT EXISTS quotations (
  id SERIAL PRIMARY KEY,
  quotation_number TEXT NOT NULL,
  quotation_date DATE NOT NULL,
  customer_name TEXT,
  items JSONB NOT NULL,
  grand_total NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quotations_number_idx ON quotations (quotation_number);
CREATE INDEX IF NOT EXISTS quotations_created_at_idx ON quotations (created_at DESC);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_address TEXT,
  payment_method TEXT,
  quotation_number TEXT,
  items JSONB NOT NULL,
  grand_total NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoices_number_idx ON invoices (invoice_number);
CREATE INDEX IF NOT EXISTS invoices_created_at_idx ON invoices (created_at DESC);

-- Multi-user accounts. role is one of 'admin' | 'sales' | 'accountant':
--   admin      - everything, including user management and the audit log
--   sales      - browse the catalogue, create/view quotations and invoices
--   accountant - read-only across quotations/invoices/catalogue
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'sales',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A record of who did what. entity_type/entity_id point at the affected
-- row (e.g. 'invoice' / 123); details carries a small JSON snapshot.
-- user_id is nullable (ON DELETE SET NULL) so a deleted account doesn't
-- take its history with it — username is kept alongside as a snapshot.
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at DESC);

-- Track who created each quotation/invoice. Added after multi-user support,
-- so these are additive ALTERs rather than part of the CREATE TABLE above —
-- safe to re-run against a database that already has these tables.
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS created_by_username TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by_username TEXT;

-- Saved customer records. Linking a quotation/invoice to one is optional —
-- customer_name (already on both tables) stays as a point-in-time snapshot
-- either way, so a walk-in sale with no saved record still prints fine and
-- a customer's name/phone/address can change later without rewriting history.
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customers_name_idx ON customers USING gin (to_tsvector('simple', name));
CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers (phone);

ALTER TABLE quotations ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;

-- Payments against an invoice. An invoice's status (paid/partially paid/
-- unpaid) is derived from SUM(payments.amount) vs invoices.grand_total
-- rather than stored, so it can never drift out of sync. Creating an
-- invoice for the full amount up front (the common case) inserts one
-- payment row automatically; partial/credit sales just start with less
-- (or none) and more can be recorded later from the Invoices section.
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL,
  payment_method TEXT,
  payment_date DATE NOT NULL,
  notes TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_invoice_id_idx ON payments (invoice_id);

-- Catalogue management fields: reorder_threshold drives the Low Stock
-- view (a product needs restocking once quantity <= its threshold);
-- cost_price is set from the most recent purchase order that received
-- it (last-cost, not weighted-average — simple and good enough for a
-- "what did we last pay" figure); hsn_code is India GST's product
-- classification code, printed per line item on quotation/invoice PDFs.
ALTER TABLE products ADD COLUMN IF NOT EXISTS reorder_threshold INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10, 2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS hsn_code TEXT;

-- Suppliers you buy from, and the purchase orders that receive stock
-- from them. Receiving a PO increases products.quantity immediately
-- (there's no separate "ordered, not yet arrived" state in this phase —
-- creating a PO means the stock is in hand) and updates each product's
-- cost_price to what was just paid.
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  gstin TEXT,
  notes TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS suppliers_name_idx ON suppliers USING gin (to_tsvector('simple', name));

CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  po_number TEXT NOT NULL,
  po_date DATE NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,
  items JSONB NOT NULL,
  grand_total NUMERIC(12, 2) NOT NULL,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS purchase_orders_number_idx ON purchase_orders (po_number);
CREATE INDEX IF NOT EXISTS purchase_orders_created_at_idx ON purchase_orders (created_at DESC);

-- GST: quotations/invoices split into subtotal (pre-tax) + gst_rate/
-- gst_amount, with grand_total now meaning the tax-inclusive final
-- total. Existing rows predate GST support, so they're backfilled as
-- subtotal = grand_total, gst_rate/gst_amount = 0 — an accurate
-- description of them (no tax was charged), not a data loss.
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12, 2);
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5, 2) NOT NULL DEFAULT 0;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;
UPDATE quotations SET subtotal = grand_total WHERE subtotal IS NULL;
ALTER TABLE quotations ALTER COLUMN subtotal SET NOT NULL;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12, 2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5, 2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;
UPDATE invoices SET subtotal = grand_total WHERE subtotal IS NULL;
ALTER TABLE invoices ALTER COLUMN subtotal SET NOT NULL;

-- The buyer's own GST number, for GST-registered customers/suppliers.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS gstin TEXT;
