const path = require('path')
const express = require('express')
const { parse: parseCsv } = require('csv-parse/sync')
const pool = require('./db/pool')
const { ROLES, issueToken, requireAuth, requireRole, hashPassword, verifyPassword } = require('./auth')

const app = express()
const PORT = process.env.PORT || 5000

// Railway (like most PaaS) puts the app behind a reverse proxy — without
// this, req.ip is the proxy's own address for every request, which would
// make the login rate limiter below apply globally instead of per-client.
app.set('trust proxy', true)

const SORTABLE_COLUMNS = new Set(['name', 'category', 'price', 'quantity'])

// Cap request bodies well above the largest legitimate payload (a big
// invoice or a bulk product import) but nowhere near unbounded.
app.use(express.json({ limit: '2mb' }))

// A handful of basic response headers — cheap, broadly applicable hardening
// that doesn't need a dependency.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})

// Unauthenticated health check for Railway (and anyone else) to poll —
// confirms the process is up and can actually reach the database, not
// just that it's accepting connections.
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok' })
  } catch (err) {
    res.status(503).json({ status: 'error', message: 'Database unavailable' })
  }
})

// Simple in-memory sliding-window limiter for login attempts, keyed by IP.
// Good enough for a single-instance deployment; not meant to survive a
// restart or scale across instances. Swept periodically so it doesn't grow
// unbounded across many distinct IPs over a long uptime.
const LOGIN_WINDOW_MS = 5 * 60 * 1000
const LOGIN_MAX_ATTEMPTS = 10
const loginAttempts = new Map()

function loginRateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown'
  const now = Date.now()
  const entry = loginAttempts.get(ip)
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, windowStart: now })
    return next()
  }
  entry.count += 1
  if (entry.count > LOGIN_MAX_ATTEMPTS) {
    return res.status(429).json({ message: 'Too many login attempts — please wait a few minutes and try again.' })
  }
  next()
}

setInterval(() => {
  const cutoff = Date.now() - LOGIN_WINDOW_MS
  for (const [ip, entry] of loginAttempts) {
    if (entry.windowStart < cutoff) loginAttempts.delete(ip)
  }
}, LOGIN_WINDOW_MS).unref()

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

    // Optional per-unit serial numbers, for traceability on serialized
    // items (laptops, etc). If provided at all, there must be exactly one
    // per unit sold — a partial list isn't meaningfully attributable to
    // which units they're for, so it's rejected rather than guessed at.
    let serialNumbers = null
    if (raw?.serialNumbers != null) {
      if (!Array.isArray(raw.serialNumbers)) {
        return { ok: false, message: `Serial numbers for "${name}" must be a list` }
      }
      const cleaned = raw.serialNumbers
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean)
      if (cleaned.length > 0) {
        if (cleaned.length !== quantity) {
          return { ok: false, message: `"${name}": enter ${quantity} serial number(s), or leave the field blank` }
        }
        serialNumbers = cleaned
      }
    }

    items.push({
      productId: Number.isInteger(productId) && productId > 0 ? productId : null,
      category,
      name,
      quantity,
      catalPrice,
      finalPrice,
      sameAsCatalogue: Boolean(raw?.sameAsCatalogue),
      hsnCode: typeof raw?.hsnCode === 'string' && raw.hsnCode.trim() ? raw.hsnCode.trim() : null,
      serialNumbers,
    })
  }

  return { ok: true, items }
}

function computeSubtotal(items) {
  return items.reduce((sum, item) => sum + item.finalPrice * item.quantity, 0)
}

const GST_RATES = [0, 5, 12, 18, 28]

// Fixed ₹/hour labor rate for on-site technician billing — never sent to
// or editable by a technician. Admin can tune it via this one env var
// without a code change; exposed read-only via /api/company-info so the
// technician's app can show an accurate estimate before submitting.
const LABOR_RATE_PER_HOUR = Number(process.env.LABOR_RATE_PER_HOUR) || 100

// Returns { rate, subtotal, gstAmount, grandTotal } from a raw rate value
// and the line items' pre-tax subtotal. Falls back to 0% for anything not
// one of the standard GST slabs, rather than trusting an arbitrary number.
function computeGst(items, rawRate) {
  const subtotal = computeSubtotal(items)
  const rate = GST_RATES.includes(Number(rawRate)) ? Number(rawRate) : 0
  const gstAmount = Math.round(subtotal * (rate / 100) * 100) / 100
  return { rate, subtotal, gstAmount, grandTotal: subtotal + gstAmount }
}

function isValidDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}

app.post('/api/login', loginRateLimit, async (req, res) => {
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

// Public (no auth) — printed on quotation/invoice PDFs. Not a secret; the
// same info would be on a printed letterhead.
app.get('/api/company-info', (req, res) => {
  res.json({
    name: process.env.COMPANY_NAME || 'DIL Computers',
    gstin: process.env.COMPANY_GSTIN || '',
    address: process.env.COMPANY_ADDRESS || '',
    laborRatePerHour: LABOR_RATE_PER_HOUR,
  })
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

app.get('/api/customers', requireAuth, requireRole('admin', 'sales', 'accountant'), async (req, res) => {
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

app.get('/api/customers/:id', requireAuth, requireRole('admin', 'sales', 'accountant'), async (req, res) => {
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

// --- Customer Insights (admin only) ---
//
// Every metric here is computed live from invoices/payments/credit_notes/
// repair_tickets/amc_contracts — nothing is stored, same "compute, don't
// store" pattern as invoice payment status. risk_tag on customers is the
// one exception: a manual override a person sets by hand when the numbers
// don't tell the whole story.
//
// "Late" is a 30-day proxy (no due-date/credit-terms concept exists yet):
// an invoice counts as late if it took more than 30 days from invoice_date
// to be paid in full, or if it's still unpaid/partial and is already more
// than 30 days old.

const CUSTOMER_INSIGHTS_CTE = `
  WITH invoice_stats AS (
    SELECT
      i.customer_id,
      COUNT(*) AS invoice_count,
      SUM(i.grand_total) AS total_spent,
      AVG(i.grand_total) AS avg_order_value,
      MIN(i.invoice_date) AS first_purchase_date,
      MAX(i.invoice_date) AS last_purchase_date,
      SUM(i.grand_total - COALESCE(pay.paid, 0)) AS outstanding_balance,
      SUM(CASE WHEN i.invoice_date <= CURRENT_DATE - INTERVAL '30 days' AND (i.grand_total - COALESCE(pay.paid, 0)) > 0.01
               THEN i.grand_total - COALESCE(pay.paid, 0) ELSE 0 END) AS overdue_amount,
      COUNT(*) FILTER (
        WHERE ((i.grand_total - COALESCE(pay.paid, 0)) <= 0.01 AND pay.last_payment_date IS NOT NULL AND (pay.last_payment_date - i.invoice_date) > 30)
           OR ((i.grand_total - COALESCE(pay.paid, 0)) > 0.01 AND i.invoice_date <= CURRENT_DATE - INTERVAL '30 days')
      ) AS late_payment_count,
      AVG(pay.last_payment_date - i.invoice_date) FILTER (
        WHERE (i.grand_total - COALESCE(pay.paid, 0)) <= 0.01 AND pay.last_payment_date IS NOT NULL
      ) AS avg_days_to_pay
    FROM invoices i
    LEFT JOIN LATERAL (
      SELECT SUM(amount) AS paid, MAX(payment_date) AS last_payment_date
      FROM payments WHERE invoice_id = i.id
    ) pay ON true
    WHERE i.customer_id IS NOT NULL
    GROUP BY i.customer_id
  ),
  return_stats AS (
    SELECT inv.customer_id, SUM(cn.grand_total) AS return_value
    FROM credit_notes cn
    JOIN invoices inv ON inv.id = cn.invoice_id
    WHERE inv.customer_id IS NOT NULL
    GROUP BY inv.customer_id
  ),
  service_stats AS (
    SELECT customer_id, COUNT(*) AS repair_ticket_count
    FROM repair_tickets
    WHERE customer_id IS NOT NULL
    GROUP BY customer_id
  ),
  amc_stats AS (
    SELECT customer_id,
      COUNT(*) FILTER (WHERE NOT cancelled AND end_date >= CURRENT_DATE) AS active_amc_count,
      COUNT(*) FILTER (WHERE NOT cancelled AND end_date >= CURRENT_DATE AND end_date <= CURRENT_DATE + INTERVAL '30 days') AS amc_expiring_soon_count
    FROM amc_contracts
    WHERE customer_id IS NOT NULL
    GROUP BY customer_id
  ),
  customer_insights AS (
    SELECT
      c.id, c.name, c.phone, c.email, c.address, c.notes, c.risk_tag, c.created_at,
      COALESCE(s.invoice_count, 0) AS invoice_count,
      COALESCE(s.total_spent, 0) AS total_spent,
      s.avg_order_value,
      s.first_purchase_date,
      s.last_purchase_date,
      COALESCE(s.outstanding_balance, 0) AS outstanding_balance,
      COALESCE(s.overdue_amount, 0) AS overdue_amount,
      COALESCE(s.late_payment_count, 0) AS late_payment_count,
      s.avg_days_to_pay,
      COALESCE(r.return_value, 0) AS return_value,
      COALESCE(sv.repair_ticket_count, 0) AS repair_ticket_count,
      COALESCE(a.active_amc_count, 0) AS active_amc_count,
      COALESCE(a.amc_expiring_soon_count, 0) AS amc_expiring_soon_count,
      CASE WHEN COALESCE(s.invoice_count, 0) > 1
           THEN (s.last_purchase_date - s.first_purchase_date)::float / (s.invoice_count - 1)
           ELSE NULL END AS avg_days_between_purchases,
      CASE WHEN s.last_purchase_date IS NOT NULL
           THEN (CURRENT_DATE - s.last_purchase_date) ELSE NULL END AS days_since_last_purchase
    FROM customers c
    LEFT JOIN invoice_stats s ON s.customer_id = c.id
    LEFT JOIN return_stats r ON r.customer_id = c.id
    LEFT JOIN service_stats sv ON sv.customer_id = c.id
    LEFT JOIN amc_stats a ON a.customer_id = c.id
  )
`

// "Gone quiet": has a purchase-frequency baseline (2+ invoices) and it's
// now been more than twice their usual gap since the last one.
const FOLLOWUP_CONDITION = `(
  overdue_amount > 0.01
  OR amc_expiring_soon_count > 0
  OR (avg_days_between_purchases IS NOT NULL AND days_since_last_purchase > 2 * avg_days_between_purchases)
)`

const INSIGHTS_SORTS = {
  spend: 'total_spent DESC NULLS LAST',
  frequency: 'invoice_count DESC, total_spent DESC',
  recency: 'last_purchase_date ASC NULLS FIRST',
  risk: 'overdue_amount DESC, late_payment_count DESC, total_spent DESC',
}

// Heuristic, not a credit bureau score — a starting point staff can
// override with their own judgment via risk_tag.
function computeHealthBadge(row) {
  const overdue = Number(row.overdue_amount) || 0
  const lateCount = Number(row.late_payment_count) || 0
  const avgDaysToPay = row.avg_days_to_pay != null ? Number(row.avg_days_to_pay) : null
  if (overdue > 0.01 && lateCount >= 2) return 'risk'
  if (overdue > 0.01 || lateCount >= 1 || (avgDaysToPay != null && avgDaysToPay > 30)) return 'watch'
  return 'good'
}

app.get('/api/customer-insights', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100)
    const offset = (page - 1) * pageSize
    const sortKey = INSIGHTS_SORTS[req.query.sort] ? req.query.sort : 'spend'

    const conditions = ['invoice_count > 0']
    const params = []
    if (req.query.q) {
      params.push(`%${req.query.q}%`)
      conditions.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length})`)
    }
    if (req.query.view === 'followup') {
      conditions.push(FOLLOWUP_CONDITION)
    }
    const where = `WHERE ${conditions.join(' AND ')}`

    const countResult = await pool.query(
      `${CUSTOMER_INSIGHTS_CTE} SELECT COUNT(*)::int AS total FROM customer_insights ${where}`,
      params
    )
    const total = countResult.rows[0].total

    params.push(pageSize)
    params.push(offset)
    const itemsResult = await pool.query(
      `${CUSTOMER_INSIGHTS_CTE}
       SELECT * FROM customer_insights
       ${where}
       ORDER BY ${INSIGHTS_SORTS[sortKey]}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    res.json({
      items: itemsResult.rows.map((row) => ({ ...row, healthBadge: computeHealthBadge(row) })),
      total,
      page,
      pageSize,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
    })
  } catch (err) {
    console.error('GET /api/customer-insights failed:', err)
    res.status(500).json({ message: 'Could not load customer insights' })
  }
})

app.get('/api/customer-insights/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid customer id' })
    }

    const [insightsResult, invoicesResult, affinityResult] = await Promise.all([
      pool.query(`${CUSTOMER_INSIGHTS_CTE} SELECT * FROM customer_insights WHERE id = $1`, [id]),
      pool.query(
        `SELECT i.id, i.invoice_number, i.invoice_date, i.customer_name, i.customer_phone, i.customer_address,
                i.payment_method, i.quotation_number, i.ticket_number, i.items, i.subtotal, i.gst_rate,
                i.gst_amount, i.grand_total, i.created_at,
                COALESCE(pay.paid, 0) AS amount_paid,
                i.grand_total - COALESCE(pay.paid, 0) AS balance_due
         FROM invoices i
         LEFT JOIN LATERAL (SELECT SUM(amount) AS paid FROM payments WHERE invoice_id = i.id) pay ON true
         WHERE i.customer_id = $1
         ORDER BY i.invoice_date DESC, i.id DESC`,
        [id]
      ),
      pool.query(
        `SELECT item->>'name' AS product_name, SUM((item->>'quantity')::int) AS total_qty, COUNT(*) AS times_bought
         FROM invoices i, jsonb_array_elements(i.items) AS item
         WHERE i.customer_id = $1
         GROUP BY product_name
         ORDER BY total_qty DESC
         LIMIT 5`,
        [id]
      ),
    ])

    if (insightsResult.rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found' })
    }
    const customer = insightsResult.rows[0]

    res.json({
      customer: { ...customer, healthBadge: computeHealthBadge(customer) },
      invoices: invoicesResult.rows,
      productAffinity: affinityResult.rows,
    })
  } catch (err) {
    console.error('GET /api/customer-insights/:id failed:', err)
    res.status(500).json({ message: 'Could not load customer insights' })
  }
})

