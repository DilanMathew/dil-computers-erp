// Idempotent migrate + seed: creates the products table if missing, and
// loads server/data/product_catalogue.csv into it only if the table is
// currently empty. Safe to run on every deploy (via preDeployCommand).

const fs = require('fs')
const path = require('path')
const { parse } = require('csv-parse/sync')
const pool = require('./pool')

const SCHEMA_PATH = path.join(__dirname, 'schema.sql')
const CSV_PATH = path.join(__dirname, '..', 'data', 'product_catalogue.csv')
const BATCH_SIZE = 500

async function ensureSchema(client) {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8')
  await client.query(sql)
}

async function countProducts(client) {
  const { rows } = await client.query('SELECT COUNT(*)::int AS count FROM products')
  return rows[0].count
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
