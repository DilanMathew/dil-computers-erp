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

// Serve the built React app in production.
const clientDist = path.join(__dirname, '..', 'client', 'dist')
app.use(express.static(clientDist))

app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`DIL Computers server listening on port ${PORT}`)
})
