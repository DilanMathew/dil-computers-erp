# DIL Computers App

React (Vite) frontend + Node/Express backend, backed by Postgres. Ships a
login screen backed by real (multi-user, role-based) accounts, and — once
logged in — a dashboard with sections scoped to your role:

- **Overview** *(all roles)* — the landing tab: sales this month,
  outstanding receivables, low-stock item count, open repair ticket count,
  and active AMC contracts (with a call-out for any expiring within 30
  days), plus the 5 most recent invoices. All figures are computed live
  from the same data the other sections show — nothing here is a separate
  stored total that could drift.
- **Create Quotation** *(admin, sales)* — pick a product category, search
  for a product by name, and set a quantity; the catalogue price
  auto-populates. Final price starts empty — tick "Same as catalogue price"
  to use the catalogue price as-is, or leave it unticked and type a
  discounted price. Pick a **GST rate** (0/5/12/18/28%, standard Indian
  slabs) — the subtotal/GST/grand total breakdown shows live and prints on
  the PDF alongside each line item's HSN code (from the catalogue, if
  set) and the company's own name/GSTIN/address. Add as many products as
  needed, then **Create Quotation (PDF)** saves the quotation and
  downloads the PDF straight to your computer. Quotations do **not**
  affect catalogue stock — they're estimates, not sales.
- **Quotations** *(all roles)* — searchable, paginated list of every saved
  quotation, with an expandable row showing its line items and who created it.
- **Create Invoice** *(admin, sales)* — the same category/product/quantity/
  price picker, plus a customer (searched from saved customers or typed
  fresh as a walk-in), phone, address, payment method, and optional
  references to an existing quotation number and/or repair ticket number
  (both autocomplete) — the latter for billing a completed repair. Untick
  "Paid in full now" to record a partial payment or a credit sale (0
  received) instead. **Create Invoice (PDF)** saves the invoice, **reduces
  catalogue stock** by the quantity of each product sold, and downloads a
  PDF invoice. Stock is checked and decremented atomically — an invoice is
  refused (no partial deduction) if any line item would oversell what's left.
- **Invoices** *(all roles view; admin/sales can record payments)* —
  searchable, paginated list of every saved invoice, filterable by payment
  status (paid/partially paid/unpaid). An expandable row shows customer
  details, line items, payment history, and — while a balance remains — a
  form to record another payment against it (amount pre-filled to the
  exact balance due; the server refuses an amount that would overpay).
- **Create Credit Note** *(admin, sales)* — process a return against an
  existing invoice: search for the invoice, then enter a return quantity
  against any of its line items (capped at what's left returnable, after
  subtracting anything already returned on an earlier credit note against
  the same invoice). Unit price and GST rate are taken from the original
  invoice — not re-enterable — so a refund always matches what was
  actually charged. **Create Credit Note** saves the record and
  **increases catalogue stock** back by the returned quantities. The
  original invoice itself is never modified; it stays an accurate record
  of what was sold.
- **Credit Notes** *(all roles)* — searchable, paginated list of every
  credit note, with an expandable row showing the returned items, reason,
  refund method, and GST breakdown.
- **Customers** *(all roles view; admin/sales can add/edit)* — searchable,
  paginated list of saved customer records (name, phone, email, address,
  notes). An expandable row shows and edits those details plus every
  quotation and invoice linked to that customer.
- **Create Purchase Order** *(admin, sales)* — receive stock from a
  supplier: category/product/quantity/cost-price picker, same shape as the
  sales pickers but for buying. Submitting a PO **increases catalogue
  stock immediately** (there's no separate "ordered, not yet arrived"
  state) and updates each product's last-known cost price.
- **Purchase Orders** *(all roles)* — searchable, paginated list of every
  received PO, with an expandable row showing its line items.
- **Suppliers** *(all roles view; admin/sales can add/edit)* — same shape
  as Customers, including a GSTIN field and an expandable row showing that
  supplier's purchase order history.