app.patch('/api/customer-insights/:id/tag', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid customer id' })
    }
    const riskTag = typeof req.body?.riskTag === 'string' && req.body.riskTag.trim() ? req.body.riskTag.trim() : null

    const { rows } = await pool.query(
      'UPDATE customers SET risk_tag = $1 WHERE id = $2 RETURNING id, risk_tag',
      [riskTag, id]
    )
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found' })
    }

    await logAudit(pool, {
      user: req.user,
      action: 'customer.tag',
      entityType: 'customer',
      entityId: id,
      details: { riskTag },
    })

    res.json({ customer: rows[0] })
  } catch (err) {
    console.error('PATCH /api/customer-insights/:id/tag failed:', err)
    res.status(500).json({ message: 'Could not update tag' })
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
      // Matches by name or barcode, so scanning a barcode into the same
      // search box the product picker already uses just works.
      params.push(`%${req.query.q}%`)
      conditions.push(`(name ILIKE $${params.length} OR barcode ILIKE $${params.length})`)
    }

    if (req.query.lowStock === 'true') {
      conditions.push('reorder_threshold IS NOT NULL AND quantity <= reorder_threshold')
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
      `SELECT id, category, name, price, quantity, hsn_code, reorder_threshold, cost_price, warranty_months, barcode
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

// Admin-only: catalogue management fields for a single product. Bulk
// changes to name/price/quantity/category — including via the CSV import
// below — go through the /api/products/import route instead.
app.patch('/api/products/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid product id' })
    }

    const sets = []
    const params = []

    if ('reorderThreshold' in (req.body || {})) {
      const v = req.body.reorderThreshold
      if (v === null || v === '') {
        params.push(null)
      } else {
        const n = parseInt(v, 10)
        if (!Number.isInteger(n) || n < 0) {
          return res.status(400).json({ message: 'Reorder threshold must be a non-negative whole number' })
        }
        params.push(n)
      }
      sets.push(`reorder_threshold = $${params.length}`)
    }
    if ('hsnCode' in (req.body || {})) {
      const v = typeof req.body.hsnCode === 'string' && req.body.hsnCode.trim() ? req.body.hsnCode.trim() : null
      params.push(v)
      sets.push(`hsn_code = $${params.length}`)
    }
    if ('warrantyMonths' in (req.body || {})) {
      const v = req.body.warrantyMonths
      if (v === null || v === '') {
        params.push(null)
      } else {
        const n = parseInt(v, 10)
        if (!Number.isInteger(n) || n < 0) {
          return res.status(400).json({ message: 'Warranty months must be a non-negative whole number' })
        }
        params.push(n)
      }
      sets.push(`warranty_months = $${params.length}`)
    }
    if ('barcode' in (req.body || {})) {
      const v = typeof req.body.barcode === 'string' && req.body.barcode.trim() ? req.body.barcode.trim() : null
      params.push(v)
      sets.push(`barcode = $${params.length}`)
    }

    if (sets.length === 0) {
      return res.status(400).json({ message: 'Nothing to update' })
    }

    params.push(id)
    const { rows } = await pool.query(
      `UPDATE products SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, category, name, price, quantity, hsn_code, reorder_threshold, cost_price, warranty_months, barcode`,
      params
    )
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' })
    }

    await logAudit(pool, {
      user: req.user,
      action: 'product.update',
      entityType: 'product',
      entityId: id,
      details: { fields: Object.keys(req.body || {}) },
    })

    res.json({ product: rows[0] })
  } catch (err) {
    console.error('PATCH /api/products/:id failed:', err)
    res.status(500).json({ message: 'Could not update product' })
  }
})

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function toCsv(rows, columns) {
  const header = columns.join(',')
  const lines = rows.map((row) => columns.map((col) => csvEscape(row[col])).join(','))
  return [header, ...lines].join('\n')
}

const PRODUCT_CSV_COLUMNS = [
  'category', 'name', 'price', 'quantity', 'hsn_code', 'reorder_threshold', 'cost_price', 'warranty_months', 'barcode',
]

// Full-catalogue CSV, in the same column shape POST /api/products/import
// expects back — round-trips cleanly (export, edit prices in a
// spreadsheet, re-import).
app.get('/api/products/export', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT category, name, price, quantity, hsn_code, reorder_threshold, cost_price, warranty_months, barcode
       FROM products ORDER BY category, name`
    )
    const csv = toCsv(rows, PRODUCT_CSV_COLUMNS)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="product_catalogue_export.csv"')
    res.send(csv)
  } catch (err) {
    console.error('GET /api/products/export failed:', err)
    res.status(500).json({ message: 'Could not export catalogue' })
  }
})

const PRODUCT_IMPORT_MAX_ROWS = 5000

