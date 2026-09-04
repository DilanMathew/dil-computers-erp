const crypto = require('crypto')
const bcrypt = require('bcryptjs')

// Signed-token auth backed by the "users" table. The token is
// self-verifying (HMAC signature + expiry) so any server instance can
// validate it statelessly — no session store needed. The subject is the
// user's {id, username, role}, base64url-encoded before signing so it can
// safely contain "." (JSON strings sometimes do, e.g. a versioned username)
// without upsetting the "." split used to unpack the token.

const SECRET = process.env.AUTH_SECRET || 'dev-only-insecure-secret-change-me'
if (!process.env.AUTH_SECRET) {
  console.warn(
    'AUTH_SECRET is not set — falling back to an insecure default. ' +
      'Set a real AUTH_SECRET before deploying anywhere real users will log in.'
  )
}
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours
const BCRYPT_ROUNDS = 10

const ROLES = ['admin', 'sales', 'accountant', 'staff', 'technician']

function sign(subject, expiresAt) {
  const payload = `${subject}.${expiresAt}`
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex')
  return Buffer.from(`${payload}.${sig}`).toString('base64url')
}

// userPayload: { id, username, role }
function issueToken(userPayload) {
  const expiresAt = Date.now() + TOKEN_TTL_MS
  const subject = Buffer.from(JSON.stringify(userPayload)).toString('base64url')
  return sign(subject, expiresAt)
}

function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const [subject, expiresAtStr, sig] = decoded.split('.')
    const expiresAt = Number(expiresAtStr)
    if (!subject || !expiresAt || !sig) return null

    const expected = crypto
      .createHmac('sha256', SECRET)
      .update(`${subject}.${expiresAtStr}`)
      .digest('hex')

    const sigBuf = Buffer.from(sig)
    const expectedBuf = Buffer.from(expected)
    if (sigBuf.length !== expectedBuf.length) return null
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null

    if (Date.now() > expiresAt) return null

    const userPayload = JSON.parse(Buffer.from(subject, 'base64url').toString('utf8'))
    if (!userPayload || !userPayload.id || !userPayload.username || !userPayload.role) return null

    return userPayload
  } catch (err) {
    return null
  }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Missing or invalid Authorization header' })
  }
  const user = verifyToken(token)
  if (!user) {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
  req.user = user
  next()
}

// requireRole('admin') or requireRole('admin', 'sales') — must follow
// requireAuth on the same route so req.user is already set.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to do that' })
    }
    next()
  }
}

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash)
}

module.exports = {
  ROLES,
  issueToken,
  verifyToken,
  requireAuth,
  requireRole,
  hashPassword,
  verifyPassword,
}