- **Low Stock** *(all roles)* — every product at or below its reorder
  threshold, sorted by quantity. Set a threshold per product from the
  Product Catalogue (admin only).
- **Product Catalogue** *(all roles; admin can manage)* — the original
  searchable, paginated view of the full product catalogue, now also
  showing each product's HSN code, warranty period, and barcode. The
  search box matches a barcode as well as a name, so a USB barcode
  scanner (which just types the code and hits enter) works as a
  "scan to find" lookup here and in the product picker on
  quotations/invoices. Quantities reflect stock reduced by invoices and
  increased by purchase orders. Admins can click a row to set its HSN
  code, reorder threshold, warranty (in months — carried onto any
  quotation/invoice line item for that product, purely informational),
  and barcode; its last cost price is shown read-only, set automatically
  from purchase orders. When adding a product to a quotation or invoice,
  an optional comma-separated **serial numbers** field captures one
  serial per unit sold (must match the quantity exactly, or be left
  blank) — shown alongside that line item everywhere it appears.
- **Catalogue Import/Export** *(admin only)* — **Export** downloads the
  full catalogue as a CSV; **Import** uploads one to bulk create/update
  products (matched by category + name), updating only the columns
  present in each row and leaving the rest untouched — handy for a
  supplier's price list or a full price review in a spreadsheet. A row
  that doesn't match an existing product is created new. Errors are
  reported per row without aborting the rest of the import.
- **Create Repair Ticket** *(admin, sales)* — log a device dropped off for
  repair: pick a saved customer, describe the device and the reported
  issue, and optionally note a serial number, an estimated cost, and
  whether it's covered by an existing AMC contract (autocomplete by
  contract # or customer). Billing for a repair happens as a normal
  invoice that references the ticket — a ticket doesn't carry its own line
  items.
- **Repair Tickets** *(all roles view; admin/sales can update)* —
  searchable, paginated list filterable by status. An expandable row shows
  the full ticket and, for admin/sales, an editable workflow: status
  (received → diagnosing → waiting for parts → in repair → ready for
  pickup → completed/cancelled), diagnosis notes, final cost, a billing
  invoice reference, the shop's own warranty on the repair (in days),
  completed date, assigned technician, and free-form notes.
- **Create AMC Contract** *(admin, sales)* — set up an annual maintenance
  contract for a customer: contract number, start/end date, amount, and
  optionally which devices it covers and any notes.
- **AMC Contracts** *(all roles view; admin/sales can update)* —
  searchable, paginated list with a derived status badge (active / expired
  / cancelled — computed from the end date vs today, not stored, so it
  can't drift). An expandable row shows contract details, every repair
  ticket linked to it, and (admin/sales) editing to extend the end date,
  adjust the amount, or cancel the contract.
- **Users** *(admin only)* — create accounts, assign roles (`admin` /
  `sales` / `accountant`), deactivate/reactivate accounts, reset passwords.
  An admin can't deactivate or demote their own account (so there's always
  at least one working admin).
- **Audit Log** *(admin only)* — who created which quotation/invoice/
  customer/user/payment/repair ticket/AMC contract/credit note/bulk
  import and when, most recent first.

### Infrastructure & security

- `GET /api/health` — unauthenticated health check (confirms the process
  is up *and* can reach the database), for Railway or any uptime monitor.
- Login attempts are rate-limited per IP (10 per 5-minute window) to slow
  down password guessing. It's in-memory, so it resets on a restart and
  doesn't share state across multiple instances — adequate for this
  single-instance deployment, not a substitute for a real WAF at scale.
- Basic response headers (`X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`) and a request body size cap are set on every
  response/request.
- The server logs a clear warning on startup if `AUTH_SECRET` isn't set
  (falling back to an insecure default) — check the deploy logs after a
  first setup.

### Roles