// Bulk create/update from a CSV upload — matches existing products by
// (category, name) and updates only the columns present in each row,
// leaving the rest untouched; a row that doesn't match an existing
// product is inserted as new (needs at least price and quantity). Row
// errors don't abort the whole import — every other row still gets
// processed, and the response reports what happened per row so a
// multi-thousand-row import doesn't live or die on one bad line.
app.post('/api/products/import', requireAuth, requireRole('admin'), express.text({ type: '*/*', limit: '10mb' }), async (req, res) => {
  try {
    const raw = typeof req.body === 'string' ? req.body : ''
    if (!raw.trim()) {
      return res.status(400).json({ message: 'Upload a non-empty CSV file' })
    }

    let records
    try {
      records = parseCsv(raw, { columns: true, skip_empty_lines: true, trim: true })
    } catch (err) {
      return res.status(400).json({ message: `Could not parse CSV: ${err.message}` })
    }
    if (records.length === 0) {
      return res.status(400).json({ message: 'No rows found in that CSV' })
    }
    if (records.length > PRODUCT_IMPORT_MAX_ROWS) {
      return res.status(400).json({
        message: `That's ${records.length} rows — split imports into batches of ${PRODUCT_IMPORT_MAX_ROWS} or fewer.`,
      })
    }

    let created = 0
    let updated = 0
    const errors = []

    for (let i = 0; i < records.length; i++) {
      const row = records[i]
      const rowNum = i + 2 // +1 for 1-indexing, +1 for the header row
      const category = typeof row.category === 'string' ? row.category.trim() : ''
      const name = typeof row.name === 'string' ? row.name.trim() : ''
      if (!category || !name) {
        errors.push(`Row ${rowNum}: category and name are required`)
        continue
      }

      const fields = {}
      let rowError = null
      const numericField = (key, column, { integer = false } = {}) => {
        if (row[key] === undefined || row[key] === '') return
        const n = integer ? parseInt(row[key], 10) : Number(row[key])
        if (!Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n))) {
          rowError = `Row ${rowNum}: invalid ${key}`
          return
        }
        fields[column] = n
      }
      numericField('price', 'price')
      numericField('quantity', 'quantity', { integer: true })
      numericField('reorder_threshold', 'reorder_threshold', { integer: true })
      numericField('cost_price', 'cost_price')
      numericField('warranty_months', 'warranty_months', { integer: true })
      if (rowError) {
        errors.push(rowError)
        continue
      }
      if (row.hsn_code) fields.hsn_code = String(row.hsn_code).trim()
      if (row.barcode) fields.barcode = String(row.barcode).trim()

      try {
        const { rows: existing } = await pool.query(
          'SELECT id FROM products WHERE category = $1 AND name = $2',
          [category, name]
        )

        if (existing.length > 0) {
          const setCols = Object.keys(fields)
          if (setCols.length === 0) continue
          const setSql = setCols.map((c, idx) => `${c} = $${idx + 1}`).join(', ')
          const params = setCols.map((c) => fields[c])
          params.push(existing[0].id)
          await pool.query(`UPDATE products SET ${setSql} WHERE id = $${params.length}`, params)
          updated++
        } else {
          if (fields.price === undefined || fields.quantity === undefined) {
            errors.push(`Row ${rowNum}: new product "${name}" needs both price and quantity`)
            continue
          }
          await pool.query(
            `INSERT INTO products (category, name, price, quantity, hsn_code, reorder_threshold, cost_price, warranty_months, barcode)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              category, name, fields.price, fields.quantity,
              fields.hsn_code || null, fields.reorder_threshold ?? null,
              fields.cost_price ?? null, fields.warranty_months ?? null, fields.barcode || null,
            ]
          )
          created++
        }
      } catch (err) {
        errors.push(`Row ${rowNum}: ${err.message}`)
      }
    }

    await logAudit(pool, {
      user: req.user,
      action: 'product.bulk_import',
      details: { totalRows: records.length, created, updated, errorCount: errors.length },
    })

    res.json({ totalRows: records.length, created, updated, errorCount: errors.length, errors: errors.slice(0, 50) })
  } catch (err) {
    console.error('POST /api/products/import failed:', err)
    res.status(500).json({ message: 'Could not import catalogue' })
  }
})

// --- Suppliers ---

app.get('/api/suppliers', requireAuth, async (req, res) => {
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

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM suppliers ${where}`, params)
    const total = countResult.rows[0].total

    params.push(pageSize)
    params.push(offset)
    const itemsResult = await pool.query(
      `SELECT id, name, phone, email, address, gstin, notes, created_by_username, created_at
       FROM suppliers
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
    console.error('GET /api/suppliers failed:', err)
    res.status(500).json({ message: 'Could not load suppliers' })
  }
})

app.get('/api/suppliers/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid supplier id' })
    }

    const { rows } = await pool.query(
      `SELECT id, name, phone, email, address, gstin, notes, created_by_username, created_at
       FROM suppliers WHERE id = $1`,
      [id]
    )
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Supplier not found' })
    }

    const purchaseOrders = await pool.query(
      `SELECT id, po_number, po_date, grand_total, created_at
       FROM purchase_orders WHERE supplier_id = $1 ORDER BY created_at DESC`,
      [id]
    )

    res.json({ supplier: rows[0], purchaseOrders: purchaseOrders.rows })
  } catch (err) {
    console.error('GET /api/suppliers/:id failed:', err)
    res.status(500).json({ message: 'Could not load supplier' })
  }
})

app.post('/api/suppliers', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
  try {
    const { name, phone, email, address, gstin, notes } = req.body || {}
    const trimmedName = typeof name === 'string' ? name.trim() : ''
    if (!trimmedName) {
      return res.status(400).json({ message: 'Supplier name is required' })
    }

    const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

    const { rows } = await pool.query(
      `INSERT INTO suppliers (name, phone, email, address, gstin, notes, created_by_user_id, created_by_username)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, phone, email, address, gstin, notes, created_by_username, created_at`,
      [trimmedName, clean(phone), clean(email), clean(address), clean(gstin), clean(notes), req.user.id, req.user.username]
    )
    const supplier = rows[0]

    await logAudit(pool, {
      user: req.user,
      action: 'supplier.create',
      entityType: 'supplier',
      entityId: supplier.id,
      details: { name: supplier.name },
    })

    res.status(201).json({ supplier })
  } catch (err) {
    console.error('POST /api/suppliers failed:', err)
    res.status(500).json({ message: 'Could not create supplier' })
  }
})

app.patch('/api/suppliers/:id', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid supplier id' })
    }

    const sets = []
    const params = []
    const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

    if (typeof req.body?.name === 'string') {
      if (!req.body.name.trim()) {
        return res.status(400).json({ message: 'Supplier name cannot be empty' })
      }
      params.push(req.body.name.trim())
      sets.push(`name = $${params.length}`)
    }
    for (const field of ['phone', 'email', 'address', 'gstin', 'notes']) {
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
      `UPDATE suppliers SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, name, phone, email, address, gstin, notes, created_by_username, created_at`,
      params
    )
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Supplier not found' })
    }

    await logAudit(pool, {
      user: req.user,
      action: 'supplier.update',
      entityType: 'supplier',
      entityId: id,
      details: { fields: Object.keys(req.body || {}) },
    })

    res.json({ supplier: rows[0] })
  } catch (err) {
    console.error('PATCH /api/suppliers/:id failed:', err)
    res.status(500).json({ message: 'Could not update supplier' })
  }
})

// --- Purchase orders (receiving stock) ---

function validatePurchaseItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { ok: false, message: 'At least one line item is required' }
  }

  const items = []
  for (const raw of rawItems) {
    const category = typeof raw?.category === 'string' ? raw.category.trim() : ''
    const name = typeof raw?.name === 'string' ? raw.name.trim() : ''
    const quantity = Number(raw?.quantity)
    const costPrice = Number(raw?.costPrice)
    const productId = Number.isInteger(raw?.productId) ? raw.productId : parseInt(raw?.productId, 10)

    if (!category || !name) {
      return { ok: false, message: 'Each line item needs a category and product name' }
    }
    if (!Number.isInteger(productId) || productId <= 0) {
      return { ok: false, message: `Missing catalogue reference for "${name}" — re-add it from the picker.` }
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, message: `Invalid quantity for "${name}"` }
    }
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      return { ok: false, message: `Invalid cost price for "${name}"` }
    }

    items.push({ productId, category, name, quantity, costPrice })
  }

  return { ok: true, items }
}

app.post('/api/purchase-orders', requireAuth, requireRole('admin', 'sales', 'staff'), async (req, res) => {
  const client = await pool.connect()
  try {
    const { poNumber, poDate, supplierName, supplierId, items: rawItems } = req.body || {}

    const number = typeof poNumber === 'string' ? poNumber.trim() : ''
    if (!number) {
      return res.status(400).json({ message: 'PO number is required' })
    }
    if (!isValidDateString(poDate)) {
      return res.status(400).json({ message: 'A valid PO date (YYYY-MM-DD) is required' })
    }

    const validation = validatePurchaseItems(rawItems)
    if (!validation.ok) {
      return res.status(400).json({ message: validation.message })
    }

    let supId = null
    if (supplierId != null) {
      supId = parseInt(supplierId, 10)
      if (!Number.isInteger(supId)) {
        return res.status(400).json({ message: 'Invalid supplier reference' })
      }
    }

    const grandTotal = validation.items.reduce((sum, item) => sum + item.costPrice * item.quantity, 0)
    const supplier = typeof supplierName === 'string' && supplierName.trim() ? supplierName.trim() : null

    await client.query('BEGIN')

    // Receiving a PO increases stock immediately and records the price
    // paid as each product's latest cost.
    for (const item of validation.items) {
      const { rowCount } = await client.query(
        `UPDATE products SET quantity = quantity + $1, cost_price = $2 WHERE id = $3`,
        [item.quantity, item.costPrice, item.productId]
      )
      if (rowCount === 0) {
        await client.query('ROLLBACK')
        return res.status(400).json({ message: `Product "${item.name}" no longer exists in the catalogue.` })
      }
    }

    const { rows } = await client.query(
      `INSERT INTO purchase_orders
         (po_number, po_date, supplier_id, supplier_name, items, grand_total, created_by_user_id, created_by_username)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, po_number, po_date, supplier_id, supplier_name, items, grand_total, created_by_username, created_at`,
      [number, poDate, supId, supplier, JSON.stringify(validation.items), grandTotal, req.user.id, req.user.username]
    )
    const po = rows[0]

    await client.query('COMMIT')

    await logAudit(pool, {
      user: req.user,
      action: 'purchase_order.create',
      entityType: 'purchase_order',
      entityId: po.id,
      details: { poNumber: number, grandTotal, productIds: validation.items.map((i) => i.productId) },
    })

    res.status(201).json({ purchaseOrder: po })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    if (err.code === '23503') {
      return res.status(400).json({ message: 'That supplier no longer exists' })
    }
    console.error('POST /api/purchase-orders failed:', err)
    res.status(500).json({ message: 'Could not save purchase order' })
  } finally {
    client.release()
  }
})

// Excludes 'staff' deliberately — staff can create purchase orders but not
// browse the full PO history (see /api/quotations below for the same rule).
app.get('/api/purchase-orders', requireAuth, requireRole('admin', 'sales', 'accountant'), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100)
    const offset = (page - 1) * pageSize

    const params = []
    let where = ''
    if (req.query.q) {
      params.push(`%${req.query.q}%`)
      where = `WHERE po_number ILIKE $${params.length} OR supplier_name ILIKE $${params.length}`
    }

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM purchase_orders ${where}`, params)
    const total = countResult.rows[0].total

    params.push(pageSize)
    params.push(offset)
    const itemsResult = await pool.query(
      `SELECT id, po_number, po_date, supplier_id, supplier_name, items, grand_total, created_by_username, created_at
       FROM purchase_orders
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
    console.error('GET /api/purchase-orders failed:', err)
    res.status(500).json({ message: 'Could not load purchase orders' })
  }
})

// --- AMC contracts ---

app.get('/api/amc-contracts', requireAuth, requireRole('admin', 'sales', 'accountant'), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100)
    const offset = (page - 1) * pageSize

    const params = []
    let where = ''
    if (req.query.q) {
      params.push(`%${req.query.q}%`)
      where = `WHERE a.contract_number ILIKE $${params.length} OR c.name ILIKE $${params.length}`
    }
    if (req.query.status && ['active', 'expired', 'cancelled'].includes(req.query.status)) {
      params.push(req.query.status)
      where += `${where ? ' AND' : 'WHERE'} (
        CASE
          WHEN a.cancelled THEN 'cancelled'
          WHEN a.end_date >= CURRENT_DATE THEN 'active'
          ELSE 'expired'
        END
      ) = $${params.length}`
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM amc_contracts a LEFT JOIN customers c ON c.id = a.customer_id ${where}`,
      params
    )
    const total = countResult.rows[0].total

    params.push(pageSize)
    params.push(offset)
    const itemsResult = await pool.query(
      `SELECT a.id, a.contract_number, a.customer_id, c.name AS customer_name, a.start_date, a.end_date,
              a.amount, a.covered_devices, a.notes, a.cancelled, a.created_by_username, a.created_at,
              CASE
                WHEN a.cancelled THEN 'cancelled'
                WHEN a.end_date >= CURRENT_DATE THEN 'active'
                ELSE 'expired'
              END AS status
       FROM amc_contracts a
       LEFT JOIN customers c ON c.id = a.customer_id
       ${where}
       ORDER BY a.created_at DESC
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
    console.error('GET /api/amc-contracts failed:', err)
    res.status(500).json({ message: 'Could not load AMC contracts' })
  }
})

app.get('/api/amc-contracts/:id', requireAuth, requireRole('admin', 'sales', 'accountant'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid contract id' })
    }

    const { rows } = await pool.query(
      `SELECT a.id, a.contract_number, a.customer_id, c.name AS customer_name, a.start_date, a.end_date,
              a.amount, a.covered_devices, a.notes, a.cancelled, a.created_by_username, a.created_at,
              CASE
                WHEN a.cancelled THEN 'cancelled'
                WHEN a.end_date >= CURRENT_DATE THEN 'active'
                ELSE 'expired'
              END AS status
       FROM amc_contracts a
       LEFT JOIN customers c ON c.id = a.customer_id
       WHERE a.id = $1`,
      [id]
    )
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Contract not found' })
    }

    const tickets = await pool.query(
      `SELECT id, ticket_number, status, received_date, created_at
       FROM repair_tickets WHERE amc_contract_id = $1 ORDER BY created_at DESC`,
      [id]
    )

    res.json({ contract: rows[0], repairTickets: tickets.rows })
  } catch (err) {
    console.error('GET /api/amc-contracts/:id failed:', err)
    res.status(500).json({ message: 'Could not load contract' })
  }
})

app.post('/api/amc-contracts', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
  try {
    const { contractNumber, customerId, startDate, endDate, amount, coveredDevices, notes } = req.body || {}

    const number = typeof contractNumber === 'string' ? contractNumber.trim() : ''
    if (!number) {
      return res.status(400).json({ message: 'Contract number is required' })
    }
    const custId = parseInt(customerId, 10)
    if (!Number.isInteger(custId)) {
      return res.status(400).json({ message: 'A customer is required' })
    }
    if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
      return res.status(400).json({ message: 'Valid start and end dates (YYYY-MM-DD) are required' })
    }
    if (endDate < startDate) {
      return res.status(400).json({ message: 'End date cannot be before the start date' })
    }
    const amountNum = Number(amount)
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      return res.status(400).json({ message: 'Invalid amount' })
    }

    const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

    const { rows } = await pool.query(
      `INSERT INTO amc_contracts
         (contract_number, customer_id, start_date, end_date, amount, covered_devices, notes,
          created_by_user_id, created_by_username)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, contract_number, customer_id, start_date, end_date, amount, covered_devices, notes,
                 cancelled, created_by_username, created_at`,
      [number, custId, startDate, endDate, amountNum, clean(coveredDevices), clean(notes), req.user.id, req.user.username]
    )
    const contract = rows[0]

    await logAudit(pool, {
      user: req.user,
      action: 'amc_contract.create',
      entityType: 'amc_contract',
      entityId: contract.id,
      details: { contractNumber: number, customerId: custId },
    })

    res.status(201).json({ contract })
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ message: 'That customer no longer exists' })
    }
    console.error('POST /api/amc-contracts failed:', err)
    res.status(500).json({ message: 'Could not create contract' })
  }
})

app.patch('/api/amc-contracts/:id', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid contract id' })
    }

    const sets = []
    const params = []
    const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

    if (typeof req.body?.endDate === 'string') {
      if (!isValidDateString(req.body.endDate)) {
        return res.status(400).json({ message: 'Invalid end date' })
      }
      params.push(req.body.endDate)
      sets.push(`end_date = $${params.length}`)
    }
    if (req.body?.amount !== undefined) {
      const amountNum = Number(req.body.amount)
      if (!Number.isFinite(amountNum) || amountNum < 0) {
        return res.status(400).json({ message: 'Invalid amount' })
      }
      params.push(amountNum)
      sets.push(`amount = $${params.length}`)
    }
    if (typeof req.body?.coveredDevices === 'string') {
      params.push(clean(req.body.coveredDevices))
      sets.push(`covered_devices = $${params.length}`)
    }
    if (typeof req.body?.notes === 'string') {
      params.push(clean(req.body.notes))
      sets.push(`notes = $${params.length}`)
    }
    if (typeof req.body?.cancelled === 'boolean') {
      params.push(req.body.cancelled)
      sets.push(`cancelled = $${params.length}`)
    }

    if (sets.length === 0) {
      return res.status(400).json({ message: 'Nothing to update' })
    }

    params.push(id)
    const { rows } = await pool.query(
      `UPDATE amc_contracts SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, contract_number, customer_id, start_date, end_date, amount, covered_devices, notes,
                 cancelled, created_by_username, created_at`,
      params
    )
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Contract not found' })
    }

    await logAudit(pool, {
      user: req.user,
      action: 'amc_contract.update',
      entityType: 'amc_contract',
      entityId: id,
      details: { fields: Object.keys(req.body || {}) },
    })

    res.json({ contract: rows[0] })
  } catch (err) {
    console.error('PATCH /api/amc-contracts/:id failed:', err)
    res.status(500).json({ message: 'Could not update contract' })
  }
})

// --- Repair / service tickets ---

const TICKET_STATUSES = [
  'received', 'diagnosing', 'waiting_for_parts', 'in_repair', 'ready_for_pickup', 'completed', 'cancelled',
]

app.get('/api/repair-tickets', requireAuth, requireRole('admin', 'sales', 'accountant', 'technician'), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100)
    const offset = (page - 1) * pageSize

    const conditions = []
    const params = []
    // A technician only ever sees tickets assigned to them — forced
    // server-side from the token, not a client-supplied filter, so it
    // can't be queried around.
    if (req.user.role === 'technician') {
      params.push(req.user.username)
      conditions.push(`t.assigned_to_username = $${params.length}`)
    }
    if (req.query.q) {
      params.push(`%${req.query.q}%`)
      conditions.push(`(t.ticket_number ILIKE $${params.length} OR c.name ILIKE $${params.length} OR t.device_description ILIKE $${params.length})`)
    }
    if (req.query.status && TICKET_STATUSES.includes(req.query.status)) {
      params.push(req.query.status)
      conditions.push(`t.status = $${params.length}`)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM repair_tickets t LEFT JOIN customers c ON c.id = t.customer_id ${where}`,
      params
    )
    const total = countResult.rows[0].total

    params.push(pageSize)
    params.push(offset)
    const itemsResult = await pool.query(
      `SELECT t.id, t.ticket_number, t.customer_id, c.name AS customer_name, c.phone AS customer_phone,
              t.device_description, t.serial_number, t.reported_issue, t.diagnosis, t.status,
              t.estimated_cost, t.final_cost, t.invoice_number, t.amc_contract_id, t.warranty_days,
              t.received_date, t.completed_date, t.assigned_to_username, t.notes,
              t.hours_worked, t.parts_used,
              t.created_by_username, t.created_at
       FROM repair_tickets t
       LEFT JOIN customers c ON c.id = t.customer_id
       ${where}
       ORDER BY t.created_at DESC
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
    console.error('GET /api/repair-tickets failed:', err)
    res.status(500).json({ message: 'Could not load repair tickets' })
  }
})

app.get('/api/repair-tickets/:id', requireAuth, requireRole('admin', 'sales', 'accountant', 'technician'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid ticket id' })
    }

    const { rows } = await pool.query(
      `SELECT t.id, t.ticket_number, t.customer_id, c.name AS customer_name, c.phone AS customer_phone,
              c.address AS customer_address, t.device_description, t.serial_number, t.reported_issue,
              t.diagnosis, t.status, t.estimated_cost, t.final_cost, t.invoice_number, t.amc_contract_id,
              t.warranty_days, t.hours_worked, t.parts_used, t.received_date, t.completed_date,
              t.assigned_to_username, t.notes, t.created_by_username, t.created_at
       FROM repair_tickets t
       LEFT JOIN customers c ON c.id = t.customer_id
       WHERE t.id = $1`,
      [id]
    )
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Ticket not found' })
    }
    const ticket = rows[0]

    // Same as the list route — a technician can't view a ticket that
    // isn't theirs, even by guessing an id. 404 rather than 403 so it
    // doesn't confirm the ticket exists at all.
    if (req.user.role === 'technician' && ticket.assigned_to_username !== req.user.username) {
      return res.status(404).json({ message: 'Ticket not found' })
    }

    res.json({ ticket })
  } catch (err) {
    console.error('GET /api/repair-tickets/:id failed:', err)
    res.status(500).json({ message: 'Could not load ticket' })
  }
})

app.post('/api/repair-tickets', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
  try {
    const {
      ticketNumber, customerId, deviceDescription, serialNumber, reportedIssue,
      estimatedCost, receivedDate, amcContractId, assignedToUsername,
    } = req.body || {}

    const number = typeof ticketNumber === 'string' ? ticketNumber.trim() : ''
    if (!number) {
      return res.status(400).json({ message: 'Ticket number is required' })
    }
    const custId = parseInt(customerId, 10)
    if (!Number.isInteger(custId)) {
      return res.status(400).json({ message: 'A customer is required' })
    }
    const device = typeof deviceDescription === 'string' ? deviceDescription.trim() : ''
    if (!device) {
      return res.status(400).json({ message: 'Device description is required' })
    }
    const issue = typeof reportedIssue === 'string' ? reportedIssue.trim() : ''
    if (!issue) {
      return res.status(400).json({ message: 'Reported issue is required' })
    }
    if (!isValidDateString(receivedDate)) {
      return res.status(400).json({ message: 'A valid received date (YYYY-MM-DD) is required' })
    }

    let estCost = null
    if (estimatedCost !== undefined && estimatedCost !== null && estimatedCost !== '') {
      estCost = Number(estimatedCost)
      if (!Number.isFinite(estCost) || estCost < 0) {
        return res.status(400).json({ message: 'Invalid estimated cost' })
      }
    }
    let contractId = null
    if (amcContractId != null && amcContractId !== '') {
      contractId = parseInt(amcContractId, 10)
      if (!Number.isInteger(contractId)) {
        return res.status(400).json({ message: 'Invalid AMC contract reference' })
      }
    }

    const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

    const { rows } = await pool.query(
      `INSERT INTO repair_tickets
         (ticket_number, customer_id, device_description, serial_number, reported_issue,
          estimated_cost, received_date, amc_contract_id, assigned_to_username,
          created_by_user_id, created_by_username)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, ticket_number, customer_id, device_description, serial_number, reported_issue,
                 status, estimated_cost, received_date, amc_contract_id, assigned_to_username,
                 created_by_username, created_at`,
      [
        number, custId, device, clean(serialNumber), issue, estCost, receivedDate, contractId,
        clean(assignedToUsername), req.user.id, req.user.username,
      ]
    )
    const ticket = rows[0]

    await logAudit(pool, {
      user: req.user,
      action: 'repair_ticket.create',
      entityType: 'repair_ticket',
      entityId: ticket.id,
      details: { ticketNumber: number, customerId: custId },
    })

    res.status(201).json({ ticket })
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ message: 'That customer or AMC contract no longer exists' })
    }
    console.error('POST /api/repair-tickets failed:', err)
    res.status(500).json({ message: 'Could not create repair ticket' })
  }
})

app.patch('/api/repair-tickets/:id', requireAuth, requireRole('admin', 'sales', 'technician'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid ticket id' })
    }

    // A technician can move their own ticket's status along (e.g. mark
    // themselves as en route or diagnosing) but nothing else here —
    // diagnosis, cost, and the rest stay office-controlled. Billing (which
    // sets final_cost/invoice_number/status itself) goes through the
    // dedicated /bill endpoint below, not this general PATCH.
    if (req.user.role === 'technician') {
      const bodyKeys = Object.keys(req.body || {})
      if (bodyKeys.some((k) => k !== 'status')) {
        return res.status(403).json({ message: 'Technicians can only update ticket status here' })
      }
      const { rows: ownerCheck } = await pool.query('SELECT assigned_to_username FROM repair_tickets WHERE id = $1', [id])
      if (ownerCheck.length === 0 || ownerCheck[0].assigned_to_username !== req.user.username) {
        return res.status(404).json({ message: 'Ticket not found' })
      }
    }

    const sets = []
    const params = []
    const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

    if (typeof req.body?.status === 'string') {
      if (!TICKET_STATUSES.includes(req.body.status)) {
        return res.status(400).json({ message: `Status must be one of: ${TICKET_STATUSES.join(', ')}` })
      }
      params.push(req.body.status)
      sets.push(`status = $${params.length}`)
    }
    if (typeof req.body?.diagnosis === 'string') {
      params.push(clean(req.body.diagnosis))
      sets.push(`diagnosis = $${params.length}`)
    }
    if (req.body?.finalCost !== undefined) {
      const finalCost = req.body.finalCost === null || req.body.finalCost === '' ? null : Number(req.body.finalCost)
      if (finalCost !== null && (!Number.isFinite(finalCost) || finalCost < 0)) {
        return res.status(400).json({ message: 'Invalid final cost' })
      }
      params.push(finalCost)
      sets.push(`final_cost = $${params.length}`)
    }
    if (typeof req.body?.invoiceNumber === 'string') {
      params.push(clean(req.body.invoiceNumber))
      sets.push(`invoice_number = $${params.length}`)
    }
    if (req.body?.warrantyDays !== undefined) {
      const warrantyDays = req.body.warrantyDays === null || req.body.warrantyDays === '' ? null : parseInt(req.body.warrantyDays, 10)
      if (warrantyDays !== null && (!Number.isInteger(warrantyDays) || warrantyDays < 0)) {
        return res.status(400).json({ message: 'Invalid warranty days' })
      }
      params.push(warrantyDays)
      sets.push(`warranty_days = $${params.length}`)
    }
    if (typeof req.body?.completedDate === 'string') {
      if (req.body.completedDate && !isValidDateString(req.body.completedDate)) {
        return res.status(400).json({ message: 'Invalid completed date' })
      }
      params.push(req.body.completedDate || null)
      sets.push(`completed_date = $${params.length}`)
    }
    if (typeof req.body?.assignedToUsername === 'string') {
      params.push(clean(req.body.assignedToUsername))
      sets.push(`assigned_to_username = $${params.length}`)
    }
    if (typeof req.body?.notes === 'string') {
      params.push(clean(req.body.notes))
      sets.push(`notes = $${params.length}`)
    }

    if (sets.length === 0) {
      return res.status(400).json({ message: 'Nothing to update' })
    }

    params.push(id)
    const { rows } = await pool.query(
      `UPDATE repair_tickets SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, ticket_number, customer_id, device_description, serial_number, reported_issue,
                 diagnosis, status, estimated_cost, final_cost, invoice_number, amc_contract_id,
                 warranty_days, received_date, completed_date, assigned_to_username, notes,
                 created_by_username, created_at`,
      params
    )
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Ticket not found' })
    }

    await logAudit(pool, {
      user: req.user,
      action: 'repair_ticket.update',
      entityType: 'repair_ticket',
      entityId: id,
      details: { fields: Object.keys(req.body || {}) },
    })

    res.json({ ticket: rows[0] })
  } catch (err) {
    console.error('PATCH /api/repair-tickets/:id failed:', err)
    res.status(500).json({ message: 'Could not update repair ticket' })
  }
})

// Active technician accounts, for staff to assign a job to — not the
// general Users list, so 'sales' can populate this dropdown without
// admin-only user-management access.
app.get('/api/technicians', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, username, full_name FROM users WHERE role = 'technician' AND active = true ORDER BY username ASC`
    )
    res.json({ technicians: rows })
  } catch (err) {
    console.error('GET /api/technicians failed:', err)
    res.status(500).json({ message: 'Could not load technicians' })
  }
})

// The whole on-site billing flow in one atomic action: hours worked
// and/or parts fitted become an invoice and a payment together. Pricing
// is entirely server-computed — labor at the fixed rate above, parts at
// today's catalogue price — a technician only ever supplies the objective
// facts (hours, which product, how many), never an amount. A technician
// can only bill a ticket assigned to them, and only once.
app.post('/api/repair-tickets/:id/bill', requireAuth, requireRole('admin', 'sales', 'technician'), async (req, res) => {
  const client = await pool.connect()
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid ticket id' })
    }

    const { rows: ticketRows } = await client.query(
      `SELECT t.id, t.ticket_number, t.customer_id, c.name AS customer_name, c.phone AS customer_phone,
              c.address AS customer_address, t.assigned_to_username, t.invoice_number
       FROM repair_tickets t
       LEFT JOIN customers c ON c.id = t.customer_id
       WHERE t.id = $1`,
      [id]
    )
    if (ticketRows.length === 0) {
      return res.status(404).json({ message: 'Ticket not found' })
    }
    const ticket = ticketRows[0]

    if (req.user.role === 'technician' && ticket.assigned_to_username !== req.user.username) {
      return res.status(404).json({ message: 'Ticket not found' })
    }
    if (ticket.invoice_number) {
      return res.status(400).json({ message: `This ticket was already billed as invoice ${ticket.invoice_number}.` })
    }

    const { hoursWorked, parts: rawParts, invoiceNumber, invoiceDate, gstRate, amountReceived, paymentMethod } = req.body || {}

    const number = typeof invoiceNumber === 'string' ? invoiceNumber.trim() : ''
    if (!number) {
      return res.status(400).json({ message: 'Invoice number is required' })
    }
    if (!isValidDateString(invoiceDate)) {
      return res.status(400).json({ message: 'A valid invoice date (YYYY-MM-DD) is required' })
    }

    let hours = null
    if (hoursWorked !== undefined && hoursWorked !== null && hoursWorked !== '') {
      hours = Number(hoursWorked)
      if (!Number.isFinite(hours) || hours <= 0) {
        return res.status(400).json({ message: 'Hours worked must be a positive number' })
      }
    }

    const partsList = Array.isArray(rawParts) ? rawParts : []
    const parsedParts = []
    for (const raw of partsList) {
      const productId = parseInt(raw?.productId, 10)
      const quantity = parseInt(raw?.quantity, 10)
      if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity <= 0) {
        return res.status(400).json({ message: 'Each part needs a valid product and quantity' })
      }
      parsedParts.push({ productId, quantity })
    }

    if (hours === null && parsedParts.length === 0) {
      return res.status(400).json({ message: 'Log hours worked or at least one part used before billing.' })
    }

    await client.query('BEGIN')

    // Reduce stock for every part fitted — same no-overselling check as a
    // normal invoice, refusing (and rolling back) if anything's short.
    const items = []
    for (const part of parsedParts) {
      const { rows: updated } = await client.query(
        `UPDATE products SET quantity = quantity - $1 WHERE id = $2 AND quantity >= $1
         RETURNING id, category, name, price`,
        [part.quantity, part.productId]
      )
      if (updated.length === 0) {
        const { rows: existing } = await client.query('SELECT name, quantity FROM products WHERE id = $1', [part.productId])
        await client.query('ROLLBACK')
        if (existing.length === 0) {
          return res.status(400).json({ message: `Product ${part.productId} no longer exists in the catalogue.` })
        }
        return res.status(409).json({
          message: `Not enough stock for "${existing[0].name}" — requested ${part.quantity}, only ${existing[0].quantity} left.`,
        })
      }
      const product = updated[0]
      items.push({
        productId: product.id,
        category: product.category,
        name: product.name,
        quantity: part.quantity,
        catalPrice: Number(product.price),
        finalPrice: Number(product.price),
        sameAsCatalogue: true,
      })
    }

    if (hours !== null) {
      items.push({
        productId: null,
        category: 'Service',
        name: `Labor (service charge) — ${hours} hr${hours === 1 ? '' : 's'}`,
        quantity: hours,
        catalPrice: LABOR_RATE_PER_HOUR,
        finalPrice: LABOR_RATE_PER_HOUR,
        sameAsCatalogue: true,
      })
    }

    const { rate, subtotal, gstAmount, grandTotal } = computeGst(items, gstRate)

    const received = amountReceived === undefined || amountReceived === null || amountReceived === ''
      ? grandTotal
      : Number(amountReceived)
    if (!Number.isFinite(received) || received < 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: 'Invalid amount received' })
    }
    if (received > grandTotal + 0.01) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: 'Amount received cannot exceed the invoice total' })
    }

    const payment = typeof paymentMethod === 'string' && paymentMethod.trim() ? paymentMethod.trim() : null

    const { rows: invRows } = await client.query(
      `INSERT INTO invoices
         (invoice_number, invoice_date, customer_name, customer_id, customer_phone, customer_address,
          payment_method, ticket_number, items, subtotal, gst_rate, gst_amount, grand_total,
          created_by_user_id, created_by_username)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id, invoice_number, invoice_date, customer_name, customer_phone, customer_address,
                 payment_method, ticket_number, items, subtotal, gst_rate, gst_amount, grand_total, created_at`,
      [
        number, invoiceDate, ticket.customer_name || 'Walk-in', ticket.customer_id, ticket.customer_phone,
        ticket.customer_address, payment, ticket.ticket_number, JSON.stringify(items), subtotal, rate, gstAmount,
        grandTotal, req.user.id, req.user.username,
      ]
    )
    const invoice = invRows[0]

    if (received > 0) {
      await client.query(
        `INSERT INTO payments (invoice_id, amount, payment_method, payment_date, created_by_user_id, created_by_username)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [invoice.id, received, payment, invoiceDate, req.user.id, req.user.username]
      )
    }

    const { rows: updatedTicketRows } = await client.query(
      `UPDATE repair_tickets
       SET hours_worked = $1, parts_used = $2, final_cost = $3, invoice_number = $4,
           status = 'completed', completed_date = $5
       WHERE id = $6
       RETURNING id, ticket_number, status, final_cost, invoice_number, hours_worked, parts_used, completed_date`,
      [hours, JSON.stringify(items.filter((i) => i.productId)), grandTotal, number, invoiceDate, id]
    )

    await client.query('COMMIT')

    await logAudit(pool, {
      user: req.user,
      action: 'repair_ticket.bill',
      entityType: 'repair_ticket',
      entityId: id,
      details: { invoiceNumber: number, grandTotal, hoursWorked: hours, partCount: parsedParts.length },
    })

    res.status(201).json({
      invoice: { ...invoice, amount_paid: received, balance_due: grandTotal - received },
      ticket: updatedTicketRows[0],
    })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    if (err.code === '23503') {
      return res.status(400).json({ message: 'That customer no longer exists' })
    }
    console.error('POST /api/repair-tickets/:id/bill failed:', err)
    res.status(500).json({ message: 'Could not bill this ticket' })
  } finally {
    client.release()
  }
})

app.post('/api/quotations', requireAuth, requireRole('admin', 'sales', 'staff'), async (req, res) => {
  try {
    const { quotationNumber, quotationDate, customerName, customerId, items: rawItems, gstRate } = req.body || {}

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

    const { rate, subtotal, gstAmount, grandTotal } = computeGst(validation.items, gstRate)
    const customer = typeof customerName === 'string' && customerName.trim() ? customerName.trim() : null

    const { rows } = await pool.query(
      `INSERT INTO quotations
         (quotation_number, quotation_date, customer_name, customer_id, items, subtotal, gst_rate, gst_amount,
          grand_total, created_by_user_id, created_by_username)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, quotation_number, quotation_date, customer_name, customer_id, items, subtotal, gst_rate,
                 gst_amount, grand_total, created_by_username, created_at`,
      [number, quotationDate, customer, custId, JSON.stringify(validation.items), subtotal, rate, gstAmount, grandTotal, req.user.id, req.user.username]
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
// Excludes 'staff' deliberately — the role gets create-only access to
// quotations/POs (see the roles README section); browsing the saved list
// is not part of that.
app.get('/api/quotations', requireAuth, requireRole('admin', 'sales', 'accountant'), async (req, res) => {
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
      `SELECT id, quotation_number, quotation_date, customer_name, items, subtotal, gst_rate, gst_amount,
              grand_total, created_by_username, created_at
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
      ticketNumber,
      items: rawItems,
      amountReceived,
      gstRate,
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

    const { rate, subtotal, gstAmount, grandTotal } = computeGst(validation.items, gstRate)

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
    const refTicket =
      typeof ticketNumber === 'string' && ticketNumber.trim() ? ticketNumber.trim() : null

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
          payment_method, quotation_number, ticket_number, items, subtotal, gst_rate, gst_amount, grand_total,
          created_by_user_id, created_by_username)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id, invoice_number, invoice_date, customer_name, customer_phone, customer_address,
                 payment_method, quotation_number, ticket_number, items, subtotal, gst_rate, gst_amount,
                 grand_total, created_by_username, created_at`,
      [
        number, invoiceDate, customer, custId, phone, address, payment, refQuotation, refTicket,
        JSON.stringify(validation.items), subtotal, rate, gstAmount, grandTotal, req.user.id, req.user.username,
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

// Everything needed to build a return against a specific invoice: its
// line items, plus how much of each has already been returned via earlier
// credit notes (summed from their stored items JSONB) so the frontend can
// show — and the server can enforce — a per-line "returnable" ceiling.
app.get('/api/invoices/:id/return-summary', requireAuth, requireRole('admin', 'sales', 'accountant'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid invoice id' })
    }

    const { rows } = await pool.query(
      `SELECT id, invoice_number, customer_name, gst_rate, items FROM invoices WHERE id = $1`,
      [id]
    )
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Invoice not found' })
    }
    const invoice = rows[0]

    const returnedResult = await pool.query(
      `SELECT (item->>'productId')::int AS product_id, SUM((item->>'quantity')::int) AS returned_qty
       FROM credit_notes, jsonb_array_elements(items) AS item
       WHERE invoice_id = $1
       GROUP BY product_id`,
      [id]
    )
    const returnedMap = new Map(returnedResult.rows.map((r) => [r.product_id, Number(r.returned_qty)]))

    const items = (invoice.items || []).map((item) => {
      const alreadyReturned = returnedMap.get(item.productId) || 0
      return {
        ...item,
        alreadyReturned,
        maxReturnable: Math.max(item.quantity - alreadyReturned, 0),
      }
    })

    res.json({
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoice_number,
        customerName: invoice.customer_name,
        gstRate: invoice.gst_rate,
      },
      items,
    })
  } catch (err) {
    console.error('GET /api/invoices/:id/return-summary failed:', err)
    res.status(500).json({ message: 'Could not load return summary' })
  }
})

app.get('/api/invoices', requireAuth, requireRole('admin', 'sales', 'accountant'), async (req, res) => {
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
              i.customer_address, i.payment_method, i.quotation_number, i.ticket_number, i.items,
              i.subtotal, i.gst_rate, i.gst_amount, i.grand_total,
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

// --- Credit notes / returns ---

app.post('/api/credit-notes', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
  const client = await pool.connect()
  try {
    const { creditNoteNumber, invoiceId, reason, refundMethod, items: rawItems } = req.body || {}

    const number = typeof creditNoteNumber === 'string' ? creditNoteNumber.trim() : ''
    if (!number) {
      return res.status(400).json({ message: 'Credit note number is required' })
    }
    const invId = parseInt(invoiceId, 10)
    if (!Number.isInteger(invId)) {
      return res.status(400).json({ message: 'An invoice reference is required' })
    }
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return res.status(400).json({ message: 'Pick at least one item to return' })
    }

    const { rows: invoiceRows } = await client.query(
      `SELECT id, invoice_number, customer_name, gst_rate, items FROM invoices WHERE id = $1`,
      [invId]
    )
    if (invoiceRows.length === 0) {
      return res.status(404).json({ message: 'Invoice not found' })
    }
    const invoice = invoiceRows[0]
    const invoiceItemsByProduct = new Map((invoice.items || []).map((it) => [it.productId, it]))

    const returnedResult = await client.query(
      `SELECT (item->>'productId')::int AS product_id, SUM((item->>'quantity')::int) AS returned_qty
       FROM credit_notes, jsonb_array_elements(items) AS item
       WHERE invoice_id = $1
       GROUP BY product_id`,
      [invId]
    )
    const returnedMap = new Map(returnedResult.rows.map((r) => [r.product_id, Number(r.returned_qty)]))

    // Re-derive every return line from the invoice's own records — quantity
    // is the only thing trusted from the request; price, category, name,
    // and the returnable ceiling all come from the invoice and prior
    // credit notes, not the client.
    const returnItems = []
    for (const raw of rawItems) {
      const productId = parseInt(raw?.productId, 10)
      const quantity = Number(raw?.quantity)
      if (!Number.isInteger(productId) || !Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({ message: 'Each return line needs a valid product and quantity' })
      }
      const invoiceItem = invoiceItemsByProduct.get(productId)
      if (!invoiceItem) {
        return res.status(400).json({ message: `That invoice has no line item for product ${productId}` })
      }
      const alreadyReturned = returnedMap.get(productId) || 0
      const maxReturnable = invoiceItem.quantity - alreadyReturned
      if (quantity > maxReturnable) {
        return res.status(400).json({
          message: `Cannot return ${quantity} of "${invoiceItem.name}" — only ${maxReturnable} left returnable.`,
        })
      }
      returnItems.push({
        productId,
        category: invoiceItem.category,
        name: invoiceItem.name,
        quantity,
        finalPrice: invoiceItem.finalPrice,
      })
    }

    const subtotal = computeSubtotal(returnItems)
    const gstRate = Number(invoice.gst_rate) || 0
    const gstAmount = Math.round(subtotal * (gstRate / 100) * 100) / 100
    const grandTotal = subtotal + gstAmount

    await client.query('BEGIN')

    // Returned stock goes back on the shelf — mirrors how a purchase order
    // increases quantity and an invoice decreases it.
    for (const item of returnItems) {
      await client.query('UPDATE products SET quantity = quantity + $1 WHERE id = $2', [item.quantity, item.productId])
    }

    const { rows } = await client.query(
      `INSERT INTO credit_notes
         (credit_note_number, invoice_id, invoice_number, customer_name, reason, refund_method,
          items, subtotal, gst_rate, gst_amount, grand_total, created_by_user_id, created_by_username)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, credit_note_number, invoice_id, invoice_number, customer_name, reason, refund_method,
                 items, subtotal, gst_rate, gst_amount, grand_total, created_by_username, created_at`,
      [
        number, invId, invoice.invoice_number, invoice.customer_name,
        typeof reason === 'string' && reason.trim() ? reason.trim() : null,
        typeof refundMethod === 'string' && refundMethod.trim() ? refundMethod.trim() : null,
        JSON.stringify(returnItems), subtotal, gstRate, gstAmount, grandTotal, req.user.id, req.user.username,
      ]
    )
    const creditNote = rows[0]

    await client.query('COMMIT')

    await logAudit(pool, {
      user: req.user,
      action: 'credit_note.create',
      entityType: 'credit_note',
      entityId: creditNote.id,
      details: { creditNoteNumber: number, invoiceId: invId, grandTotal },
    })

    res.status(201).json({ creditNote })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('POST /api/credit-notes failed:', err)
    res.status(500).json({ message: 'Could not save credit note' })
  } finally {
    client.release()
  }
})

app.get('/api/credit-notes', requireAuth, requireRole('admin', 'sales', 'accountant'), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100)
    const offset = (page - 1) * pageSize

    const params = []
    let where = ''
    if (req.query.q) {
      params.push(`%${req.query.q}%`)
      where = `WHERE credit_note_number ILIKE $${params.length} OR invoice_number ILIKE $${params.length} OR customer_name ILIKE $${params.length}`
    }
    if (req.query.invoiceId) {
      const invId = parseInt(req.query.invoiceId, 10)
      if (Number.isInteger(invId)) {
        params.push(invId)
        where += `${where ? ' AND' : 'WHERE'} invoice_id = $${params.length}`
      }
    }

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM credit_notes ${where}`, params)
    const total = countResult.rows[0].total

    params.push(pageSize)
    params.push(offset)
    const itemsResult = await pool.query(
      `SELECT id, credit_note_number, invoice_id, invoice_number, customer_name, reason, refund_method,
              items, subtotal, gst_rate, gst_amount, grand_total, created_by_username, created_at
       FROM credit_notes
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
    console.error('GET /api/credit-notes failed:', err)
    res.status(500).json({ message: 'Could not load credit notes' })
  }
})

// --- Dashboard summary ---

app.get('/api/dashboard-summary', requireAuth, requireRole('admin', 'sales', 'accountant'), async (req, res) => {
  try {
    const [salesThisMonth, receivables, lowStock, openTickets, activeAmc, expiringAmc, recentInvoices] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(grand_total), 0) AS total, COUNT(*)::int AS count
         FROM invoices WHERE invoice_date >= date_trunc('month', CURRENT_DATE)`
      ),
      pool.query(
        `SELECT COALESCE(SUM(i.grand_total - COALESCE(pay.paid, 0)), 0) AS total
         FROM invoices i
         LEFT JOIN LATERAL (SELECT SUM(amount) AS paid FROM payments WHERE invoice_id = i.id) pay ON true
         WHERE COALESCE(pay.paid, 0) < i.grand_total`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM products WHERE reorder_threshold IS NOT NULL AND quantity <= reorder_threshold`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM repair_tickets WHERE status NOT IN ('completed', 'cancelled')`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM amc_contracts WHERE NOT cancelled AND end_date >= CURRENT_DATE`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM amc_contracts
         WHERE NOT cancelled AND end_date >= CURRENT_DATE AND end_date <= CURRENT_DATE + INTERVAL '30 days'`
      ),
      pool.query(
        `SELECT invoice_number, customer_name, grand_total, invoice_date
         FROM invoices ORDER BY created_at DESC LIMIT 5`
      ),
    ])

    res.json({
      salesThisMonth: Number(salesThisMonth.rows[0].total),
      invoiceCountThisMonth: salesThisMonth.rows[0].count,
      outstandingReceivables: Number(receivables.rows[0].total),
      lowStockCount: lowStock.rows[0].count,
      openRepairTickets: openTickets.rows[0].count,
      activeAmcContracts: activeAmc.rows[0].count,
      amcContractsExpiringSoon: expiringAmc.rows[0].count,
      recentInvoices: recentInvoices.rows,
    })
  } catch (err) {
    console.error('GET /api/dashboard-summary failed:', err)
    res.status(500).json({ message: 'Could not load dashboard summary' })
  }
})

