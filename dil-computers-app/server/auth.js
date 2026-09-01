const crypto = require('crypto')

// Lightweight signed-token auth for the single hardcoded admin account.
// No session store needed: the token is self-verifying (HMAC signature +
// expiry), so any server instance can validate it statelessly.

const SECRET = process.env.AUTH_SECRET || 'dev-only-insecure-secret-change-me'
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours

function sign(subject, expiresAt) {
  const payload = `${subject}.${expiresAt}`
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex')
  return Buffer.from(`${payload}.${sig}`).toString('base64url')
}

function issueToken(subject) {
  const expiresAt = Date.now() + TOKEN_TTL_MS
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

    return { subject }
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
  const session = verifyToken(token)
  if (!session) {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
  req.user = session
  next()
}

module.exports = { issueToken, verifyToken, requireAuth }