| Role | Can do |
|---|---|
| `admin` | Everything, including Users and the Audit Log |
| `sales` | Browse the catalogue, create and view quotations/invoices |
| `accountant` | View quotations/invoices/catalogue (read-only) |

Every restriction is enforced server-side (not just hidden in the UI) —
each API route checks the role on the request's token.

### First login

A bootstrap `admin` account is created automatically the first time the
app starts against an empty database:

- Username: `admin`
- Password: `admin123`

(Override via the `ADMIN_USERNAME` / `ADMIN_PASSWORD` env vars, read only
during that first bootstrap.) From then on, manage accounts from the
**Users** section — there's no code-level password to change later.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string. On Railway, set this to `${{Postgres.DATABASE_URL}}` to reference the project's Postgres service. |
| `AUTH_SECRET` | Recommended | Secret used to sign login tokens. Falls back to an insecure dev default if unset — set a real value in production. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | No | Override the hardcoded login. |
| `PGSSL` | No | Set to `disable` to turn off SSL for a local Postgres. Defaults to Railway-friendly SSL (`rejectUnauthorized: false`). |
| `COMPANY_NAME` / `COMPANY_GSTIN` / `COMPANY_ADDRESS` | No | Printed on every quotation/invoice PDF header. `COMPANY_NAME` defaults to "DIL Computers"; the other two are blank (omitted from the PDF) if unset. |

## Local development

```bash
npm install

# Point at a local or remote Postgres
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/dil_dev"
export PGSSL=disable   # only needed for a local, non-SSL Postgres

# Create the products table and load server/data/product_catalogue.csv
# (safe to re-run — it skips seeding if the table already has rows)
npm run db:seed --workspace=server

# Terminal 1 — backend on :5000
npm run dev:server

# Terminal 2 — frontend on :5173 (proxies /api to :5000)
npm run dev:client
```

Visit http://localhost:5173.

## Production build

```bash
npm install
npm run build   # builds client/dist
npm run start   # serves client/dist + the API on $PORT (default 5000)
```

Run `npm run db:seed --workspace=server` once against the production
`DATABASE_URL` before (or as part of) the first deploy.

## Deploying to Railway

This repo is set up for Railway's Nixpacks/Railpack builder
(`railway.json` at the root sets the build/start commands: `npm install &&
npm run build` then `npm run start`).

1. Push this repo to GitHub (already done if you're reading this from the
   deployed service).
2. In Railway, the service's **Variables** need:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (reference to the
     project's Postgres service)
   - `AUTH_SECRET` = any random string
3. Set the service's **Pre-Deploy Command** to `npm run db:seed --workspace=server`
   so the schema/seed step runs automatically before each deploy (it's a
   no-op after the first successful run).
4. Railway assigns `PORT` automatically — the server already reads
   `process.env.PORT`.

## What's in the database

See `server/db/schema.sql` — all three tables are created idempotently by
the seed step on every deploy.

**`products`** — seeded from `server/data/product_catalogue.csv` (columns:
`category`, `Product`, `price`, `quantity`) — 9,500 rows across 19
categories. `quantity` is live stock: invoices decrease it, purchase
orders increase it. `hsn_code`, `reorder_threshold`, `warranty_months`,
and `barcode` are set from the Product Catalogue (admin only) or in bulk
via Catalogue Import/Export; `cost_price` is set automatically from the
most recent purchase order that received the product.

| column | type |
|---|---|
| id | serial primary key |
| category | text |
| name | text |
| price | numeric(10,2) |
| quantity | integer |
| hsn_code | text, nullable |
| reorder_threshold | integer, nullable |
| cost_price | numeric(10,2), nullable |
| warranty_months | integer, nullable |
| barcode | text, nullable |
| created_at | timestamptz |

