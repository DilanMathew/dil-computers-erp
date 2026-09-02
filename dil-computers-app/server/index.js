const path = require('path')
const express = require('express')
const pool = require('./db/pool')
const { issueToken, requireAuth } = require('./auth')

const app = express()
const PORT = process.env.PORT || 5000

// Credentials for now are hardcoded as requested. Can be overridden with
// env vars (ADMIN_USERNAME / ADMIN_PASSWORD) without touching code.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'

const SORTABLE_COLUMNS = new Set(['name', 'category', 'price', 'quantity'])

app.use(express.json())

// Shared validation for the line items on a quotation or invoice. Returns
// { ok: true, items: <normalized items> } or { ok: false, message }.
// Pass requireProductId: true for invoices, since stock is decremented
// against a specific products.id.
function validateLineItems(rawItems, { requireProductId = false } = {}) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { ok: false, message: 'At least one line item is required' }
  }

  const items = []
  for (const raw of rawItems) {
    const category = typeof raw?.category === 'string' ? raw.category.trim() : ''
    const name = typeof raw?.name === 'string' ? raw.name.trim() : ''
    const quantity = Number(raw?.quantity)
    const catalPrice = Number(raw?.catalPrice)
    const finalPrice = Number(raw?.finalPrice)
    const productId = Number.isInteger(raw?.productId) ? raw.productId : parseInt(raw?.productId, 10)

    if (!category || !name) {
      return { ok: false, message: 'Each line item needs a category and product name' }
    }
    if (requireProductId && (!Number.isInteger(productId) || productId <= 0)) {
      return { ok: false, message: `Missing catalogue reference for "${name}" — re-add it from the picker.` }
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, message: `Invalid quantity for "${name}"` }
    }
    if (!Number.isFinite(catalPrice) || catalPrice < 0) {
      return { ok: false, message: `Invalid catalogue price for "${name}"` }
    }
    if (!Number.isFinite(finalPrice) || finalPrice < 0) {
      return { ok: false, message: `Invalid final price for "${name}"` }
    }

    items.push({
      productId: Number.isInteger(productId) && productId > 0 ? productId : null,
      category,
      name,
      quantity,
      catalPrice,
      finalPrice,
      sameAsCatalogue: Boolean(raw?.sameAsCatalogue),
    })
  }

  return { ok: true, items }
}

function computeGrandTotal(items) {
  return items.reduce((sum, item) => sum + item.finalPrice * item.quantity, 0)
}

function isValidDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {}

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = issueToken(username)
    return res.json({ token })
  }

  return res.status(401).json({ message: 'Invalid username or password' })
})

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.get('/api/categories', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT category, COUNT(*)::int AS count FROM products GROUP BY category ORDER BY category ASC'
    )
    res.json({ categories: rows })
  } catch (err) {
    console.error('GET /api/categories failed:', err)
    res.status(500).json({ message: 'Could not load categories' })
  }
})

app.get('/api/products', requireAuth, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 1), 200)
    const offset = (page - 1) * pageSize

    const sortColumn = SORTABLE_COLUMNS.has(req.query.sort) ? req.query.sort : 'name'
    const sortDir = req.query.dir === 'desc' ? 'DESC' : 'ASC'

    const conditions = []
    const params = []

    if (req.query.category) {
      params.push(req.query.category)
      conditions.push(`category = $${params.length}`)
    }

    if (req.query.q) {
      params.push(`%${req.query.q}%`)
      conditions.push(`name ILIKE $${params.length}`)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM products ${where}`,
      params
    )
    const total = countResult.rows[0].total

    params.push(pageSize)
    params.push(offset)
    const itemsResult = await pool.query(
      `SELECT id, category, name, price, quantity
       FROM products
       ${where}
       ORDER BY ${sortColumn} ${sortDir}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    res.json({
      items: itemsResult.rows,
      total,
      page,
      pageSize,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
    })
  } catch (err) {
    console.error('GET /api/products failed:', err)
    res.status(500).json({ message: 'Could not load products' })
  }
})

app.post('/api/quotations', requireAuth, async (req, res) => {
  try {
    const { quotationNumber, quotationDate, customerName, items: rawItems } = req.body || {}

    const number = typeof quotationNumber === 'string' ? quotationNumber.trim() : ''
    if (!number) {
      return res.status(400).json({ message: 'Quotation number is required' })
    }
    if (!isValidDateString(quotationDate)) {
      return res.status(400).json({ message: 'A valid quotation date (YYYY-MM-DD) is required' })
    }

    const validation = validateLineItems(rawItems)
    if (!validation.ok) {
      return res.status(400).json({ message: validation.message })
    }

    const grandTotal = computeGrandTotal(validation.items)
    const customer = typeof customerName === 'string' && customerName.trim() ? customerName.trim() : null

    const { rows } = await pool.query(
      `INSERT INTO quotations (quotation_number, quotation_date, customer_name, items, grand_total)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, quotation_number, quotation_date, customer_name, items, grand_total, created_at`,
      [number, quotationDate, customer, JSON.stringify(validation.items), grandTotal]
    )

    res.status(201).json({ quotation: rows[0] })
  } catch (err) {
    console.error('POST /api/quotations failed:', err)
    res.status(500).json({ message: 'Could not save quotation' })
  }
})

