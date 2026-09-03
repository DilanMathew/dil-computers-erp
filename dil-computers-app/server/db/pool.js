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

// An idle client can emit an 'error' event (e.g. the connection was reset
// by the server) outside of any query. Without a handler, that's an
// unhandled 'error' event and Node kills the whole process — one bad
// connection shouldn't take the server down.
pool.on('error', (err) => {
  console.error('Unexpected error on an idle Postgres client:', err)
})

module.exports = pool