**`quotations`** and **`invoices`** — written by `POST /api/quotations`
and `POST /api/invoices` respectively. Each stores its line items as a
JSONB array (category, product name, quantity, catalogue price, final
price, HSN code, warranty months, optional per-unit serial numbers, and
whether the final price matched the catalogue), plus
`subtotal`/`gst_rate`/`gst_amount` alongside `grand_total` (now the
tax-inclusive final total — `subtotal + gst_amount`). `invoices` also
carries customer phone/address, payment method, and optional
`quotation_number`/`ticket_number` references (free text, not foreign
keys — a quotation or repair ticket can be edited or reused without
breaking old invoices that cite it). Both carry
`created_by_user_id`/`created_by_username` and an optional `customer_id`
— linking a saved customer is optional either way, so a walk-in sale with
no saved record works exactly as before.

**`amc_contracts`** — annual maintenance contracts, written by
`POST /api/amc-contracts`. Links to a saved `customer_id` (required — no
walk-in AMC contracts). Its status (`active` / `expired`) is always
derived from `end_date` vs `CURRENT_DATE`, same pattern as invoice payment
status — `cancelled` is the one state dates alone can't express, so
that's the only status actually stored as a boolean.

**`repair_tickets`** — service tickets for devices dropped off for
repair, written by `POST /api/repair-tickets`. Links to a saved
`customer_id` (required) and, optionally, an `amc_contract_id` if the
repair is covered under a contract. `status` moves through `received` →
`diagnosing` → `waiting_for_parts` → `in_repair` → `ready_for_pickup` →
`completed`/`cancelled`. `invoice_number` is a free-text reference (same
pattern as `invoices.quotation_number`) set once the repair is billed —
a ticket doesn't carry its own line items. `warranty_days` is the shop's
own warranty on the completed repair work, separate from any product
warranty.

**`credit_notes`** — returns against a specific invoice, written by
`POST /api/credit-notes`. Unlike `quotation_number`/`ticket_number`,
`invoice_id` is a real foreign key (not free text) — every return is
validated against that invoice's actual line items and whatever's already
been returned against it (summed from earlier credit notes' own `items`),
so a line can never be over-returned even across multiple partial
returns. The original invoice is never modified. Creating a credit note
increases the returned products' `quantity`, mirroring how a purchase
order increases it and an invoice decreases it.

**`suppliers`** and **`purchase_orders`** — the buying-side mirror of
`customers`/`invoices`. A PO's `items` JSONB carries category/product
name/quantity/cost price per line; creating one increases the referenced
products' `quantity` and sets their `cost_price` in the same transaction.

**`users`** — accounts, bcrypt-hashed passwords, and a `role` (`admin` /
`sales` / `accountant`). A bootstrap admin is inserted automatically the
first time the app runs against an empty `users` table (see "First login"
above); every account after that is created through the Users section.

**`customers`** — saved customer records (name, phone, email, address,
notes), written by `POST /api/customers`. `name` is the only required
field.

**`payments`** — one row per payment against an invoice, written
automatically when an invoice is created (for whatever was received at
sale time — the full total in the common case) and by
`POST /api/invoices/:id/payments` for anything recorded later. An
invoice's status (`paid` / `partial` / `unpaid`) is always computed from
`SUM(payments.amount)` vs `invoices.grand_total` — never stored — so it
can't drift out of sync with the payments actually on record.

**`audit_log`** — one row per tracked action (`user.create`, `user.update`,
`quotation.create`, `invoice.create`, `customer.create`, `customer.update`,
`payment.record`, `product.update`, `supplier.create`, `supplier.update`,
`purchase_order.create`, `amc_contract.create`, `amc_contract.update`,
`repair_ticket.create`, `repair_ticket.update`, `credit_note.create`,
`product.bulk_import`), who did it, and a small JSON detail snapshot. `user_id` is nullable (`ON DELETE SET NULL`) so
deleting an account, if that's ever added, wouldn't take its history with
it — `username` is kept alongside as a permanent snapshot either way.
