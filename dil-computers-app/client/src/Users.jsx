import { useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'

const ROLES = ['admin', 'sales', 'accountant', 'staff']

function formatDate(value) {
  return typeof value === 'string' ? value.slice(0, 10) : value
}

export default function Users({ token, user: currentUser, onLogout }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('sales')
  const [formError, setFormError] = useState('')
  const [creating, setCreating] = useState(false)

  const [resetTargetId, setResetTargetId] = useState(null)
  const [resetPassword, setResetPassword] = useState('')
  const [rowError, setRowError] = useState('')

  function loadUsers() {
    setLoading(true)
    setError('')
    apiFetch('/api/users', token)
      .then((data) => setUsers(data.users || []))
      .catch((err) => {
        if (err instanceof AuthError) onLogout()
        else setError(err.message)
      })
      .finally(() => setLoading(false))
  }

  useEffect(loadUsers, [token, onLogout])

  async function handleCreate(e) {
    e.preventDefault()
    setFormError('')

    if (!username.trim()) {
      setFormError('Username is required.')
      return
    }
    if (password.length < 6) {
      setFormError('Password must be at least 6 characters.')
      return
    }

    setCreating(true)
    try {
      await apiFetch('/api/users', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password, fullName, role }),
      })
      setUsername('')
      setPassword('')
      setFullName('')
      setRole('sales')
      loadUsers()
    } catch (err) {
      if (err instanceof AuthError) onLogout()
      else setFormError(err.message || 'Could not create user.')
    } finally {
      setCreating(false)
    }
  }

  async function updateUser(id, patch) {
    setRowError('')
    try {
      await apiFetch(`/api/users/${id}`, token, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      loadUsers()
    } catch (err) {
      if (err instanceof AuthError) onLogout()
      else setRowError(err.message || 'Could not update user.')
    }
  }

  async function handleResetPassword(id) {
    if (resetPassword.length < 6) {
      setRowError('Password must be at least 6 characters.')
      return
    }
    await updateUser(id, { password: resetPassword })
    setResetTargetId(null)
    setResetPassword('')
  }

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>Users</h2>
        <p style={styles.subtitle}>Manage accounts, roles, and access.</p>
      </header>

      <form style={styles.card} onSubmit={handleCreate}>
        <h3 style={styles.cardTitle}>Add a user</h3>
        <div style={styles.formGrid}>
          <div>
            <label style={styles.label} htmlFor="newUsername">Username</label>
            <input
              id="newUsername"
              style={styles.input}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div>
            <label style={styles.label} htmlFor="newPassword">Password</label>
            <input
              id="newPassword"
              style={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
          </div>
          <div>
            <label style={styles.label} htmlFor="newFullName">Full name (optional)</label>
            <input
              id="newFullName"
              style={styles.input}
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div>
            <label style={styles.label} htmlFor="newRole">Role</label>
            <select id="newRole" style={styles.input} value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>

        {formError && <div style={styles.error}>{formError}</div>}

        <button type="submit" style={styles.addButton} disabled={creating}>
          {creating ? 'Adding…' : '+ Add user'}
        </button>
      </form>

      {error && <div style={styles.error}>{error}</div>}
      {rowError && <div style={styles.error}>{rowError}</div>}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Username</th>
              <th style={styles.th}>Full name</th>
              <th style={styles.th}>Role</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Created</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td style={styles.td} colSpan={6}>Loading…</td></tr>
            ) : users.length === 0 ? (
              <tr><td style={styles.td} colSpan={6}>No users yet.</td></tr>
            ) : (
              users.map((u) => (
                <tr key={u.id}>
                  <td style={styles.td}>{u.username}</td>
                  <td style={styles.td}>{u.full_name || '—'}</td>
                  <td style={styles.td}>
                    <select
                      style={styles.rowSelect}
                      value={u.role}
                      disabled={u.id === currentUser.id}
                      onChange={(e) => updateUser(u.id, { role: e.target.value })}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td style={styles.td}>
                    <button
                      type="button"
                      style={u.active ? styles.activeBadge : styles.inactiveBadge}
                      disabled={u.id === currentUser.id}
                      onClick={() => updateUser(u.id, { active: !u.active })}
                    >
                      {u.active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td style={styles.td}>{formatDate(u.created_at)}</td>
                  <td style={styles.td}>
                    {resetTargetId === u.id ? (
                      <div style={styles.resetRow}>
                        <input
                          style={styles.resetInput}
                          type="password"
                          placeholder="New password"
                          value={resetPassword}
                          onChange={(e) => setResetPassword(e.target.value)}
                        />
                        <button type="button" style={styles.smallButton} onClick={() => handleResetPassword(u.id)}>
                          Save
                        </button>
                        <button
                          type="button"
                          style={styles.smallButtonSecondary}
                          onClick={() => { setResetTargetId(null); setResetPassword('') }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        style={styles.smallButtonSecondary}
                        onClick={() => setResetTargetId(u.id)}
                      >
                        Reset password
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const styles = {
  header: { marginBottom: 20 },
  title: { margin: 0, fontSize: 18, color: '#0f172a' },
  subtitle: { margin: '4px 0 0 0', color: '#64748b', fontSize: 14 },
  card: {
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
    background: '#f8fafc',
  },
  cardTitle: { margin: '0 0 12px 0', fontSize: 15, color: '#0f172a' },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#334155',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    outline: 'none',
    background: '#fff',
  },
  error: {
    marginTop: 12,
    marginBottom: 12,
    padding: '10px 12px',
    borderRadius: 8,
    background: '#fef2f2',
    color: '#b91c1c',
    fontSize: 13,
  },
  addButton: {
    marginTop: 14,
    padding: '9px 16px',
    borderRadius: 8,
    border: 'none',
    background: '#334155',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  tableWrap: {
    overflowX: 'auto',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 14,
  },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    color: '#334155',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '10px 12px',
    borderBottom: '1px solid #f1f5f9',
    color: '#0f172a',
  },
  rowSelect: {
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    fontSize: 13,
  },
  activeBadge: {
    padding: '4px 10px',
    borderRadius: 999,
    border: '1px solid #bbf7d0',
    background: '#f0fdf4',
    color: '#166534',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  inactiveBadge: {
    padding: '4px 10px',
    borderRadius: 999,
    border: '1px solid #fecaca',
    background: '#fef2f2',
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  resetRow: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
  },
  resetInput: {
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    fontSize: 13,
    width: 130,
  },
  smallButton: {
    padding: '6px 10px',
    borderRadius: 6,
    border: 'none',
    background: '#1e3a8a',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  smallButtonSecondary: {
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    background: '#fff',
    color: '#334155',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
}
