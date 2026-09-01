# DIL Computers App

React (Vite) frontend + Node/Express backend, backed by Postgres. Ships a
login screen with a hardcoded account, and — once logged in — a searchable,
paginated view of the product catalogue.

- Username: `admin`
- Password: `admin123`

(Override via the `ADMIN_USERNAME` / `ADMIN_PASSWORD` env vars without
touching code.)

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

A single `products` table (see `server/db/schema.sql`):

| column | type |
|---|---|
| id | serial primary key |
| category | text |
| name | text |
| price | numeric(10,2) |
| quantity | integer |
| created_at | timestamptz |

Seeded from `server/data/product_catalogue.csv` (columns: `category`,
`Product`, `price`, `quantity`) — 9,500 rows across 19 categories.
