# DIL Computers App

React (Vite) frontend + Node/Express backend, backed by Postgres. Ships a
login screen backed by real (multi-user, role-based) accounts, and — once
logged in — a dashboard with sections scoped to your role:

- **Create Quotation** *(admin, sales)* — pick a product category, search
  for a product by name, and set a quantity; the catalogue price
  auto-populates. Final price starts empty — tick "Same as catalogue price"
  to use the catalogue price as-is, or leave it unticked and type a
  discounted price. Add as many products as needed, then **Create
  Quotation (PDF)** saves the quotation and downloads a filled-in PDF
  (quotation #, date, customer, line items, and grand total) straight to
  your computer. Quotations do **not** affect catalogue stock — they're
  estimates, not sales.
- **Quotations** *(all roles)* — searchable, paginated list of every saved
  quotation, with an expandable row showing its line items and who created it.
- **Create Invoice** *(admin, sales)* — the same category/product/quantity/
  price picker, plus customer name (required), phone, address, payment
  method, and an optional reference to an existing quotation number
  (autocomplete). **Create Invoice (PDF)** saves the invoice, **reduces
  catalogue stock** by the quantity of each product sold, and downloads a
  PDF invoice. Stock is checked and decremented atomically — an invoice is
  refused (no partial deduction) if any line item would oversell what's left.
- **Invoices** *(all roles)* — searchable, paginated list of every saved
  invoice, with an expandable row showing customer details, line items,
  and who created it.
- **Product Catalogue** *(all roles)* — the original searchable, paginated
  view of the full product catalogue; quantities reflect stock reduced by
  invoices.
- **Users** *(admin only)* — create accounts, assign roles (`admin` /
  `sales` / `accountant`), deactivate/reactivate accounts, reset passwords.
  An admin can't deactivate or demote their own account (so there's always
  at least one working admin).
- **Audit Log** *(admin only)* — who created which quotation/invoice/user
  and when, most recent first.

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
categories. `quantity` is live stock: it only decreases, when an invoice is
created.

| column | type |
|---|---|
| id | serial primary key |
| category | text |
| name | text |
| price | numeric(10,2) |
| quantity | integer |
| created_at | timestamptz |

**`quotations`** and **`invoices`** — written by `POST /api/quotations`
and `POST /api/invoices` respectively. Each stores its line items as a
JSONB array (category, product name, quantity, catalogue price, final
price, and whether the final price matched the catalogue). `invoices` also
carries customer phone/address, payment method, and an optional
`quotation_number` reference (free text, not a foreign key — a quotation
can be edited or reused without breaking old invoices that cite it). Both
carry `created_by_user_id`/`created_by_username`, set from the logged-in
user at creation time.

**`users`** — accounts, bcrypt-hashed passwords, and a `role` (`admin` /
`sales` / `accountant`). A bootstrap admin is inserted automatically the
first time the app runs against an empty `users` table (see "First login"
above); every account after that is created through the Users section.

**`audit_log`** — one row per tracked action (`user.create`, `user.update`,
`quotation.create`, `invoice.create`), who did it, and a small JSON detail
snapshot. `user_id` is nullable (`ON DELETE SET NULL`) so deleting an
account, if that's ever added, wouldn't take its history with it —
`username` is kept alongside as a permanent snapshot either way.