// Paginated + searchable, same shape as GET /api/invoices. Also used
// (with a small pageSize and no page) as a lightweight lookup for the
// "reference quotation #" autocomplete on the invoice form.
app.get('/api/quotations', requireAuth, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100)
    const offset = (page - 1) * pageSize

    const params = []
    let where = ''
    if (req.query.q) {
      params.push(`%${req.query.q}%`)
      where = `WHERE quotation_number ILIKE $${params.length} OR customer_name ILIKE $${params.length}`
    }

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM quotations ${where}`, params)
    const total = countResult.rows[0].total

    params.push(pageSize)
    params.push(offset)
    const itemsResult = await pool.query(
      `SELECT id, quotation_number, quotation_date, customer_name, items, grand_total, created_at
       FROM quotations
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    res.json({
      items: itemsResult.rows,
      total,
      page,
      pageSize,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
    })
  } catch (err) {
    console.error('GET /api/quotations failed:', err)
    res.status(500).json({ message: 'Could not load quotations' })
  }
})

app.post('/api/invoices', requireAuth, async (req, res) => {
  const client = await pool.connect()
  try {
    const {
      invoiceNumber,
      invoiceDate,
      customerName,
      customerPhone,
      customerAddress,
      paymentMethod,
      quotationNumber,
      items: rawItems,
    } = req.body || {}

    const number = typeof invoiceNumber === 'string' ? invoiceNumber.trim() : ''
    if (!number) {
      return res.status(400).json({ message: 'Invoice number is required' })
    }
    if (!isValidDateString(invoiceDate)) {
      return res.status(400).json({ message: 'A valid invoice date (YYYY-MM-DD) is required' })
    }
    const customer = typeof customerName === 'string' ? customerName.trim() : ''
    if (!customer) {
      return res.status(400).json({ message: 'Customer name is required' })
    }

    const validation = validateLineItems(rawItems, { requireProductId: true })
    if (!validation.ok) {
      return res.status(400).json({ message: validation.message })
    }

    const grandTotal = computeGrandTotal(validation.items)
    const phone = typeof customerPhone === 'string' && customerPhone.trim() ? customerPhone.trim() : null
    const address = typeof customerAddress === 'string' && customerAddress.trim() ? customerAddress.trim() : null
    const payment = typeof paymentMethod === 'string' && paymentMethod.trim() ? paymentMethod.trim() : null
    const refQuotation =
      typeof quotationNumber === 'string' && quotationNumber.trim() ? quotationNumber.trim() : null

    await client.query('BEGIN')

    // Reduce catalogue stock for every product sold, refusing the whole
    // invoice (and rolling back any stock already deducted) if a product
    // is missing or doesn't have enough left — no overselling.
    for (const item of validation.items) {
      const { rows: updated } = await client.query(
        `UPDATE products SET quantity = quantity - $1 WHERE id = $2 AND quantity >= $1 RETURNING quantity`,
        [item.quantity, item.productId]
      )

      if (updated.length === 0) {
        const { rows: existing } = await client.query('SELECT quantity FROM products WHERE id = $1', [
          item.productId,
        ])
        await client.query('ROLLBACK')

        if (existing.length === 0) {
          return res.status(400).json({ message: `Product "${item.name}" no longer exists in the catalogue.` })
        }
        return res.status(409).json({
          message: `Not enough stock for "${item.name}" — requested ${item.quantity}, only ${existing[0].quantity} left.`,
        })
      }
    }

    const { rows } = await client.query(
      `INSERT INTO invoices
         (invoice_number, invoice_date, customer_name, customer_phone, customer_address,
          payment_method, quotation_number, items, grand_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, invoice_number, invoice_date, customer_name, customer_phone, customer_address,
                 payment_method, quotation_number, items, grand_total, created_at`,
      [number, invoiceDate, customer, phone, address, payment, refQuotation, JSON.stringify(validation.items), grandTotal]
    )

    await client.query('COMMIT')
    res.status(201).json({ invoice: rows[0] })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('POST /api/invoices failed:', err)
    res.status(500).json({ message: 'Could not save invoice' })
  } finally {
    client.release()
  }
})

app.get('/api/invoices', requireAuth, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100)
    const offset = (page - 1) * pageSize

    const params = []
    let where = ''
    if (req.query.q) {
      params.push(`%${req.query.q}%`)
      where = `WHERE invoice_number ILIKE $${params.length} OR customer_name ILIKE $${params.length}`
    }

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM invoices ${where}`, params)
    const total = countResult.rows[0].total

    params.push(pageSize)
    params.push(offset)
    const itemsResult = await pool.query(
      `SELECT id, invoice_number, invoice_date, customer_name, customer_phone, customer_address,
              payment_method, quotation_number, items, grand_total, created_at
       FROM invoices
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    res.json({
      items: itemsResult.rows,
      total,
      page,
      pageSize,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
    })
  } catch (err) {
    console.error('GET /api/invoices failed:', err)
    res.status(500).json({ message: 'Could not load invoices' })
  }
})

// Serve the built React app in production.
const clientDist = path.join(__dirname, '..', 'client', 'dist')
app.use(express.static(clientDist))

app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`DIL Computers server listening on port ${PORT}`)
})
