# DIL Computers App

React (Vite) frontend + Node/Express backend, backed by Postgres. Ships a
login screen backed by real (multi-user, role-based) accounts, and — once
logged in — a dashboard with a left-hand sidebar, grouped by area, showing
only the sections your role can use:

- **Overview** *(all roles)* — the landing tab: sales this month,
  outstanding receivables, low-stock item count, open repair ticket count,
  and active AMC contracts (with a call-out for any expiring within 30
  days), plus the 5 most recent invoices. All figures are computed live
  from the same data the other sections show — nothing here is a separate
  stored total that could drift.
- **Customer Insights** *(admin only)* — a ranked leaderboard of every
  customer with at least one invoice: total spend, invoice count, average
  order value, last purchase date, outstanding balance, and a computed
  **health badge** (Good / Watch / Risk) based on overdue amounts and
  payment-lateness history. Sort by spend, frequency, recency (who's gone
  quiet), or risk; filter to a **follow-up queue** — customers with an
  overdue balance, an AMC contract expiring within 30 days, or who
  haven't bought in twice their usual gap. Expand a row for the full
  picture: customer-since date, average days between purchases, average
  days to pay in full, late-payment count, return value, repair ticket
  count, active AMC contracts, most-purchased products, a manual tag
  (e.g. "VIP", "Do not extend credit" — a person's override sitting
  alongside the computed badge, not replacing it), and the full invoice
  history with a **re-download PDF** button per invoice (regenerated on
  demand from the stored invoice data — nothing is saved as a file at
  creation time). Every metric is computed live from
  invoices/payments/credit notes/repair tickets/AMC contracts — nothing
  here is a separately stored total that could drift. "Late" is a
  30-day proxy against `invoice_date`, since there's no due-date/credit-
  terms concept yet — good enough to flag risk, not a precise SLA.
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
  code, reorder threshold, warranty (in months — held on the product, not
  copied onto the line items of a sale, so Warranty Lookup reads the
  current value rather than what it was when the item sold),
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
- **Warranty Lookup** *(admin, sales, accountant)* — scan or type a serial
  number to see the sale it came from (invoice, date, customer, phone),
  whether it's still under warranty, and any repair tickets recorded
  against the same serial. Built entirely from data already captured:
  the per-unit serials entered on an invoice line, the product's
  warranty period, and repair tickets' serial numbers. The search box
  takes an Enter keypress, so a USB barcode scanner works directly.
  Matching is exact first (index-backed) and falls back to
  case-insensitive, since a serial read off a label by hand often differs
  in case from how it was typed at the till. Two caveats worth knowing:
  a serial is only findable if it was entered on the invoice line at the
  time of sale, and the warranty length shown is the product's *current*
  catalogue setting — the sale doesn't record what it was at the time, so
  changing a product's warranty changes what past sales report.
- **Staff Monitoring** *(admin, accountant)* — the HR roster: total staff
  count, each person's position, salary, and earned leave balance
  (a plain stored balance, admin-adjustable — not a full accrual/request
  workflow). Admin can add staff members and edit any field; accountant
  sees it all read-only. Independent of login accounts — not every
  employee needs system access, and this roster tracks all of them
  (technicians, sales reps, etc.), not just the ones who log in.
- **Payroll & Compensation** *(admin, accountant)* — a running record of
  what's actually been paid: salary, bonus, and reimbursement amounts per
  payment, against a staff member and a pay period. Admin records new
  payments; accountant views the full history read-only. Each staff
  member's own row in Staff Monitoring also shows their payroll history.
- **Users** *(admin only)* — create accounts, assign roles (`admin` /
  `sales` / `accountant` / `staff`), deactivate/reactivate accounts, reset
  passwords. An admin can't deactivate or demote their own account (so
  there's always at least one working admin).
- **Audit Log** *(admin only)* — who created which quotation/invoice/
  customer/user/payment/repair ticket/AMC contract/credit note/bulk
  import/staff record/payroll record and when, most recent first.

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
| `admin` | Everything, including Users, the Audit Log, and HR/payroll editing |
| `sales` | Browse the catalogue, create and view quotations/invoices/etc. |
| `accountant` | View quotations/invoices/catalogue/HR/payroll (read-only) |
| `staff` | Create-only: quotations and purchase orders. No list/view access to those or anything else |
| `technician` | Exactly one screen ("My Jobs") — only the repair tickets assigned to them, with a one-tap on-site billing action. The narrowest role in the app |

