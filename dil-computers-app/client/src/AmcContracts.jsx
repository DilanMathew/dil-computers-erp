import { Fragment, useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'
import { formatPrice } from './format'

const PAGE_SIZE = 20

const STATUS_COLORS = {
  active: { background: '#dcfce7', color: '#166534' },
  expired: { background: '#fee2e2', color: '#991b1b' },
  cancelled: { background: '#f1f5f9', color: '#475569' },
}

function formatDate(value) {
  return typeof value === 'string' ? value.slice(0, 10) : value
}

function StatusBadge({ status }) {
  const colors = STATUS_COLORS[status] || {}
  return <span style={{ ...styles.badge, ...colors }}>{status}</span>
}

function AmcContractDetail({ token, onLogout, contractId, canEdit, onSaved }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  function load() {
    setLoading(true)
    apiFetch(`/api/amc-contracts/${contractId}`, token)
      .then((data) => {
        setDetail(data)
        setForm({
          endDate: formatDate(data.contract.end_date),
          amount: data.contract.amount,
          coveredDevices: data.contract.covered_devices || '',
          notes: data.contract.notes || '',
          cancelled: data.contract.cancelled,
        })
      })
      .catch((err) => {
        if (err instanceof AuthError) onLogout()
        else setError(err.message)
      })
      .finally(() => setLoading(false))
  }

  useEffect(load, [token, contractId])

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await apiFetch(`/api/amc-contracts/${contractId}`, token, {
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
  if (!detail) return <div style={styles.detailCell}>{error || 'Could not load contract.'}</div>

  const { contract, repairTickets } = detail

  return (
    <div style={styles.detailCell}>
      {editing ? (
        <div style={styles.editGrid}>
          <div>
            <label style={styles.fieldLabel}>End date</label>
            <input style={styles.input} type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </div>
          <div>
            <label style={styles.fieldLabel}>Amount</label>
            <input style={styles.input} type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div>
            <label style={styles.fieldLabel}>Covered devices</label>
            <input style={styles.input} value={form.coveredDevices} onChange={(e) => setForm({ ...form, coveredDevices: e.target.value })} />
          </div>
          <label style={styles.checkboxRow}>
            <input type="checkbox" checked={form.cancelled} onChange={(e) => setForm({ ...form, cancelled: e.target.checked })} />
            Cancelled
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
            <span>Period: {formatDate(contract.start_date)} to {formatDate(contract.end_date)}</span>
            <span>Amount: {formatPrice(contract.amount)}</span>
            {contract.covered_devices && <span>Covers: {contract.covered_devices}</span>}
            {contract.notes && <span>Notes: {contract.notes}</span>}
            <span>Created by: {contract.created_by_username || '—'}</span>
            {canEdit && (
              <button type="button" style={styles.smallButtonSecondary} onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
          </div>

          <div>
            <h4 style={styles.historyTitle}>Linked repair tickets ({repairTickets.length})</h4>
            {repairTickets.length === 0 ? (
              <p style={styles.historyEmpty}>None yet.</p>
            ) : (
              repairTickets.map((t) => (
                <div key={t.id} style={styles.historyRow}>
                  <span>{t.ticket_number} · {formatDate(t.received_date)}</span>
                  <span>{t.status}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function AmcContracts({ token, user, onLogout }) {
  const canEdit = user.role === 'admin' || user.role === 'sales'

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)

  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(id)
  }, [search])

  useEffect(() => setPage(1), [debouncedSearch, statusFilter])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (debouncedSearch) params.set('q', debouncedSearch)
    if (statusFilter) params.set('status', statusFilter)

    apiFetch(`/api/amc-contracts?${params.toString()}`, token)
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
  }, [token, debouncedSearch, statusFilter, page, onLogout, refreshKey])

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>AMC Contracts</h2>
        <p style={styles.subtitle}>{total.toLocaleString()} contracts</p>
      </header>

      <div style={styles.toolbar}>
        <input
          style={styles.search}
          type="text"
          placeholder="Search by contract # or customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select style={styles.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Contract #</th>
              <th style={styles.th}>Customer</th>
              <th style={styles.th}>Start</th>
              <th style={styles.th}>End</th>
              <th style={styles.th}>Status</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td style={styles.td} colSpan={6}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td style={styles.td} colSpan={6}>No AMC contracts match your filters.</td></tr>
            ) : (
              items.map((a) => (
                <Fragment key={a.id}>
                  <tr style={styles.row} onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}>
                    <td style={styles.td}>{a.contract_number}</td>
                    <td style={styles.td}>{a.customer_name || '—'}</td>
                    <td style={styles.td}>{formatDate(a.start_date)}</td>
                    <td style={styles.td}>{formatDate(a.end_date)}</td>
                    <td style={styles.td}><StatusBadge status={a.status} /></td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{formatPrice(a.amount)}</td>
                  </tr>
                  {expandedId === a.id && (
                    <tr>
                      <td colSpan={6} style={{ padding: 0 }}>
                        <AmcContractDetail
                          token={token}
                          onLogout={onLogout}
                          contractId={a.id}
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
  toolbar: { display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' },
  search: {
    flex: '1 1 240px',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    outline: 'none',
  },
  select: {
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    minWidth: 180,
  },
  error: {
    marginBottom: 12,
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
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'capitalize',
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
  fieldLabel: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#334155',
    marginBottom: 4,
  },
  input: {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    fontSize: 13,
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