// --- Staff Monitoring (HR roster) ---

app.get('/api/staff', requireAuth, requireRole('admin', 'accountant'), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100)
    const offset = (page - 1) * pageSize

    const params = []
    let where = ''
    if (req.query.q) {
      params.push(`%${req.query.q}%`)
      where = `WHERE name ILIKE $${params.length} OR position ILIKE $${params.length}`
    }
    if (req.query.active === 'true' || req.query.active === 'false') {
      params.push(req.query.active === 'true')
      where += `${where ? ' AND' : 'WHERE'} active = $${params.length}`
    }

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM staff_members ${where}`, params)
    const total = countResult.rows[0].total

    params.push(pageSize)
    params.push(offset)
    const itemsResult = await pool.query(
      `SELECT id, name, position, phone, email, join_date, salary, earned_leave_balance, active, notes,
              created_by_username, created_at
       FROM staff_members
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
    console.error('GET /api/staff failed:', err)
    res.status(500).json({ message: 'Could not load staff' })
  }
})

app.get('/api/staff/:id', requireAuth, requireRole('admin', 'accountant'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid staff id' })
    }

    const { rows } = await pool.query(
      `SELECT id, name, position, phone, email, join_date, salary, earned_leave_balance, active, notes,
              created_by_username, created_at
       FROM staff_members WHERE id = $1`,
      [id]
    )
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Staff member not found' })
    }

    const payroll = await pool.query(
      `SELECT id, pay_period, payment_date, salary_amount, bonus_amount, reimbursement_amount,
              (salary_amount + bonus_amount + reimbursement_amount) AS total_amount, notes, created_at
       FROM payroll_records WHERE staff_id = $1 ORDER BY payment_date DESC, id DESC`,
      [id]
    )

    res.json({ staff: rows[0], payrollRecords: payroll.rows })
  } catch (err) {
    console.error('GET /api/staff/:id failed:', err)
    res.status(500).json({ message: 'Could not load staff member' })
  }
})

