import { Fragment, useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'
import { formatPrice } from './format'

const PAGE_SIZE = 20

function formatDate(value) {
  return typeof value === 'string' ? value.slice(0, 10) : value
}

function CustomerDetail({ token, onLogout, customerId, canEdit, onSaved }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  function load() {
    setLoading(true)
    apiFetch(`/api/customers/${customerId}`, token)
      .then((data) => {
        setDetail(data)
        setForm({
          name: data.customer.name || '',
          phone: data.customer.phone || '',
          email: data.customer.email || '',
          address: data.customer.address || '',
          notes: data.customer.notes || '',
          paymentTermsDays: data.customer.payment_terms_days ?? '',
        })
      })
      .catch((err) => {
        if (err instanceof AuthError) onLogout()
        else setError(err.message)
      })
      .finally(() => setLoading(false))
  }

  useEffect(load, [token, customerId])

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await apiFetch(`/api/customers/${customerId}`, token, {
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
  if (!detail) return <div style={styles.detailCell}>{error || 'Could not load customer.'}</div>

  return (
    <div style={styles.detailCell}>
      {editing ? (
        <div style={styles.editGrid}>
          <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" />
          <input style={styles.input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone" />
          <input style={styles.input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" />
          <input style={styles.input} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Address" />
          <div>
            <input
              style={styles.input}
              type="number"
              min="0"
              max="365"
              step="1"
              value={form.paymentTermsDays}
              onChange={(e) => setForm({ ...form, paymentTermsDays: e.target.value })}
              placeholder="Payment terms (days)"
            />
            <div style={styles.fieldHint}>Blank = due on receipt</div>
          </div>
          <input style={{ ...styles.input, gridColumn: '1 / -1' }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" />
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
            {detail.customer.email && <span>Email: {detail.customer.email}</span>}
            {detail.customer.address && <span>Address: {detail.customer.address}</span>}
            {detail.customer.notes && <span>Notes: {detail.customer.notes}</span>}
            <span>
              Payment terms: {detail.customer.payment_terms_days != null
                ? `${detail.customer.payment_terms_days} days`
                : 'Due on receipt'}
            </span>
            {canEdit && (
              <button type="button" style={styles.smallButtonSecondary} onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
          </div>

          <div style={styles.historyGrid}>
            <div>
              <h4 style={styles.historyTitle}>Quotations ({detail.quotations.length})</h4>
              {detail.quotations.length === 0 ? (
                <p style={styles.historyEmpty}>None yet.</p>
              ) : (
                detail.quotations.map((q) => (
                  <div key={q.id} style={styles.historyRow}>
                    <span>{q.quotation_number} · {formatDate(q.quotation_date)}</span>
                    <span>{formatPrice(q.grand_total)}</span>
                  </div>
                ))
              )}
            </div>
            <div>
              <h4 style={styles.historyTitle}>Invoices ({detail.invoices.length})</h4>
              {detail.invoices.length === 0 ? (
                <p style={styles.historyEmpty}>None yet.</p>
              ) : (
                detail.invoices.map((inv) => (
                  <div key={inv.id} style={styles.historyRow}>
                    <span>{inv.invoice_number} · {formatDate(inv.invoice_date)}</span>
                    <span>{formatPrice(inv.grand_total)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function Customers({ token, user, onLogout }) {
  const canEdit = user.role === 'admin' || user.role === 'sales'

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
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '', address: '', notes: '', paymentTermsDays: '' })
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

    apiFetch(`/api/customers?${params.toString()}`, token)
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
    if (!newCustomer.name.trim()) {
      setFormError('Name is required.')
      return
    }
    setCreating(true)
    try {
      await apiFetch('/api/customers', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCustomer),
      })
      setNewCustomer({ name: '', phone: '', email: '', address: '', notes: '', paymentTermsDays: '' })
      setShowForm(false)
      setRefreshKey((k) => k + 1)
    } catch (err) {
      if (err instanceof AuthError) onLogout()
      else setFormError(err.message || 'Could not create customer.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>Customers</h2>
        <p style={styles.subtitle}>{total.toLocaleString()} customers</p>
      </header>

      <div style={styles.toolbar}>
        <input
          style={styles.search}
          type="text"
          placeholder="Search by name, phone, or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {canEdit && (
          <button type="button" style={styles.addButton} onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Cancel' : '+ Add customer'}
          </button>
        )}
      </div>

      {showForm && canEdit && (
        <form style={styles.card} onSubmit={handleCreate}>
          <div style={styles.formGrid}>
            <input style={styles.input} placeholder="Name" value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} />
            <input style={styles.input} placeholder="Phone" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} />
            <input style={styles.input} placeholder="Email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} />
            <input style={styles.input} placeholder="Address" value={newCustomer.address} onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })} />
            <input style={styles.input} type="number" min="0" max="365" step="1" placeholder="Payment terms (days) — blank = on receipt" value={newCustomer.paymentTermsDays} onChange={(e) => setNewCustomer({ ...newCustomer, paymentTermsDays: e.target.value })} />
          </div>
          {formError && <div style={styles.error}>{formError}</div>}
          <button type="submit" style={{ ...styles.addButton, marginTop: 12 }} disabled={creating}>
            {creating ? 'Adding…' : 'Save customer'}
          </button>
        </form>
      )}

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Phone</th>
              <th style={styles.th}>Email</th>
              <th style={styles.th}>Added</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td style={styles.td} colSpan={4}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td style={styles.td} colSpan={4}>No customers match your search.</td></tr>
            ) : (
              items.map((c) => (
                <Fragment key={c.id}>
                  <tr style={styles.row} onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}>
                    <td style={styles.td}>{c.name}</td>
                    <td style={styles.td}>{c.phone || '—'}</td>
                    <td style={styles.td}>{c.email || '—'}</td>
                    <td style={styles.td}>{formatDate(c.created_at)}</td>
                  </tr>
                  {expandedId === c.id && (
                    <tr>
                      <td colSpan={4} style={{ padding: 0 }}>
                        <CustomerDetail
                          token={token}
                          onLogout={onLogout}
                          customerId={c.id}
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
  fieldHint: { fontSize: 11, color: '#64748b', marginTop: 3 },
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
  detailCell: {
    padding: '14px 16px',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
  },
  editGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 8,
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
  historyGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 16,
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
