import { Fragment, useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'
import { formatPrice } from './format'

const PAGE_SIZE = 20

function formatDate(value) {
  return typeof value === 'string' ? value.slice(0, 10) : value
}

function StaffDetail({ token, onLogout, staffId, canEdit, onSaved }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  function load() {
    setLoading(true)
    apiFetch(`/api/staff/${staffId}`, token)
      .then((data) => {
        setDetail(data)
        setForm({
          name: data.staff.name || '',
          position: data.staff.position || '',
          phone: data.staff.phone || '',
          email: data.staff.email || '',
          joinDate: data.staff.join_date ? formatDate(data.staff.join_date) : '',
          salary: data.staff.salary,
          earnedLeaveBalance: data.staff.earned_leave_balance,
          notes: data.staff.notes || '',
          active: data.staff.active,
        })
      })
      .catch((err) => {
        if (err instanceof AuthError) onLogout()
        else setError(err.message)
      })
      .finally(() => setLoading(false))
  }

  useEffect(load, [token, staffId])

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await apiFetch(`/api/staff/${staffId}`, token, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      setEditing(false)
      load()
      onSaved?.()
    } catch (err) {
      if (err instanceof AuthError) onLogout()
      else setError(err.message || 'Could not save changes.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={styles.detailCell}>Loading…</div>
  if (!detail) return <div style={styles.detailCell}>{error || 'Could not load staff member.'}</div>

  const { staff, payrollRecords } = detail

  return (
    <div style={styles.detailCell}>
      {editing ? (
        <div style={styles.editGrid}>
          <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" />
          <input style={styles.input} value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="Position" />
          <input style={styles.input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone" />
          <input style={styles.input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" />
          <div>
            <label style={styles.fieldLabel}>Join date</label>
            <input style={styles.input} type="date" value={form.joinDate} onChange={(e) => setForm({ ...form, joinDate: e.target.value })} />
          </div>
          <div>
            <label style={styles.fieldLabel}>Salary</label>
            <input style={styles.input} type="number" min="0" step="0.01" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} />
          </div>
          <div>
            <label style={styles.fieldLabel}>Earned leave balance (days)</label>
            <input style={styles.input} type="number" min="0" step="0.5" value={form.earnedLeaveBalance} onChange={(e) => setForm({ ...form, earnedLeaveBalance: e.target.value })} />
          </div>
          <label style={styles.checkboxRow}>
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active
          </label>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={styles.fieldLabel}>Notes</label>
            <textarea style={styles.textarea} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          {error && <div style={styles.error}>{error}</div>}
          <div>
            <button type="button" style={styles.smallButton} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" style={styles.smallButtonSecondary} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={styles.detailGrid}>
            {staff.phone && <span>Phone: {staff.phone}</span>}
            {staff.email && <span>Email: {staff.email}</span>}
            {staff.join_date && <span>Joined: {formatDate(staff.join_date)}</span>}
            {staff.notes && <span>Notes: {staff.notes}</span>}
            {canEdit && (
              <button type="button" style={styles.smallButtonSecondary} onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
          </div>

          <div>
            <h4 style={styles.historyTitle}>Payroll history ({payrollRecords.length})</h4>
            {payrollRecords.length === 0 ? (
              <p style={styles.historyEmpty}>None yet.</p>
            ) : (
              payrollRecords.map((p) => (
                <div key={p.id} style={styles.historyRow}>
                  <span>{p.pay_period} · {formatDate(p.payment_date)}</span>
                  <span>{formatPrice(p.total_amount)}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function StaffMonitoring({ token, user, onLogout }) {
  const canEdit = user.role === 'admin'

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [showForm, setShowForm] = useState(false)
  const [newStaff, setNewStaff] = useState({
    name: '', position: '', phone: '', email: '', joinDate: '', salary: '', earnedLeaveBalance: '', notes: '',
  })
  const [formError, setFormError] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(id)
  }, [search])

  useEffect(() => setPage(1), [debouncedSearch])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (debouncedSearch) params.set('q', debouncedSearch)

    apiFetch(`/api/staff?${params.toString()}`, token)
      .then((data) => {
        if (cancelled) return
        setItems(data.items)
        setTotal(data.total)
        setTotalPages(data.totalPages)
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof AuthError) onLogout()
        else setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [token, debouncedSearch, page, onLogout, refreshKey])

  async function handleCreate(e) {
    e.preventDefault()
    setFormError('')
    if (!newStaff.name.trim()) {
      setFormError('Name is required.')
      return
    }
    setCreating(true)
    try {
      await apiFetch('/api/staff', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newStaff),
      })
      setNewStaff({ name: '', position: '', phone: '', email: '', joinDate: '', salary: '', earnedLeaveBalance: '', notes: '' })
      setShowForm(false)
      setRefreshKey((k) => k + 1)
    } catch (err) {
      if (err instanceof AuthError) onLogout()
      else setFormError(err.message || 'Could not add staff member.')
    } finally {
      setCreating(false)
    }
  }

  const activeCount = items.filter((s) => s.active).length

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>Staff Monitoring</h2>
        <p style={styles.subtitle}>{total.toLocaleString()} staff on record{page === 1 ? ` (${activeCount} active on this page)` : ''}</p>
      </header>

      <div style={styles.toolbar}>
        <input
          style={styles.search}
          type="text"
          placeholder="Search by name or position…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {canEdit && (
          <button type="button" style={styles.addButton} onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Cancel' : '+ Add staff member'}
          </button>
        )}
      </div>

      {showForm && canEdit && (
        <form style={styles.card} onSubmit={handleCreate}>
          <div style={styles.formGrid}>
            <input style={styles.input} placeholder="Name" value={newStaff.name} onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })} />
            <input style={styles.input} placeholder="Position" value={newStaff.position} onChange={(e) => setNewStaff({ ...newStaff, position: e.target.value })} />
            <input style={styles.input} placeholder="Phone" value={newStaff.phone} onChange={(e) => setNewStaff({ ...newStaff, phone: e.target.value })} />
            <input style={styles.input} placeholder="Email" value={newStaff.email} onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })} />
            <div>
              <label style={styles.fieldLabel}>Join date</label>
              <input style={styles.input} type="date" value={newStaff.joinDate} onChange={(e) => setNewStaff({ ...newStaff, joinDate: e.target.value })} />
            </div>
            <div>
              <label style={styles.fieldLabel}>Salary</label>
              <input style={styles.input} type="number" min="0" step="0.01" placeholder="0" value={newStaff.salary} onChange={(e) => setNewStaff({ ...newStaff, salary: e.target.value })} />
            </div>
            <div>
              <label style={styles.fieldLabel}>Earned leave balance (days)</label>
              <input style={styles.input} type="number" min="0" step="0.5" placeholder="0" value={newStaff.earnedLeaveBalance} onChange={(e) => setNewStaff({ ...newStaff, earnedLeaveBalance: e.target.value })} />
            </div>
          </div>
          {formError && <div style={styles.error}>{formError}</div>}
          <button type="submit" style={{ ...styles.addButton, marginTop: 12 }} disabled={creating}>
            {creating ? 'Adding…' : 'Save staff member'}
          </button>
        </form>
      )}

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Position</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Salary</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Earned leave</th>
              <th style={styles.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td style={styles.td} colSpan={5}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td style={styles.td} colSpan={5}>No staff match your search.</td></tr>
            ) : (
              items.map((s) => (
                <Fragment key={s.id}>
                  <tr style={styles.row} onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
                    <td style={styles.td}>{s.name}</td>
                    <td style={styles.td}>{s.position || '—'}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{formatPrice(s.salary)}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{Number(s.earned_leave_balance).toFixed(1)} days</td>
                    <td style={styles.td}>
                      <span style={s.active ? styles.activeBadge : styles.inactiveBadge}>{s.active ? 'Active' : 'Inactive'}</span>
                    </td>
                  </tr>
                  {expandedId === s.id && (
                    <tr>
                      <td colSpan={5} style={{ padding: 0 }}>
                        <StaffDetail
                          token={token}
                          onLogout={onLogout}
                          staffId={s.id}
                          canEdit={canEdit}
                          onSaved={() => setRefreshKey((k) => k + 1)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={styles.pagination}>
        <button style={styles.pageButton} onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={page <= 1}>
          Previous
        </button>
        <span style={styles.pageLabel}>Page {page} of {totalPages}</span>
        <button style={styles.pageButton} onClick={() => setPage((p) => Math.min(p + 1, totalPages))} disabled={page >= totalPages}>
          Next
        </button>
      </div>
    </div>
  )
}

const styles = {
  header: { marginBottom: 20 },
  title: { margin: 0, fontSize: 18, color: '#0f172a' },
  subtitle: { margin: '4px 0 0 0', color: '#64748b', fontSize: 14 },
  toolbar: { display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' },
  search: {
    flex: '1 1 240px',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    outline: 'none',
  },
  addButton: {
    padding: '10px 16px',
    borderRadius: 8,
    border: 'none',
    background: '#334155',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  card: {
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    background: '#f8fafc',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
  },
  fieldLabel: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#334155',
    marginBottom: 4,
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
  textarea: {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    fontSize: 13,
    background: '#fff',
    resize: 'vertical',
    fontFamily: 'inherit',
  },
  error: {
    marginTop: 12,
    padding: '10px 12px',
    borderRadius: 8,
    background: '#fef2f2',
    color: '#b91c1c',
    fontSize: 13,
  },
  tableWrap: { overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    color: '#334155',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  td: { padding: '10px 12px', borderBottom: '1px solid #f1f5f9', color: '#0f172a' },
  row: { cursor: 'pointer' },
  activeBadge: {
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    background: '#f0fdf4',
    color: '#166534',
  },
  inactiveBadge: {
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    background: '#fef2f2',
    color: '#b91c1c',
  },
  detailCell: {
    padding: '14px 16px',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
  },
  detailGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 16,
    alignItems: 'center',
    marginBottom: 12,
    fontSize: 13,
    color: '#334155',
  },
  editGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
    alignItems: 'end',
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    fontWeight: 600,
    color: '#334155',
    cursor: 'pointer',
  },
  historyTitle: { margin: '0 0 6px 0', fontSize: 13, color: '#0f172a' },
  historyEmpty: { margin: 0, fontSize: 12, color: '#94a3b8' },
  historyRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    color: '#334155',
    padding: '4px 0',
    borderBottom: '1px solid #e2e8f0',
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
    marginRight: 6,
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
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 16 },
  pageButton: {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    background: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  pageLabel: { fontSize: 13, color: '#475569' },
}