Every restriction is enforced server-side (not just hidden in the UI) —
each API route checks the role on the request's token. `staff` in
particular is enforced at the API level, not just by hiding sidebar
tabs: `GET /api/quotations` and `GET /api/purchase-orders` explicitly
exclude it, so even a direct API call can't browse those lists.
`technician` is scoped the same way but by row, not just by route: every
repair-ticket query is filtered server-side to `assigned_to_username =
<their own username>` (from the token, never a client-supplied filter),
and a ticket that isn't theirs 404s rather than 403s, so a technician
can't even confirm another technician's ticket exists by guessing its id.

### On-site field service ("My Jobs")

A `technician` logs in to a single screen listing only their assigned
repair tickets. For each one they can:

- Open the customer's address in Google Maps (a plain
  `maps.google.com/search?query=...` deep link built from the saved
  customer address — no GPS tracking, no paid mapping API).
- Move the ticket's status along (e.g. "diagnosing" → "in repair") — the
  only field a technician's `PATCH` on a ticket may touch; sending
  anything else is a 403.
- **Bill the job on the spot**, in one action
  (`POST /api/repair-tickets/:id/bill`) that logs hours worked and/or
  parts fitted, generates the invoice, records the payment, decrements
  stock for any parts used, and marks the ticket completed — all in a
  single database transaction, so there's no window between finishing
  the work and the payment being on record.

This is deliberately designed so a technician can never pocket the
difference between what a customer paid and what gets recorded:

- **A technician never enters or edits a price.** Labor is priced
  automatically at a fixed shop-wide rate (`LABOR_RATE_PER_HOUR`) times
  the hours they log; parts are always priced at the live catalogue
  price, looked up fresh on the server at billing time — never something
  the technician types in.
- **No separate "delivery challan" step or float period.** Earlier
  workflows for handing a technician spare parts (issue a DC, technician
  collects the part, bills later) create a gap where a part or payment
  can go unaccounted for. Here, picking a part *is* billing it — stock
  and the invoice update together, immediately, with no intermediate
  document to lose track of.
- Every bill action is written to the **Audit Log** (`repair_ticket.bill`,
  with the technician's username, the invoice total, hours, and part
  count) — the existing audit trail doubles as the reconciliation record
  for what each technician actually billed.

