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

// Default demo account for the "staff" role (create-only access to
// quotations and purchase orders — see server/index.js). Unlike the
// bootstrap admin, this doesn't wait for an empty users table — it just
// checks for this one username and creates it if missing, so it appears
// on existing databases too. A no-op once the account exists, so it
// won't clobber a password change or deactivation made through the Users
// section afterward.
const STAFF_USERNAME = 'staff1'
const STAFF_PASSWORD = 'staff123'

async function ensureDefaultStaffAccount(client) {
  const { rows } = await client.query('SELECT id FROM users WHERE username = $1', [STAFF_USERNAME])
  if (rows.length > 0) {
    console.log(`"${STAFF_USERNAME}" account already exists — skipping.`)
    return
  }

  const passwordHash = await hashPassword(STAFF_PASSWORD)
  await client.query(
    `INSERT INTO users (username, password_hash, full_name, role)
     VALUES ($1, $2, $3, 'staff')`,
    [STAFF_USERNAME, passwordHash, 'Staff']
  )
  console.log(`Created default staff account "${STAFF_USERNAME}".`)
}

// Default demo accounts for the "technician" role (their own scoped view
// of just the repair tickets assigned to them, plus the one-tap on-site
// billing action — see server/index.js). Same idempotent-per-username
// pattern as the staff account above.
const TECHNICIAN_USERNAMES = ['tech1', 'tech2', 'tech3']
const TECHNICIAN_PASSWORD = 'tech123'

async function ensureDefaultTechnicianAccounts(client) {
  for (const username of TECHNICIAN_USERNAMES) {
    const { rows } = await client.query('SELECT id FROM users WHERE username = $1', [username])
    if (rows.length > 0) {
      console.log(`"${username}" account already exists — skipping.`)
      continue
    }

    const passwordHash = await hashPassword(TECHNICIAN_PASSWORD)
    await client.query(
      `INSERT INTO users (username, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'technician')`,
      [username, passwordHash, `Technician (${username})`]
    )
    console.log(`Created default technician account "${username}".`)
  }
}

// A document's own number identifies it — two invoices sharing one is an
// accounting problem, not just untidiness — so each gets a unique index.
//
// Only a document's OWN number is listed here. The free-text *references*
// to other documents (invoices.quotation_number, invoices.ticket_number,
// repair_tickets.invoice_number, credit_notes.invoice_number) are
// deliberately left out: those repeat by design, since several documents
// can point at the same invoice or quotation.
const UNIQUE_DOCUMENT_NUMBERS = [
  ['quotations', 'quotation_number'],
  ['invoices', 'invoice_number'],
  ['purchase_orders', 'po_number'],
  ['amc_contracts', 'contract_number'],
  ['repair_tickets', 'ticket_number'],
  ['credit_notes', 'credit_note_number'],
]

// Adds those indexes where the data allows it. A database that already
// contains duplicates can't take the index, and renumbering existing
// financial documents automatically would be the wrong call to make on
// someone's behalf — so this reports what it found and moves on, leaving
// the deploy healthy and the decision to a person.
//
// The table/column names interpolated below come only from the constant
// list above, never from user input.
async function ensureDocumentNumberUniqueness(client) {
  for (const [table, column] of UNIQUE_DOCUMENT_NUMBERS) {
    const indexName = `${table}_${column}_unique`

    const { rows: existing } = await client.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
      [indexName]
    )
    if (existing.length > 0) continue

    const { rows: duplicates } = await client.query(
      `SELECT ${column} AS value, COUNT(*)::int AS count
         FROM ${table}
        WHERE ${column} IS NOT NULL
        GROUP BY ${column}
       HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC, ${column} ASC
        LIMIT 10`
    )

    if (duplicates.length > 0) {
      const summary = duplicates.map((d) => `"${d.value}" ×${d.count}`).join(', ')
      console.warn(
        `WARNING: ${table}.${column} has duplicate values, so its unique index was NOT created: ${summary}. ` +
        `Resolve these (renumber the later document of each pair) and the index will be added on the next deploy.`
      )
      continue
    }

    await client.query(`CREATE UNIQUE INDEX ${indexName} ON ${table} (${column})`)
    console.log(`Added unique index on ${table}.${column}.`)
  }
}