app.post('/api/staff', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, position, phone, email, joinDate, salary, earnedLeaveBalance, notes } = req.body || {}

    const cleanName = typeof name === 'string' ? name.trim() : ''
    if (!cleanName) {
      return res.status(400).json({ message: 'Name is required' })
    }
    const salaryNum = salary === undefined || salary === null || salary === '' ? 0 : Number(salary)
    if (!Number.isFinite(salaryNum) || salaryNum < 0) {
      return res.status(400).json({ message: 'Invalid salary' })
    }
    const leaveNum = earnedLeaveBalance === undefined || earnedLeaveBalance === null || earnedLeaveBalance === ''
      ? 0 : Number(earnedLeaveBalance)
    if (!Number.isFinite(leaveNum) || leaveNum < 0) {
      return res.status(400).json({ message: 'Invalid earned leave balance' })
    }
    if (joinDate && !isValidDateString(joinDate)) {
      return res.status(400).json({ message: 'Invalid join date' })
    }

    const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

    const { rows } = await pool.query(
      `INSERT INTO staff_members
         (name, position, phone, email, join_date, salary, earned_leave_balance, notes,
          created_by_user_id, created_by_username)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, name, position, phone, email, join_date, salary, earned_leave_balance, active, notes,
                 created_by_username, created_at`,
      [cleanName, clean(position), clean(phone), clean(email), joinDate || null, salaryNum, leaveNum, clean(notes), req.user.id, req.user.username]
    )
    const staff = rows[0]

    await logAudit(pool, {
      user: req.user,
      action: 'staff.create',
      entityType: 'staff_member',
      entityId: staff.id,
      details: { name: cleanName },
    })

    res.status(201).json({ staff })
  } catch (err) {
    console.error('POST /api/staff failed:', err)
    res.status(500).json({ message: 'Could not create staff member' })
  }
})