Staff/admin assign a technician to a ticket from **Create Repair
Ticket** or **Repair Tickets** (a dropdown fed by
`GET /api/technicians`, admin/sales only — the account list `users`
doesn't need to be exposed just to populate this).

A service call often comes from someone who isn't on file yet, so
**Create Repair Ticket** doesn't require a saved customer: type a name
the search doesn't match and a panel appears for their phone and
address, and that customer is created alongside the ticket (one
transaction — see `repair_tickets` below). The address matters here
because it's what the technician opens in Maps, so it's offered up front
rather than left for someone to fill in later. Next time that customer
is typed they show up in the search like any other, so repeat callers
don't pile up duplicates.

### First login

A bootstrap `admin` account is created automatically the first time the
app starts against an empty database:

- Username: `admin`
- Password: `admin123`

(Override via the `ADMIN_USERNAME` / `ADMIN_PASSWORD` env vars, read only
during that first bootstrap.) From then on, manage accounts from the
**Users** section — there's no code-level password to change later.

A default `staff` demo account is also created automatically (on any
database, not just an empty one — it checks for this specific username):

- Username: `staff1`
- Password: `staff123`

It's a normal account from that point on — reset its password, deactivate
it, or change its role from **Users** like any other. The seed step won't
recreate it once it exists, so those changes stick across deploys.

Three default `technician` demo accounts are created the same way:

- Usernames: `tech1`, `tech2`, `tech3`
- Password (all three): `tech123`

Same idempotent-per-username behavior as `staff1` — each is only created
if that exact username doesn't already exist, so changing or deactivating
one through **Users** sticks across deploys/re-seeds.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string. On Railway, set this to `${{Postgres.DATABASE_URL}}` to reference the project's Postgres service. |
| `AUTH_SECRET` | Recommended | Secret used to sign login tokens. Falls back to an insecure dev default if unset — set a real value in production. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | No | Override the hardcoded login. |
| `PGSSL` | No | Set to `disable` to turn off SSL for a local Postgres. Defaults to Railway-friendly SSL (`rejectUnauthorized: false`). |
| `COMPANY_NAME` / `COMPANY_GSTIN` / `COMPANY_ADDRESS` | No | Printed on every quotation/invoice PDF header. `COMPANY_NAME` defaults to "DIL Computers"; the other two are blank (omitted from the PDF) if unset. |
| `LABOR_RATE_PER_HOUR` | No | ₹/hour rate used to price a technician's on-site labor billing (`POST /api/repair-tickets/:id/bill`). Defaults to `100`. Read-only from the client via `GET /api/company-info` — never sent by or editable from the technician's device. |

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
`customer_id` (required — but the caller doesn't have to pick an
existing one: passing a `newCustomer` object instead creates that
customer and the ticket in a single transaction, so a first-time service
call can be logged without a separate trip to the Customers section, and
a failed ticket insert can't leave a stray customer behind) and,
optionally, an `amc_contract_id` if the
repair is covered under a contract, and an `assigned_to_username` (a
technician's login — see "On-site field service" above). `status` moves
through `received` → `diagnosing` → `waiting_for_parts` → `in_repair` →
`ready_for_pickup` → `completed`/`cancelled`. `invoice_number` is a
free-text reference (same pattern as `invoices.quotation_number`) set
once the repair is billed — a ticket doesn't carry its own line items.
`warranty_days` is the shop's own warranty on the completed repair work,
separate from any product warranty. `hours_worked` and `parts_used` are
set only by the on-site billing action (`POST
/api/repair-tickets/:id/bill`) — a snapshot of what that one billing
action charged for (parts mirror invoice line-item shape: category,
name, quantity, price; labor itself isn't in `parts_used`, only
`hours_worked`), informational alongside the real record of it in
`invoices.items`.

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
`sales` / `accountant` / `staff` / `technician`). A bootstrap admin is
inserted automatically the first time the app runs against an empty
`users` table, and default `staff1`/`tech1`/`tech2`/`tech3` accounts are
inserted on any database that doesn't already have them (see "First
login" above); every account after that is created through the Users
section.

**`staff_members`** and **`payroll_records`** — the HR roster and its
payment history, written by `POST /api/staff` and `POST /api/payroll`.
`staff_members` is intentionally not tied to `users` — `user_id` is an
optional link for the (likely common) case of someone being both an
employee and a login, but neither table requires the other. A payroll
record's `total_amount` is always derived as `salary_amount +
bonus_amount + reimbursement_amount`, same "compute, don't store" pattern
as invoice payment status and AMC contract status.

**`customers`** — saved customer records (name, phone, email, address,
notes), written by `POST /api/customers`. `name` is the only required
field. `risk_tag` (nullable) is a manual, admin-set label from Customer
Insights — everything else Customer Insights shows about a customer
(spend, frequency, payment reliability, and so on) is computed on the fly
from other tables, not stored here.

**`payments`** — one row per payment against an invoice, written
automatically when an invoice is created (for whatever was received at
sale time — the full total in the common case) and by
`POST /api/invoices/:id/payments` for anything recorded later. An
invoice's status (`paid` / `partial` / `unpaid`) is always computed from
`SUM(payments.amount)` vs `invoices.grand_total` — never stored — so it
can't drift out of sync with the payments actually on record.

### Document numbers

Each document's own number (`quotations.quotation_number`,
`invoices.invoice_number`, `purchase_orders.po_number`,
`amc_contracts.contract_number`, `repair_tickets.ticket_number`,
`credit_notes.credit_note_number`) carries a unique index, so two
documents of the same type can't share a number. Trying to save a
duplicate returns a `409` naming the field rather than a generic error.

The free-text *references* between documents — `invoices.quotation_number`,
`invoices.ticket_number`, `repair_tickets.invoice_number`,
`credit_notes.invoice_number` — are deliberately **not** unique: several
documents can legitimately point at the same invoice or quotation.

New numbers come from `GET /api/next-document-number?prefix=INV`, which
checks what's already stored for that day before handing one back. The
form falls back to generating one locally if that request fails, so it
still works offline — the unique index remains the actual guarantee, not
the number handout.

The seed step adds these indexes on deploy, but a database that already
contains duplicates can't take one. Rather than fail the deploy or
silently renumber existing financial documents, it logs a warning naming
the duplicates and skips that index; resolve them (renumber the later
document of each pair) and the index is added on the next deploy.

> **Note on GST numbering:** these numbers are `PREFIX-YYYYMMDD-NNNN`
> with a random suffix, which is unique but not sequential. Indian GST
> rules are generally understood to require a *consecutive serial* number
> unique within a financial year — confirm the exact requirement with
> your accountant before relying on this format for filed invoices.

**`audit_log`** — one row per tracked action (`user.create`, `user.update`,
`quotation.create`, `invoice.create`, `customer.create`, `customer.update`,
`payment.record`, `product.update`, `supplier.create`, `supplier.update`,
`purchase_order.create`, `amc_contract.create`, `amc_contract.update`,
`repair_ticket.create`, `repair_ticket.update`, `repair_ticket.bill`,
`credit_note.create`, `product.bulk_import`, `staff.create`,
`staff.update`, `payroll.create`, `customer.tag`),
who did it, and a small JSON detail snapshot. `user_id` is nullable (`ON DELETE SET NULL`) so
deleting an account, if that's ever added, wouldn't take its history with
it — `username` is kept alongside as a permanent snapshot either way.
