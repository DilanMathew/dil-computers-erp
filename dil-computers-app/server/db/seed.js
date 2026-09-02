// Idempotent migrate + seed: creates the products table if missing, and
// loads server/data/product_catalogue.csv into it only if the table is
// currently empty. Safe to run on every deploy (via preDeployCommand).

const fs = require('fs')
const path = require('path')
const { parse } = require('csv-parse/sync')
const pool = require('./pool')
const { hashPassword } = require('../auth')

const SCHEMA_PATH = path.join(__dirname, 'schema.sql')
const CSV_PATH = path.join(__dirname, '..', 'data', 'product_catalogue.csv')
const BATCH_SIZE = 500

// Same defaults index.js falls back to when these env vars aren't set —
// kept in sync so "day one" login still works without extra setup.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'

const REQUIRED_COLUMNS = ['category', 'name', 'price', 'quantity']

async function ensureSchema(client) {
  // A "products" table may already exist in this database from something
  // other than this app. Check its shape before assuming our schema applies.
  const { rows: existingColumns } = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products'`
  )

  if (existingColumns.length > 0) {
    const cols = new Set(existingColumns.map((r) => r.column_name))
    const missing = REQUIRED_COLUMNS.filter((c) => !cols.has(c))

    if (missing.length > 0) {
      const { rows: countRows } = await client.query('SELECT COUNT(*)::int AS count FROM products')
      const count = countRows[0].count
      console.warn(
        `Existing "products" table has an incompatible schema. ` +
          `Current columns: [${[...cols].join(', ')}]. Missing: [${missing.join(', ')}].`
      )

      if (count > 0) {
        // Dump the actual content so whoever reads the deploy log can see
        // exactly what's there before anything gets touched.
        const { rows: sample } = await client.query('SELECT * FROM products LIMIT 20')
        console.warn(`Sample of existing "products" rows (${count} total):`)
        console.warn(JSON.stringify(sample, null, 2))
      }

      if (count === 0) {
        console.warn('Table is empty — dropping and recreating with the expected schema.')
        await client.query('DROP TABLE products')
      } else if (process.env.FORCE_RESET_PRODUCTS === 'true') {
        console.warn(
          'FORCE_RESET_PRODUCTS=true — dropping the existing table (see sample above) and recreating.'
        )
        await client.query('DROP TABLE products')
      } else {
        throw new Error(
          `"products" table already exists with ${count} row(s) but an incompatible schema ` +
            `(missing columns: ${missing.join(', ')}). Refusing to modify it automatically — ` +
            `review the sample rows logged above, then set FORCE_RESET_PRODUCTS=true and redeploy ` +
            `if it's safe to discard, or migrate it by hand otherwise.`
        )
      }
    }
  }

  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8')
  await client.query(sql)
}

async function countProducts(client) {
  const { rows } = await client.query('SELECT COUNT(*)::int AS count FROM products')
  return rows[0].count
}

// Bootstrap a first admin account so there's always a way in. No-ops once
// any user exists — from then on, user management happens through the app.
async function ensureBootstrapAdmin(client) {
  const { rows } = await client.query('SELECT COUNT(*)::int AS count FROM users')
  if (rows[0].count > 0) {
    console.log(`users table already has ${rows[0].count} account(s) — skipping bootstrap admin.`)
    return
  }

  const passwordHash = await hashPassword(ADMIN_PASSWORD)
  await client.query(
    `INSERT INTO users (username, password_hash, full_name, role)
     VALUES ($1, $2, $3, 'admin')`,
    [ADMIN_USERNAME, passwordHash, 'Administrator']
  )
  console.log(`Created bootstrap admin account "${ADMIN_USERNAME}".`)
}

function loadCsvRows() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8')
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true })
  return records.map((r) => ({
    category: r.category,
    name: r.Product,
    price: Number(r.price),
    quantity: parseInt(r.quantity, 10),
  }))
}

async function seedProducts(client, rows) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const values = []
    const placeholders = batch
      .map((row, idx) => {
        const base = idx * 4
        values.push(row.category, row.name, row.price, row.quantity)
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`
      })
      .join(', ')

    await client.query(
      `INSERT INTO products (category, name, price, quantity) VALUES ${placeholders}`,
      values
    )
    console.log(`Seeded ${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length} products`)
  }
}

async function main() {
  const client = await pool.connect()
  try {
    console.log('Ensuring products schema exists...')
    await ensureSchema(client)

    await ensureBootstrapAdmin(client)

    const existing = await countProducts(client)
    if (existing > 0) {
      console.log(`products table already has ${existing} rows — skipping seed.`)
      return
    }

    console.log('Loading catalogue CSV...')
    const rows = loadCsvRows()
    console.log(`Parsed ${rows.length} products from CSV. Inserting...`)

    await client.query('BEGIN')
    await seedProducts(client, rows)
    await client.query('COMMIT')

    console.log('Seed complete.')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('Seed failed:', err)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