app.patch('/api/staff/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid staff id' })
    }

    const sets = []
    const params = []
    const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

    if (typeof req.body?.name === 'string') {
      const n = req.body.name.trim()
      if (!n) {
        return res.status(400).json({ message: 'Name cannot be blank' })
      }
      params.push(n)
      sets.push(`name = $${params.length}`)
    }
    if (typeof req.body?.position === 'string') {
      params.push(clean(req.body.position))
      sets.push(`position = $${params.length}`)
    }
    if (typeof req.body?.phone === 'string') {
      params.push(clean(req.body.phone))
      sets.push(`phone = $${params.length}`)
    }
    if (typeof req.body?.email === 'string') {
      params.push(clean(req.body.email))
      sets.push(`email = $${params.length}`)
    }
    if (req.body?.joinDate !== undefined) {
      if (req.body.joinDate && !isValidDateString(req.body.joinDate)) {
        return res.status(400).json({ message: 'Invalid join date' })
      }
      params.push(req.body.joinDate || null)
      sets.push(`join_date = $${params.length}`)
    }
    if (req.body?.salary !== undefined) {
      const n = Number(req.body.salary)
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ message: 'Invalid salary' })
      }
      params.push(n)
      sets.push(`salary = $${params.length}`)
    }
    if (req.body?.earnedLeaveBalance !== undefined) {
      const n = Number(req.body.earnedLeaveBalance)
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ message: 'Invalid earned leave balance' })
      }
      params.push(n)
      sets.push(`earned_leave_balance = $${params.length}`)
    }
    if (typeof req.body?.active === 'boolean') {
      params.push(req.body.active)
      sets.push(`active = $${params.length}`)
    }
    if (typeof req.body?.notes === 'string') {
      params.push(clean(req.body.notes))
      sets.push(`notes = $${params.length}`)
    }

    if (sets.length === 0) {
      return res.status(400).json({ message: 'Nothing to update' })
    }

    params.push(id)
    const { rows } = await pool.query(
      `UPDATE staff_members SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, name, position, phone, email, join_date, salary, earned_leave_balance, active, notes,
                 created_by_username, created_at`,
      params
    )
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Staff member not found' })
    }

    await logAudit(pool, {
      user: req.user,
      action: 'staff.update',
      entityType: 'staff_member',
      entityId: id,
      details: { fields: Object.keys(req.body || {}) },
    })

    res.json({ staff: rows[0] })
  } catch (err) {
    console.error('PATCH /api/staff/:id failed:', err)
    res.status(500).json({ message: 'Could not update staff member' })
  }
})

