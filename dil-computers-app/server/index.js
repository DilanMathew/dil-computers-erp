const path = require('path')
const express = require('express')
const pool = require('./db/pool')
const { ROLES, issueToken, requireAuth, requireRole, hashPassword, verifyPassword } = require('./auth')

const app = express()
const PORT = process.env.PORT || 5000

const SORTABLE_COLUMNS = new Set(['name', 'category', 'price', 'quantity'])

app.use(express.json())

// Records who did what, for the admin-only audit log. Pass a transaction
// client when logging inside a transaction so the entry commits/rolls back
// with the rest of the work; otherwise the pool is used directly. Logging
// failures are swallowed (with a console.error) — an audit-log write should
// never be the reason a real request fails.
async function logAudit(queryable, { user, action, entityType = null, entityId = null, details = null }) {
  try {
    await queryable.query(
      `INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, user.username, action, entityType, entityId ? String(entityId) : null, details ? JSON.stringify(details) : null]
    )
  } catch (err) {
    console.error('Audit log write failed:', err)
  }
}

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

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {}
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(401).json({ message: 'Invalid username or password' })
    }

    const { rows } = await pool.query(
      'SELECT id, username, password_hash, full_name, role, active FROM users WHERE username = $1',
      [username]
    )
    const account = rows[0]

    // Compare against a dummy hash even when the account doesn't exist, so
    // the response time doesn't reveal whether a username is registered.
    const passwordOk = await verifyPassword(
      password,
      account ? account.password_hash : '$2a$10$CwTycUXWue0Thq9StjUM0uJ8Q8OqDXQZfPFfLB6QOX0z6mOVtCTP.'
    )

    if (!account || !account.active || !passwordOk) {
      return res.status(401).json({ message: 'Invalid username or password' })
    }

    const user = { id: account.id, username: account.username, role: account.role }
    const token = issueToken(user)
    res.json({ token, user: { ...user, fullName: account.full_name } })
  } catch (err) {
    console.error('POST /api/login failed:', err)
    res.status(500).json({ message: 'Could not log in' })
  }
})

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, full_name, role, active FROM users WHERE id = $1',
      [req.user.id]
    )
    const account = rows[0]
    if (!account || !account.active) {
      return res.status(401).json({ message: 'Account no longer active' })
    }
    res.json({ user: { id: account.id, username: account.username, fullName: account.full_name, role: account.role } })
  } catch (err) {
    console.error('GET /api/me failed:', err)
    res.status(500).json({ message: 'Could not load account' })
  }
})

// --- User management (admin only) ---

app.get('/api/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, full_name, role, active, created_at FROM users ORDER BY created_at ASC'
    )
    res.json({ users: rows })
  } catch (err) {
    console.error('GET /api/users failed:', err)
    res.status(500).json({ message: 'Could not load users' })
  }
})

app.post('/api/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { username, password, fullName, role } = req.body || {}
    const uname = typeof username === 'string' ? username.trim() : ''
    if (!uname) {
      return res.status(400).json({ message: 'Username is required' })
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' })
    }
    if (!ROLES.includes(role)) {
      return res.status(400).json({ message: `Role must be one of: ${ROLES.join(', ')}` })
    }

    const passwordHash = await hashPassword(password)
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, full_name, role, active, created_at`,
      [uname, passwordHash, typeof fullName === 'string' && fullName.trim() ? fullName.trim() : null, role]
    )
    const created = rows[0]

    await logAudit(pool, {
      user: req.user,
      action: 'user.create',
      entityType: 'user',
      entityId: created.id,
      details: { username: created.username, role: created.role },
    })

    res.status(201).json({ user: created })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'That username is already taken' })
    }
    console.error('POST /api/users failed:', err)
    res.status(500).json({ message: 'Could not create user' })
  }
})