// Serial-number lookup (GET /api/serial-lookup) finds a sale by matching
// inside invoices.items, which without an index means reading every
// invoice. A GIN index makes that containment search stay fast as invoices
// pile up. jsonb_path_ops is the smaller, faster variant and supports the
// @> operator, which is all this lookup uses.
async function ensureInvoiceItemsIndex(client) {
  const { rows } = await client.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'invoices_items_gin'`
  )
  if (rows.length > 0) return

  await client.query(`CREATE INDEX invoices_items_gin ON invoices USING GIN (items jsonb_path_ops)`)
  console.log('Added GIN index on invoices.items (serial-number lookup).')
}

// Import of the monthly sales registers in server/data — every file named
// <month>_<year>_sales.csv. Each row is one voucher's total.
//
// april_2026_sales.csv is real, from a Tally "Sales - GST Register" export.
// The later months are synthetic filler generated by
// server/data/generate_monthly_sales.py from April's customers, so the app
// has a year-to-date to chart; see that script's docstring.
//
// There is no product-level detail or tax split in a Tally register, so
// this records a single line item per invoice (the voucher's category)
// rather than pretending to know what was sold, and GST is backed out of
// the total at a flat 18% (confirmed with the user — the source data
// doesn't state a rate, and this app never guesses one).
//
// Idempotent per voucher number, so a re-run (e.g. a redeploy after this
// has already applied) only inserts rows that aren't there yet — safe to
// leave wired into every deploy rather than gating behind an env var. That
// also means adding a new month is just dropping its CSV in and deploying.
//
// Deliberately bypasses the live POST /api/invoices flow: that route
// requires every line item to reference a real catalogue product and
// decrements its stock, which would be wrong here — these are historical,
// already-completed sales with no per-unit inventory movement to model,
// and decrementing a placeholder product's stock hundreds of times would
// corrupt real inventory for no reason.
const SALES_DATA_DIR = path.join(__dirname, '..', 'data')
const SALES_CSV_PATTERN = /^([a-z]+)_(\d{4})_sales\.csv$/
const SALES_GST_RATE = 18

const MONTH_ORDER = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

// Oldest month first, so voucher numbers land in the order they were issued.
function monthlySalesFiles() {
  if (!fs.existsSync(SALES_DATA_DIR)) return []
  return fs.readdirSync(SALES_DATA_DIR)
    .map((file) => {
      const match = SALES_CSV_PATTERN.exec(file)
      if (!match) return null
      const monthIndex = MONTH_ORDER.indexOf(match[1])
      if (monthIndex === -1) return null
      return { file, year: Number(match[2]), monthIndex }
    })
    .filter(Boolean)
    .sort((a, b) => a.year - b.year || a.monthIndex - b.monthIndex)
    .map((entry) => path.join(SALES_DATA_DIR, entry.file))
}

async function importMonthlySales(client) {
  const files = monthlySalesFiles()
  if (files.length === 0) return

  const rows = files.flatMap((file) => parse(
    fs.readFileSync(file, 'utf8'),
    { columns: true, skip_empty_lines: true, trim: true }
  ))

  const { rows: adminRows } = await client.query(
    `SELECT id, username FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`
  )
  const admin = adminRows[0] || null

  const customerIdByName = new Map()
  let invoicesCreated = 0
  let customersCreated = 0
  let skipped = 0
  let revenueImported = 0

  await client.query('BEGIN')
  try {
    for (const row of rows) {
      const voucherNo = row.voucher_no.trim()

      const { rows: existing } = await client.query(
        'SELECT 1 FROM invoices WHERE invoice_number = $1',
        [voucherNo]
      )
      if (existing.length > 0) {
        skipped += 1
        continue
      }

      const name = row.customer_name.trim()
      let customerId = customerIdByName.get(name)
      if (customerId === undefined) {
        const { rows: existingCust } = await client.query(
          'SELECT id FROM customers WHERE name = $1',
          [name]
        )
        if (existingCust.length > 0) {
          customerId = existingCust[0].id
        } else {
          const { rows: newCust } = await client.query(
            `INSERT INTO customers (name, created_by_user_id, created_by_username)
             VALUES ($1, $2, $3) RETURNING id`,
            [name, admin?.id ?? null, admin?.username ?? null]
          )
          customerId = newCust[0].id
          customersCreated += 1
        }
        customerIdByName.set(name, customerId)
      }

      const grandTotal = Math.round(Number(row.amount) * 100) / 100
      const subtotal = Math.round((grandTotal / (1 + SALES_GST_RATE / 100)) * 100) / 100
      const gstAmount = Math.round((grandTotal - subtotal) * 100) / 100
      const label = row.label.trim()
      const items = [{
        productId: null,
        category: row.category.trim(),
        name: label,
        quantity: 1,
        catalPrice: subtotal,
        finalPrice: subtotal,
        sameAsCatalogue: true,
      }]

      const { rows: invRows } = await client.query(
        `INSERT INTO invoices
           (invoice_number, invoice_date, customer_name, customer_id, items,
            subtotal, gst_rate, gst_amount, grand_total,
            created_by_user_id, created_by_username)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          voucherNo, row.date, name, customerId, JSON.stringify(items),
          subtotal, SALES_GST_RATE, gstAmount, grandTotal,
          admin?.id ?? null, admin?.username ?? null,
        ]
      )

      // Recorded as paid in full — a Tally sales register reflects issued,
      // recognized invoices, and there's no separate receipts sheet here
      // to say otherwise. Payment method isn't in the source data either,
      // so it's left blank rather than guessed.
      await client.query(
        `INSERT INTO payments (invoice_id, amount, payment_date, created_by_user_id, created_by_username)
         VALUES ($1, $2, $3, $4, $5)`,
        [invRows[0].id, grandTotal, row.date, admin?.id ?? null, admin?.username ?? null]
      )

      invoicesCreated += 1
      revenueImported += grandTotal
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }

  const registers = `${files.length} monthly register(s)`
  if (invoicesCreated === 0 && skipped > 0) {
    console.log(`Monthly sales already imported (${skipped} invoices present across ${registers}) — skipping.`)
  } else {
    console.log(
      `Imported ${invoicesCreated} invoice(s) from ${registers} `
      + `(${customersCreated} new customer(s), ${skipped} already present), `
      + `totalling ₹${revenueImported.toFixed(2)}.`
    )
  }
}

