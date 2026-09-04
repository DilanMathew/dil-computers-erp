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

-- Per-product warranty (months from date of sale). Purely informational —
-- shown on the sale, not tracked with alerts in this phase.
ALTER TABLE products ADD COLUMN IF NOT EXISTS warranty_months INTEGER;

-- Annual maintenance contracts. A contract's status (active/expired) is
-- derived from end_date vs today rather than stored, same pattern as
-- invoice payment status — "cancelled" is the one state dates alone can't
-- express, so that's the only status actually stored.
CREATE TABLE IF NOT EXISTS amc_contracts (
  id SERIAL PRIMARY KEY,
  contract_number TEXT NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  covered_devices TEXT,
  notes TEXT,
  cancelled BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS amc_contracts_number_idx ON amc_contracts (contract_number);
CREATE INDEX IF NOT EXISTS amc_contracts_customer_idx ON amc_contracts (customer_id);

-- Repair/service tickets. status is one of 'received' | 'diagnosing' |
-- 'waiting_for_parts' | 'in_repair' | 'ready_for_pickup' | 'completed' |
-- 'cancelled'. invoice_number is a free-text reference (same pattern as
-- invoices.quotation_number) — billing for a repair happens as a normal
-- invoice that cites the ticket, rather than the ticket carrying its own
-- line items. warranty_days is set when the repair is completed (the
-- shop's own warranty on the work, separate from any product warranty).
CREATE TABLE IF NOT EXISTS repair_tickets (
  id SERIAL PRIMARY KEY,
  ticket_number TEXT NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  device_description TEXT NOT NULL,
  serial_number TEXT,
  reported_issue TEXT NOT NULL,
  diagnosis TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  estimated_cost NUMERIC(12, 2),
  final_cost NUMERIC(12, 2),
  invoice_number TEXT,
  amc_contract_id INTEGER REFERENCES amc_contracts(id) ON DELETE SET NULL,
  warranty_days INTEGER,
  received_date DATE NOT NULL,
  completed_date DATE,
  assigned_to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_to_username TEXT,
  notes TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS repair_tickets_number_idx ON repair_tickets (ticket_number);
CREATE INDEX IF NOT EXISTS repair_tickets_customer_idx ON repair_tickets (customer_id);
CREATE INDEX IF NOT EXISTS repair_tickets_status_idx ON repair_tickets (status);
CREATE INDEX IF NOT EXISTS repair_tickets_created_at_idx ON repair_tickets (created_at DESC);

-- Optional reference from an invoice back to the repair ticket it billed
-- for — same free-text-reference pattern as invoices.quotation_number.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ticket_number TEXT;

-- Credit notes / returns. Unlike quotation_number/ticket_number, invoice_id
-- is a real foreign key (not free text) — validating a return means
-- checking it against that specific invoice's actual line items and
-- whatever's already been returned against it, so the reference has to be
-- resolvable. The original invoice is never modified — it stays an
-- immutable record of what was sold; a credit note is a separate,
-- append-only record of what came back and what's owed to the customer as
-- a result. Creating one increases the returned products' stock, mirroring
-- how a purchase order increases it and an invoice decreases it.
CREATE TABLE IF NOT EXISTS credit_notes (
  id SERIAL PRIMARY KEY,
  credit_note_number TEXT NOT NULL,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  invoice_number TEXT NOT NULL,
  customer_name TEXT,
  reason TEXT,
  refund_method TEXT,
  items JSONB NOT NULL,
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
  gst_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  gst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_notes_number_idx ON credit_notes (credit_note_number);
CREATE INDEX IF NOT EXISTS credit_notes_invoice_idx ON credit_notes (invoice_id);
CREATE INDEX IF NOT EXISTS credit_notes_created_at_idx ON credit_notes (created_at DESC);

-- Barcode for scan-to-find lookups (a barcode scanner just types the code
-- into the same product search box) — admin-editable from the Catalogue,
-- same pattern as hsn_code/reorder_threshold/warranty_months.
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode TEXT;
CREATE INDEX IF NOT EXISTS products_barcode_idx ON products (barcode);

-- HR roster (Staff Monitoring). Deliberately independent of "users" — not
-- every employee needs a login (e.g. a technician who never touches the
-- system), and not every login is HR-tracked (e.g. the bootstrap admin).
-- user_id is an optional link for the minority that are both.
-- earned_leave_balance is a plain stored balance (admin-adjustable), not a
-- full accrual/request workflow.
CREATE TABLE IF NOT EXISTS staff_members (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  position TEXT,
  phone TEXT,
  email TEXT,
  join_date DATE,
  salary NUMERIC(12, 2) NOT NULL DEFAULT 0,
  earned_leave_balance NUMERIC(6, 2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_members_name_idx ON staff_members (name);

-- Payroll & Compensation. One row per payment run against a staff member —
-- a month's salary, a bonus, a reimbursement, or any combination in one
-- entry. total_amount is deliberately not stored — always derived as
-- salary_amount + bonus_amount + reimbursement_amount, same "compute, don't
-- store" pattern as invoice payment status and AMC contract status.
CREATE TABLE IF NOT EXISTS payroll_records (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff_members(id) ON DELETE RESTRICT,
  pay_period TEXT NOT NULL,
  payment_date DATE NOT NULL,
  salary_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  bonus_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  reimbursement_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_records_staff_idx ON payroll_records (staff_id);
CREATE INDEX IF NOT EXISTS payroll_records_period_idx ON payroll_records (pay_period);
CREATE INDEX IF NOT EXISTS payroll_records_created_at_idx ON payroll_records (created_at DESC);

-- Manual override/supplement for Customer Insights (admin only) — e.g.
-- "VIP", "Watch", "Do not extend credit". Distinct from the computed
-- health badge (spend/frequency/payment history), which is always
-- derived live and never stored; this is the one thing a person sets by
-- hand when the numbers don't tell the whole story.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS risk_tag TEXT;

-- On-site field billing: a technician bills a completed job in one atomic
-- action (POST /api/repair-tickets/:id/bill) covering labor hours and/or
-- parts fitted. hours_worked and parts_used are the snapshot of what that
-- action billed — parts_used mirrors invoice items' shape (category,
-- name, quantity, price) but only ever holds actual parts, never the
-- labor line itself. Priced server-side only (a fixed rate for labor, the
-- catalogue price for parts) — a technician never enters or edits a
-- price, by design.
ALTER TABLE repair_tickets ADD COLUMN IF NOT EXISTS hours_worked NUMERIC(6, 2);
ALTER TABLE repair_tickets ADD COLUMN IF NOT EXISTS parts_used JSONB;