app.patch('/api/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid user id' })
    }
    if (id === req.user.id && (req.body?.active === false || (req.body?.role && req.body.role !== 'admin'))) {
      return res.status(400).json({ message: 'You cannot deactivate or demote your own account' })
    }

    const sets = []
    const params = []

    if (typeof req.body?.fullName === 'string') {
      params.push(req.body.fullName.trim() || null)
      sets.push(`full_name = $${params.length}`)
    }
    if (typeof req.body?.role === 'string') {
      if (!ROLES.includes(req.body.role)) {
        return res.status(400).json({ message: `Role must be one of: ${ROLES.join(', ')}` })
      }
      params.push(req.body.role)
      sets.push(`role = $${params.length}`)
    }
    if (typeof req.body?.active === 'boolean') {
      params.push(req.body.active)
      sets.push(`active = $${params.length}`)
    }
    if (typeof req.body?.password === 'string' && req.body.password) {
      if (req.body.password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' })
      }
      params.push(await hashPassword(req.body.password))
      sets.push(`password_hash = $${params.length}`)
    }

    if (sets.length === 0) {
      return res.status(400).json({ message: 'Nothing to update' })
    }

    params.push(id)
    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, username, full_name, role, active, created_at`,
      params
    )
    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' })
    }

    await logAudit(pool, {
      user: req.user,
      action: 'user.update',
      entityType: 'user',
      entityId: id,
      details: { fields: Object.keys(req.body || {}) },
    })

    res.json({ user: rows[0] })
  } catch (err) {
    console.error('PATCH /api/users/:id failed:', err)
    res.status(500).json({ message: 'Could not update user' })
  }
})

app.get('/api/audit-log', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 1), 200)
    const offset = (page - 1) * pageSize

    const countResult = await pool.query('SELECT COUNT(*)::int AS total FROM audit_log')
    const total = countResult.rows[0].total

    const itemsResult = await pool.query(
      `SELECT id, user_id, username, action, entity_type, entity_id, details, created_at
       FROM audit_log
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    )

    res.json({
      items: itemsResult.rows,
      total,
      page,
      pageSize,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
    })
  } catch (err) {
    console.error('GET /api/audit-log failed:', err)
    res.status(500).json({ message: 'Could not load audit log' })
  }
})

// --- Customers ---

app.get('/api/customers', requireAuth, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100)
    const offset = (page - 1) * pageSize

    const params = []
    let where = ''
    if (req.query.q) {
      params.push(`%${req.query.q}%`)
      where = `WHERE name ILIKE $${params.length} OR phone ILIKE $${params.length} OR email ILIKE $${params.length}`
    }

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM customers ${where}`, params)
    const total = countResult.rows[0].total

    params.push(pageSize)
    params.push(offset)
    const itemsResult = await pool.query(
      `SELECT id, name, phone, email, address, notes, created_by_username, created_at
       FROM customers
       ${where}
       ORDER BY name ASC
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
    console.error('GET /api/customers failed:', err)
    res.status(500).json({ message: 'Could not load customers' })
  }
})

app.get('/api/customers/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid customer id' })
    }

    const { rows } = await pool.query(
      `SELECT id, name, phone, email, address, notes, created_by_username, created_at
       FROM customers WHERE id = $1`,
      [id]
    )
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found' })
    }

    const [quotations, invoices] = await Promise.all([
      pool.query(
        `SELECT id, quotation_number, quotation_date, grand_total, created_at
         FROM quotations WHERE customer_id = $1 ORDER BY created_at DESC`,
        [id]
      ),
      pool.query(
        `SELECT id, invoice_number, invoice_date, grand_total, created_at
         FROM invoices WHERE customer_id = $1 ORDER BY created_at DESC`,
        [id]
      ),
    ])

    res.json({ customer: rows[0], quotations: quotations.rows, invoices: invoices.rows })
  } catch (err) {
    console.error('GET /api/customers/:id failed:', err)
    res.status(500).json({ message: 'Could not load customer' })
  }
})

app.post('/api/customers', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
  try {
    const { name, phone, email, address, notes } = req.body || {}
    const trimmedName = typeof name === 'string' ? name.trim() : ''
    if (!trimmedName) {
      return res.status(400).json({ message: 'Customer name is required' })
    }

    const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

    const { rows } = await pool.query(
      `INSERT INTO customers (name, phone, email, address, notes, created_by_user_id, created_by_username)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, phone, email, address, notes, created_by_username, created_at`,
      [trimmedName, clean(phone), clean(email), clean(address), clean(notes), req.user.id, req.user.username]
    )
    const customer = rows[0]

    await logAudit(pool, {
      user: req.user,
      action: 'customer.create',
      entityType: 'customer',
      entityId: customer.id,
      details: { name: customer.name },
    })

    res.status(201).json({ customer })
  } catch (err) {
    console.error('POST /api/customers failed:', err)
    res.status(500).json({ message: 'Could not create customer' })
  }
})