// --- Temporary demo data for trying out Customer Insights against the
// live app. Guarded by env vars so it never runs by default; every row it
// creates is unmistakably prefixed "[TEST] " so it's easy to spot and
// fully reversible via CLEANUP_SAMPLE_DATA. Not meant to stay in the
// codebase indefinitely — remove once the demo has served its purpose.

const SAMPLE_MARKER = '[TEST]'

async function seedSampleCustomerData(client) {
  const { rows: existing } = await client.query(
    `SELECT id FROM customers WHERE name LIKE $1 LIMIT 1`,
    [`${SAMPLE_MARKER}%`]
  )
  if (existing.length > 0) {
    console.log('Sample [TEST] customer data already present — skipping.')
    return
  }

  const { rows: products } = await client.query(
    `SELECT id, category, name, price FROM products WHERE quantity > 50 ORDER BY id ASC LIMIT 2`
  )
  if (products.length < 2) {
    console.log('Not enough well-stocked products to seed sample customer data — skipping.')
    return
  }
  const [p1, p2] = products

  async function makeCustomer(name, phone) {
    const { rows } = await client.query(
      `INSERT INTO customers (name, phone) VALUES ($1, $2) RETURNING id`,
      [name, phone]
    )
    return rows[0].id
  }

  async function makeInvoice({ invoiceNumber, invoiceDate, customerId, customerName, items, amountReceived, paymentDate }) {
    const subtotal = items.reduce((sum, it) => sum + it.finalPrice * it.quantity, 0)
    const { rows } = await client.query(
      `INSERT INTO invoices (invoice_number, invoice_date, customer_name, customer_id, items, subtotal, grand_total)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING id`,
      [invoiceNumber, invoiceDate, customerName, customerId, JSON.stringify(items), subtotal]
    )
    const invoiceId = rows[0].id
    for (const item of items) {
      await client.query('UPDATE products SET quantity = quantity - $1 WHERE id = $2', [item.quantity, item.productId])
    }
    if (amountReceived > 0) {
      await client.query(
        'INSERT INTO payments (invoice_id, amount, payment_date) VALUES ($1, $2, $3)',
        [invoiceId, amountReceived, paymentDate || invoiceDate]
      )
    }
    return invoiceId
  }

  const lineItem = (product, quantity, finalPrice) => ({
    productId: product.id, category: product.category, name: product.name,
    quantity, catalPrice: Number(product.price), finalPrice, sameAsCatalogue: false,
  })

  // 1. VIP — frequent, high-spend, always pays promptly → "Good" badge, tops spend/frequency sorts.
  const vipId = await makeCustomer(`${SAMPLE_MARKER} VIP Frequent Buyer`, '9000000001')
  for (const [date, amt] of [['2026-03-05', 1200], ['2026-05-01', 950], ['2026-07-01', 1400], ['2026-08-25', 1100]]) {
    await makeInvoice({
      invoiceNumber: `TEST-VIP-${date}`, invoiceDate: date, customerId: vipId, customerName: `${SAMPLE_MARKER} VIP Frequent Buyer`,
      items: [lineItem(p1, 1, amt)], amountReceived: amt, paymentDate: date,
    })
  }
  await client.query(`UPDATE customers SET risk_tag = 'VIP' WHERE id = $1`, [vipId])

  // 2. Two old, fully unpaid invoices → "Risk" badge, tops the risk sort and follow-up queue.
  const overdueId = await makeCustomer(`${SAMPLE_MARKER} Overdue Risk Customer`, '9000000002')
  for (const [date, amt] of [['2026-06-01', 300], ['2026-06-20', 450]]) {
    await makeInvoice({
      invoiceNumber: `TEST-OVERDUE-${date}`, invoiceDate: date, customerId: overdueId, customerName: `${SAMPLE_MARKER} Overdue Risk Customer`,
      items: [lineItem(p1, 1, amt)], amountReceived: 0,
    })
  }

  // 3. One invoice paid ~49 days late, one paid promptly → "Watch" badge.
  const lateId = await makeCustomer(`${SAMPLE_MARKER} Occasional Late Payer`, '9000000003')
  await makeInvoice({
    invoiceNumber: 'TEST-LATE-001', invoiceDate: '2026-04-01', customerId: lateId, customerName: `${SAMPLE_MARKER} Occasional Late Payer`,
    items: [lineItem(p1, 1, 500)], amountReceived: 500, paymentDate: '2026-05-20',
  })
  await makeInvoice({
    invoiceNumber: 'TEST-LATE-002', invoiceDate: '2026-08-01', customerId: lateId, customerName: `${SAMPLE_MARKER} Occasional Late Payer`,
    items: [lineItem(p2, 1, 300)], amountReceived: 300, paymentDate: '2026-08-02',
  })

  // 4. Regular ~30-day cadence for 3 purchases, then nothing for ~8 months →
  // "gone quiet" follow-up trigger (fully paid, so no overdue/risk signal on its own).
  const quietId = await makeCustomer(`${SAMPLE_MARKER} Gone Quiet Customer`, '9000000004')
  for (const date of ['2025-11-01', '2025-12-01', '2026-01-01']) {
    await makeInvoice({
      invoiceNumber: `TEST-QUIET-${date}`, invoiceDate: date, customerId: quietId, customerName: `${SAMPLE_MARKER} Gone Quiet Customer`,
      items: [lineItem(p1, 1, 400)], amountReceived: 400, paymentDate: date,
    })
  }

  // 5. Active AMC contract expiring soon → follow-up trigger via that condition.
  const amcId = await makeCustomer(`${SAMPLE_MARKER} AMC Expiring Customer`, '9000000005')
  await makeInvoice({
    invoiceNumber: 'TEST-AMC-001', invoiceDate: '2026-08-01', customerId: amcId, customerName: `${SAMPLE_MARKER} AMC Expiring Customer`,
    items: [lineItem(p2, 1, 600)], amountReceived: 600, paymentDate: '2026-08-01',
  })
  await client.query(
    `INSERT INTO amc_contracts (contract_number, customer_id, start_date, end_date, amount)
     VALUES ($1, $2, $3, $4, $5)`,
    ['TEST-AMC-CONTRACT-001', amcId, '2026-01-01', '2026-09-20', 2000]
  )

  // 6. A credit note against one of their invoices → shows up as return value.
  const returnId = await makeCustomer(`${SAMPLE_MARKER} Returner Customer`, '9000000006')
  const returnInvoiceId = await makeInvoice({
    invoiceNumber: 'TEST-RETURN-001', invoiceDate: '2026-08-10', customerId: returnId, customerName: `${SAMPLE_MARKER} Returner Customer`,
    items: [lineItem(p1, 2, 300)], amountReceived: 600, paymentDate: '2026-08-10',
  })
  await client.query('UPDATE products SET quantity = quantity + 1 WHERE id = $1', [p1.id])
  await client.query(
    `INSERT INTO credit_notes (credit_note_number, invoice_id, invoice_number, customer_name, items, subtotal, grand_total)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    ['TEST-CN-001', returnInvoiceId, 'TEST-RETURN-001', `${SAMPLE_MARKER} Returner Customer`,
      JSON.stringify([{ productId: p1.id, category: p1.category, name: p1.name, quantity: 1, finalPrice: 300 }]), 300]
  )

  // 7. A completed repair ticket, billed as an invoice → repair-history cross-sell signal.
  const repairId = await makeCustomer(`${SAMPLE_MARKER} Repair History Customer`, '9000000007')
  await client.query(
    `INSERT INTO repair_tickets (ticket_number, customer_id, device_description, reported_issue, status, received_date, completed_date)
     VALUES ($1, $2, $3, $4, 'completed', $5, $6)`,
    ['TEST-TICKET-001', repairId, 'Test laptop', 'Test issue', '2026-07-01', '2026-07-03']
  )
  await makeInvoice({
    invoiceNumber: 'TEST-REPAIR-001', invoiceDate: '2026-07-03', customerId: repairId, customerName: `${SAMPLE_MARKER} Repair History Customer`,
    items: [lineItem(p2, 1, 800)], amountReceived: 800, paymentDate: '2026-07-03',
  })

  console.log('Seeded sample [TEST] customer data for the Customer Insights demo.')
}

async function cleanupSampleCustomerData(client) {
  const { rows: testCustomers } = await client.query(
    `SELECT id FROM customers WHERE name LIKE $1`,
    [`${SAMPLE_MARKER}%`]
  )
  if (testCustomers.length === 0) {
    console.log('No sample [TEST] customer data found — nothing to clean up.')
    return
  }
  const ids = testCustomers.map((r) => r.id)

  // Reverse every stock effect before deleting the rows that caused it —
  // invoices decremented stock, the one credit note incremented it back.
  const { rows: testInvoices } = await client.query('SELECT id, items FROM invoices WHERE customer_id = ANY($1)', [ids])
  for (const inv of testInvoices) {
    for (const item of inv.items || []) {
      if (item.productId) {
        await client.query('UPDATE products SET quantity = quantity + $1 WHERE id = $2', [item.quantity, item.productId])
      }
    }
  }
  const { rows: testCreditNotes } = await client.query(
    `SELECT cn.items FROM credit_notes cn JOIN invoices i ON i.id = cn.invoice_id WHERE i.customer_id = ANY($1)`,
    [ids]
  )
  for (const cn of testCreditNotes) {
    for (const item of cn.items || []) {
      if (item.productId) {
        await client.query('UPDATE products SET quantity = quantity - $1 WHERE id = $2', [item.quantity, item.productId])
      }
    }
  }

  await client.query('DELETE FROM credit_notes WHERE invoice_id IN (SELECT id FROM invoices WHERE customer_id = ANY($1))', [ids])
  await client.query('DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE customer_id = ANY($1))', [ids])
  await client.query('DELETE FROM repair_tickets WHERE customer_id = ANY($1)', [ids])
  await client.query('DELETE FROM amc_contracts WHERE customer_id = ANY($1)', [ids])
  await client.query('DELETE FROM invoices WHERE customer_id = ANY($1)', [ids])
  await client.query('DELETE FROM quotations WHERE customer_id = ANY($1)', [ids])
  await client.query('DELETE FROM customers WHERE id = ANY($1)', [ids])

  console.log(`Cleaned up ${ids.length} sample [TEST] customer(s) and all related records; stock restored.`)
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
    await ensureDefaultStaffAccount(client)
    await ensureDefaultTechnicianAccounts(client)
    await ensureDocumentNumberUniqueness(client)
    await ensureInvoiceItemsIndex(client)
    await importMonthlySales(client)

    if (process.env.CLEANUP_SAMPLE_DATA === 'true') {
      await cleanupSampleCustomerData(client)
    } else if (process.env.SEED_SAMPLE_DATA === 'true') {
      await seedSampleCustomerData(client)
    }

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