// --- Payroll & Compensation ---

app.get('/api/payroll', requireAuth, requireRole('admin', 'accountant'), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100)
    const offset = (page - 1) * pageSize

    const conditions = []
    const params = []
    if (req.query.q) {
      params.push(`%${req.query.q}%`)
      conditions.push(`(s.name ILIKE $${params.length} OR p.pay_period ILIKE $${params.length})`)
    }
    if (req.query.staffId) {
      const staffId = parseInt(req.query.staffId, 10)
      if (Number.isInteger(staffId)) {
        params.push(staffId)
        conditions.push(`p.staff_id = $${params.length}`)
      }
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM payroll_records p LEFT JOIN staff_members s ON s.id = p.staff_id ${where}`,
      params
    )
    const total = countResult.rows[0].total

    params.push(pageSize)
    params.push(offset)
    const itemsResult = await pool.query(
      `SELECT p.id, p.staff_id, s.name AS staff_name, p.pay_period, p.payment_date,
              p.salary_amount, p.bonus_amount, p.reimbursement_amount,
              (p.salary_amount + p.bonus_amount + p.reimbursement_amount) AS total_amount,
              p.notes, p.created_by_username, p.created_at
       FROM payroll_records p
       LEFT JOIN staff_members s ON s.id = p.staff_id
       ${where}
       ORDER BY p.payment_date DESC, p.id DESC
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
    console.error('GET /api/payroll failed:', err)
    res.status(500).json({ message: 'Could not load payroll records' })
  }
})