app.patch('/api/customers/:id', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid customer id' })
    }

    const sets = []
    const params = []
    const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

    if (typeof req.body?.name === 'string') {
      if (!req.body.name.trim()) {
        return res.status(400).json({ message: 'Customer name cannot be empty' })
      }
      params.push(req.body.name.trim())
      sets.push(`name = $${params.length}`)
    }
    for (const field of ['phone', 'email', 'address', 'notes']) {
      if (typeof req.body?.[field] === 'string') {
        params.push(clean(req.body[field]))
        sets.push(`${field} = $${params.length}`)
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ message: 'Nothing to update' })
    }

    params.push(id)
    const { rows } = await pool.query(
      `UPDATE customers SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, name, phone, email, address, notes, created_by_username, created_at`,
      params
    )
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found' })
    }

    await logAudit(pool, {
      user: req.user,
      action: 'customer.update',
      entityType: 'customer',
      entityId: id,
      details: { fields: Object.keys(req.body || {}) },
    })

    res.json({ customer: rows[0] })
  } catch (err) {
    console.error('PATCH /api/customers/:id failed:', err)
    res.status(500).json({ message: 'Could not update customer' })
  }
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

app.post('/api/quotations', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
  try {
    const { quotationNumber, quotationDate, customerName, customerId, items: rawItems } = req.body || {}

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

    let custId = null
    if (customerId != null) {
      custId = parseInt(customerId, 10)
      if (!Number.isInteger(custId)) {
        return res.status(400).json({ message: 'Invalid customer reference' })
      }
    }

    const grandTotal = computeGrandTotal(validation.items)
    const customer = typeof customerName === 'string' && customerName.trim() ? customerName.trim() : null

    const { rows } = await pool.query(
      `INSERT INTO quotations
         (quotation_number, quotation_date, customer_name, customer_id, items, grand_total,
          created_by_user_id, created_by_username)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, quotation_number, quotation_date, customer_name, customer_id, items, grand_total,
                 created_by_username, created_at`,
      [number, quotationDate, customer, custId, JSON.stringify(validation.items), grandTotal, req.user.id, req.user.username]
    )
    const quotation = rows[0]

    await logAudit(pool, {
      user: req.user,
      action: 'quotation.create',
      entityType: 'quotation',
      entityId: quotation.id,
      details: { quotationNumber: number, grandTotal },
    })

    res.status(201).json({ quotation })
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ message: 'That customer no longer exists' })
    }
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
      `SELECT id, quotation_number, quotation_date, customer_name, items, grand_total,
              created_by_username, created_at
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

app.post('/api/invoices', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
  const client = await pool.connect()
  try {
    const {
      invoiceNumber,
      invoiceDate,
      customerName,
      customerId,
      customerPhone,
      customerAddress,
      paymentMethod,
      quotationNumber,
      items: rawItems,
      amountReceived,
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

    let custId = null
    if (customerId != null) {
      custId = parseInt(customerId, 10)
      if (!Number.isInteger(custId)) {
        return res.status(400).json({ message: 'Invalid customer reference' })
      }
    }

    const grandTotal = computeGrandTotal(validation.items)

    // How much is being paid right now — defaults to the full total (the
    // common "paid in full at sale" case) if the field is omitted, so
    // existing callers that don't know about partial payments still work.
    const received = amountReceived === undefined || amountReceived === null || amountReceived === ''
      ? grandTotal
      : Number(amountReceived)
    if (!Number.isFinite(received) || received < 0) {
      return res.status(400).json({ message: 'Invalid amount received' })
    }
    if (received > grandTotal + 0.01) {
      return res.status(400).json({ message: 'Amount received cannot exceed the invoice total' })
    }

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
         (invoice_number, invoice_date, customer_name, customer_id, customer_phone, customer_address,
          payment_method, quotation_number, items, grand_total,
          created_by_user_id, created_by_username)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, invoice_number, invoice_date, customer_name, customer_phone, customer_address,
                 payment_method, quotation_number, items, grand_total, created_by_username, created_at`,
      [
        number, invoiceDate, customer, custId, phone, address, payment, refQuotation,
        JSON.stringify(validation.items), grandTotal, req.user.id, req.user.username,
      ]
    )
    const invoice = rows[0]

    if (received > 0) {
      await client.query(
        `INSERT INTO payments (invoice_id, amount, payment_method, payment_date, created_by_user_id, created_by_username)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [invoice.id, received, payment, invoiceDate, req.user.id, req.user.username]
      )
    }

    await client.query('COMMIT')

    await logAudit(pool, {
      user: req.user,
      action: 'invoice.create',
      entityType: 'invoice',
      entityId: invoice.id,
      details: { invoiceNumber: number, grandTotal, amountReceived: received, productIds: validation.items.map((i) => i.productId) },
    })

    res.status(201).json({ invoice: { ...invoice, amount_paid: received, balance_due: grandTotal - received } })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    if (err.code === '23503') {
      return res.status(400).json({ message: 'That customer no longer exists' })
    }
    console.error('POST /api/invoices failed:', err)
    res.status(500).json({ message: 'Could not save invoice' })
  } finally {
    client.release()
  }
})

// Record an additional payment against an existing invoice (partial
// payments, paying off a credit sale later, etc).
app.post('/api/invoices/:id/payments', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
  try {
    const invoiceId = parseInt(req.params.id, 10)
    if (!Number.isInteger(invoiceId)) {
      return res.status(400).json({ message: 'Invalid invoice id' })
    }

    const { amount, paymentMethod, paymentDate, notes } = req.body || {}
    const amountNum = Number(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({ message: 'Enter a payment amount greater than zero' })
    }
    const date = paymentDate && isValidDateString(paymentDate) ? paymentDate : new Date().toISOString().slice(0, 10)

    const { rows: invoiceRows } = await pool.query(
      `SELECT i.grand_total, COALESCE(SUM(p.amount), 0) AS paid
       FROM invoices i LEFT JOIN payments p ON p.invoice_id = i.id
       WHERE i.id = $1 GROUP BY i.id`,
      [invoiceId]
    )
    if (invoiceRows.length === 0) {
      return res.status(404).json({ message: 'Invoice not found' })
    }
    const balanceDue = Number(invoiceRows[0].grand_total) - Number(invoiceRows[0].paid)
    if (amountNum > balanceDue + 0.01) {
      return res.status(400).json({
        message: `That would overpay the invoice — only ${balanceDue.toFixed(2)} is still due.`,
      })
    }

    const { rows } = await pool.query(
      `INSERT INTO payments (invoice_id, amount, payment_method, payment_date, notes, created_by_user_id, created_by_username)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, invoice_id, amount, payment_method, payment_date, notes, created_by_username, created_at`,
      [
        invoiceId, amountNum,
        typeof paymentMethod === 'string' && paymentMethod.trim() ? paymentMethod.trim() : null,
        date,
        typeof notes === 'string' && notes.trim() ? notes.trim() : null,
        req.user.id, req.user.username,
      ]
    )

    await logAudit(pool, {
      user: req.user,
      action: 'payment.record',
      entityType: 'invoice',
      entityId: invoiceId,
      details: { amount: amountNum },
    })

    res.status(201).json({ payment: rows[0] })
  } catch (err) {
    console.error('POST /api/invoices/:id/payments failed:', err)
    res.status(500).json({ message: 'Could not record payment' })
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
      where = `WHERE i.invoice_number ILIKE $${params.length} OR i.customer_name ILIKE $${params.length}`
    }
    if (req.query.status && ['paid', 'partial', 'unpaid'].includes(req.query.status)) {
      params.push(req.query.status)
      where += `${where ? ' AND' : 'WHERE'} (
        CASE
          WHEN COALESCE(pay.paid, 0) <= 0 THEN 'unpaid'
          WHEN COALESCE(pay.paid, 0) >= i.grand_total THEN 'paid'
          ELSE 'partial'
        END
      ) = $${params.length}`
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM invoices i
       LEFT JOIN LATERAL (SELECT SUM(amount) AS paid FROM payments WHERE invoice_id = i.id) pay ON true
       ${where}`,
      params
    )
    const total = countResult.rows[0].total

    params.push(pageSize)
    params.push(offset)
    const itemsResult = await pool.query(
      `SELECT i.id, i.invoice_number, i.invoice_date, i.customer_name, i.customer_id, i.customer_phone,
              i.customer_address, i.payment_method, i.quotation_number, i.items, i.grand_total,
              i.created_by_username, i.created_at,
              COALESCE(pay.paid, 0) AS amount_paid,
              i.grand_total - COALESCE(pay.paid, 0) AS balance_due,
              CASE
                WHEN COALESCE(pay.paid, 0) <= 0 THEN 'unpaid'
                WHEN COALESCE(pay.paid, 0) >= i.grand_total THEN 'paid'
                ELSE 'partial'
              END AS status,
              COALESCE(pay.history, '[]'::json) AS payments
       FROM invoices i
       LEFT JOIN LATERAL (
         SELECT
           SUM(p.amount) AS paid,
           json_agg(json_build_object(
             'id', p.id, 'amount', p.amount, 'paymentMethod', p.payment_method,
             'paymentDate', p.payment_date, 'notes', p.notes,
             'createdBy', p.created_by_username, 'createdAt', p.created_at
           ) ORDER BY p.payment_date DESC, p.id DESC) AS history
         FROM payments p WHERE p.invoice_id = i.id
       ) pay ON true
       ${where}
       ORDER BY i.created_at DESC
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
