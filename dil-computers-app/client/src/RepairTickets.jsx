import { Fragment, useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'
import { formatPrice } from './format'

const PAGE_SIZE = 20

const TICKET_STATUSES = [
  'received', 'diagnosing', 'waiting_for_parts', 'in_repair', 'ready_for_pickup', 'completed', 'cancelled',
]

const STATUS_LABELS = {
  received: 'Received',
  diagnosing: 'Diagnosing',
  waiting_for_parts: 'Waiting for parts',
  in_repair: 'In repair',
  ready_for_pickup: 'Ready for pickup',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const STATUS_COLORS = {
  received: { background: '#eff6ff', color: '#1e3a8a' },
  diagnosing: { background: '#fef9c3', color: '#854d0e' },
  waiting_for_parts: { background: '#fef3c7', color: '#92400e' },
  in_repair: { background: '#fae8ff', color: '#86198f' },
  ready_for_pickup: { background: '#dcfce7', color: '#166534' },
  completed: { background: '#dcfce7', color: '#166534' },
  cancelled: { background: '#fee2e2', color: '#991b1b' },
}

function formatDate(value) {
  return typeof value === 'string' ? value.slice(0, 10) : value
}

function StatusBadge({ status }) {
  const colors = STATUS_COLORS[status] || {}
  return <span style={{ ...styles.badge, ...colors }}>{STATUS_LABELS[status] || status}</span>
}

function RepairTicketDetail({ token, onLogout, ticket, canEdit, onSaved }) {
  const [status, setStatus] = useState(ticket.status)
  const [diagnosis, setDiagnosis] = useState(ticket.diagnosis || '')
  const [finalCost, setFinalCost] = useState(ticket.final_cost ?? '')
  const [invoiceNumber, setInvoiceNumber] = useState(ticket.invoice_number || '')
  const [warrantyDays, setWarrantyDays] = useState(ticket.warranty_days ?? '')
  const [completedDate, setCompletedDate] = useState(ticket.completed_date ? formatDate(ticket.completed_date) : '')
  const [assignedToUsername, setAssignedToUsername] = useState(ticket.assigned_to_username || '')
  const [notes, setNotes] = useState(ticket.notes || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await apiFetch(`/api/repair-tickets/${ticket.id}`, token, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          diagnosis,
          finalCost: finalCost === '' ? null : finalCost,
          invoiceNumber,
          warrantyDays: warrantyDays === '' ? null : warrantyDays,
          completedDate: completedDate || '',
          assignedToUsername,
          notes,
        }),
      })
      onSaved()
    } catch (err) {
      if (err instanceof AuthError) onLogout()
      else setError(err.message || 'Could not save changes.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={styles.detailCell}>
      <div style={styles.detailGrid}>
        <span>Customer: {ticket.customer_name || '—'} {ticket.customer_phone ? `(${ticket.customer_phone})` : ''}</span>
        <span>Device: {ticket.device_description}</span>
        {ticket.serial_number && <span>Serial #: {ticket.serial_number}</span>}
        <span>Reported issue: {ticket.reported_issue}</span>
        {ticket.estimated_cost != null && <span>Estimated cost: {formatPrice(ticket.estimated_cost)}</span>}
        <span>Created by: {ticket.created_by_username || '—'}</span>
      </div>

      {canEdit ? (
        <div style={styles.editGrid}>
          <div>
            <label style={styles.fieldLabel}>Status</label>
            <select style={styles.input} value={status} onChange={(e) => setStatus(e.target.value)}>
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={styles.fieldLabel}>Assigned to</label>
            <input style={styles.input} value={assignedToUsername} onChange={(e) => setAssignedToUsername(e.target.value)} placeholder="Technician username" />
          </div>
          <div>
            <label style={styles.fieldLabel}>Final cost</label>
            <input style={styles.input} type="number" min="0" step="0.01" value={finalCost} onChange={(e) => setFinalCost(e.target.value)} placeholder="Not set" />
          </div>
          <div>
            <label style={styles.fieldLabel}>Invoice # (billing reference)</label>
            <input style={styles.input} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Not set" />
          </div>
          <div>
            <label style={styles.fieldLabel}>Warranty on repair (days)</label>
            <input style={styles.input} type="number" min="0" step="1" value={warrantyDays} onChange={(e) => setWarrantyDays(e.target.value)} placeholder="Not set" />
          </div>
          <div>
            <label style={styles.fieldLabel}>Completed date</label>
            <input style={styles.input} type="date" value={completedDate} onChange={(e) => setCompletedDate(e.target.value)} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={styles.fieldLabel}>Diagnosis</label>
            <textarea style={styles.textarea} rows={2} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={styles.fieldLabel}>Notes</label>
            <textarea style={styles.textarea} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <div style={styles.error}>{error}</div>}
          <div>
            <button type="button" style={styles.smallButton} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div style={styles.detailGrid}>
          {ticket.diagnosis && <span>Diagnosis: {ticket.diagnosis}</span>}
          {ticket.final_cost != null && <span>Final cost: {formatPrice(ticket.final_cost)}</span>}
          {ticket.invoice_number && <span>Invoice ref: {ticket.invoice_number}</span>}
          {ticket.notes && <span>Notes: {ticket.notes}</span>}
        </div>
      )}
    </div>
  )
}

export default function RepairTickets({ token, user, onLogout }) {
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

    apiFetch(`/api/repair-tickets?${params.toString()}`, token)
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
        <h2 style={styles.title}>Repair Tickets</h2>
        <p style={styles.subtitle}>{total.toLocaleString()} tickets</p>
      </header>

      <div style={styles.toolbar}>
        <input
          style={styles.search}
          type="text"
          placeholder="Search by ticket #, customer, or device…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select style={styles.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Ticket #</th>
              <th style={styles.th}>Received</th>
              <th style={styles.th}>Customer</th>
              <th style={styles.th}>Device</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Assigned to</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td style={styles.td} colSpan={6}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td style={styles.td} colSpan={6}>No repair tickets match your filters.</td></tr>
            ) : (
              items.map((t) => (
                <Fragment key={t.id}>
                  <tr style={styles.row} onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
                    <td style={styles.td}>{t.ticket_number}</td>
                    <td style={styles.td}>{formatDate(t.received_date)}</td>
                    <td style={styles.td}>{t.customer_name || '—'}</td>
                    <td style={styles.td}>{t.device_description}</td>
                    <td style={styles.td}><StatusBadge status={t.status} /></td>
                    <td style={styles.td}>{t.assigned_to_username || '—'}</td>
                  </tr>
                  {expandedId === t.id && (
                    <tr>
                      <td colSpan={6} style={{ padding: 0 }}>
                        <RepairTicketDetail
                          token={token}
                          onLogout={onLogout}
                          ticket={t}
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
    marginBottom: 12,
    fontSize: 13,
    color: '#334155',
  },
  editGrid: {
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
  smallButton: {
    padding: '8px 14px',
    borderRadius: 6,
    border: 'none',
    background: '#1e3a8a',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  inlineError: {
    fontSize: 12,
    color: '#b91c1c',
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