app.post('/api/payroll', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { staffId, payPeriod, paymentDate, salaryAmount, bonusAmount, reimbursementAmount, notes } = req.body || {}

    const sid = parseInt(staffId, 10)
    if (!Number.isInteger(sid)) {
      return res.status(400).json({ message: 'A staff member is required' })
    }
    const period = typeof payPeriod === 'string' ? payPeriod.trim() : ''
    if (!period) {
      return res.status(400).json({ message: 'Pay period is required (e.g. "2026-09")' })
    }
    if (!isValidDateString(paymentDate)) {
      return res.status(400).json({ message: 'A valid payment date (YYYY-MM-DD) is required' })
    }

    const num = (v) => {
      if (v === undefined || v === null || v === '') return 0
      return Number(v)
    }
    const salaryNum = num(salaryAmount)
    const bonusNum = num(bonusAmount)
    const reimbursementNum = num(reimbursementAmount)
    for (const [label, n] of [['salary amount', salaryNum], ['bonus amount', bonusNum], ['reimbursement amount', reimbursementNum]]) {
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ message: `Invalid ${label}` })
      }
    }
    if (salaryNum === 0 && bonusNum === 0 && reimbursementNum === 0) {
      return res.status(400).json({ message: 'Enter at least one non-zero amount' })
    }

    const { rows } = await pool.query(
      `INSERT INTO payroll_records
         (staff_id, pay_period, payment_date, salary_amount, bonus_amount, reimbursement_amount, notes,
          created_by_user_id, created_by_username)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, staff_id, pay_period, payment_date, salary_amount, bonus_amount, reimbursement_amount,
                 (salary_amount + bonus_amount + reimbursement_amount) AS total_amount,
                 notes, created_by_username, created_at`,
      [sid, period, paymentDate, salaryNum, bonusNum, reimbursementNum,
        typeof notes === 'string' && notes.trim() ? notes.trim() : null, req.user.id, req.user.username]
    )
    const record = rows[0]

    await logAudit(pool, {
      user: req.user,
      action: 'payroll.create',
      entityType: 'payroll_record',
      entityId: record.id,
      details: { staffId: sid, payPeriod: period, totalAmount: record.total_amount },
    })

    res.status(201).json({ payrollRecord: record })
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ message: 'That staff member no longer exists' })
    }
    console.error('POST /api/payroll failed:', err)
    res.status(500).json({ message: 'Could not create payroll record' })
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
