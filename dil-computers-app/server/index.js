const path = require('path')
const crypto = require('crypto')
const express = require('express')

const app = express()
const PORT = process.env.PORT || 5000

// Credentials for now are hardcoded as requested. Can be overridden with
// env vars (ADMIN_USERNAME / ADMIN_PASSWORD) without touching code.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'

app.use(express.json())

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {}

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    // Simple opaque token — good enough for a single hardcoded account.
    // Swap for a real session/JWT scheme once there's more than one user.
    const token = crypto.randomBytes(24).toString('hex')
    return res.json({ token })
  }

  return res.status(401).json({ message: 'Invalid username or password' })
})

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
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
