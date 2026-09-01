const { Pool } = require('pg')

if (!process.env.DATABASE_URL) {
  // Don't crash on boot if the DB isn't wired up yet — routes that need it
  // will fail with a clear error instead of the whole server refusing to start.
  console.warn('DATABASE_URL is not set — database-backed routes will fail.')
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway's managed Postgres uses a certificate that isn't in the default
  // trust store; this matches Railway's own connection guidance.
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
})

module.exports = pool
