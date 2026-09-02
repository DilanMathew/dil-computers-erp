import { useState, useEffect } from 'react'
import Dashboard from './Dashboard'
import { apiFetch } from './api'

const AUTH_KEY = 'dil_auth_token'

function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()
      if (res.ok && data.token) {
        onLogin(data.token, data.user)
      } else {
        setError(data.message || 'Invalid username or password')
      }
    } catch (err) {
      setError('Could not reach the server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.page}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <h1 style={styles.title}>DIL Computers</h1>
        <p style={styles.subtitle}>Sign in to continue</p>

        <label style={styles.label} htmlFor="username">Username</label>
        <input
          id="username"
          style={styles.input}
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />

        <label style={styles.label} htmlFor="password">Password</label>
        <input
          id="password"
          style={styles.input}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        {error && <div style={styles.error}>{error}</div>}

        <button style={styles.button} type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

export default function App() {
  const [token, setToken] = useState(null)
  const [user, setUser] = useState(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    const saved = window.localStorage.getItem(AUTH_KEY)
    if (!saved) {
      setChecked(true)
      return
    }

    // Restore the logged-in user from the token rather than trusting
    // anything cached — this also catches a token that expired or an
    // account that was deactivated while the tab was closed.
    apiFetch('/api/me', saved)
      .then((data) => {
        setToken(saved)
        setUser(data.user)
      })
      .catch(() => {
        window.localStorage.removeItem(AUTH_KEY)
      })
      .finally(() => setChecked(true))
  }, [])

  function handleLogin(newToken, newUser) {
    window.localStorage.setItem(AUTH_KEY, newToken)
    setToken(newToken)
    setUser(newUser)
  }

  function handleLogout() {
    window.localStorage.removeItem(AUTH_KEY)
    setToken(null)
    setUser(null)
  }

  if (!checked) return null

  return token && user ? (
    <Dashboard token={token} user={user} onLogout={handleLogout} />
  ) : (
    <LoginPage onLogin={handleLogin} />
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    background: '#ffffff',
    borderRadius: 12,
    padding: '32px 28px',
    boxShadow: '0 20px 45px rgba(15, 23, 42, 0.35)',
  },
  title: {
    margin: '0 0 4px 0',
    fontSize: 24,
    color: '#0f172a',
  },
  subtitle: {
    margin: '0 0 24px 0',
    fontSize: 14,
    color: '#64748b',
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#334155',
    marginBottom: 6,
    marginTop: 14,
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    outline: 'none',
  },
  button: {
    width: '100%',
    marginTop: 22,
    padding: '11px 12px',
    borderRadius: 8,
    border: 'none',
    background: '#1e3a8a',
    color: '#fff',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  },
  error: {
    marginTop: 14,
    padding: '8px 10px',
    borderRadius: 8,
    background: '#fef2f2',
    color: '#b91c1c',
    fontSize: 13,
  },
}
