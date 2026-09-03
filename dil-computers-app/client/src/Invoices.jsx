import { Fragment, useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'
import { formatPrice } from './format'

const PAGE_SIZE = 20

function formatDate(value) {
  // Postgres DATE columns come back as full ISO timestamps at midnight UTC;
  // just show the date part.
  return typeof value === 'string' ? value.slice(0, 10) : value
}

const STATUS_STYLES = {
  paid: { background: '#f0fdf4', color: '#166534', border: '#bbf7d0' },
  partial: { background: '#fffbeb', color: '#b45309', border: '#fde68a' },
  unpaid: { background: '#fef2f2', color: '#b91c1c', border: '#fecaca' },
}

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.unpaid
  return (
    <span style={{ ...styles.statusBadge, background: s.background, color: s.color, border: `1px solid ${s.border}` }}>
      {status}
    </span>
  )
}

function RecordPaymentForm({ token, onLogout, invoiceId, balanceDue, onRecorded }) {
  const [amount, setAmount] = useState(String(balanceDue.toFixed(2)))
  const [method, setMethod] = useState('Cash')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    setSaving(true)
    try {
      await apiFetch(`/api/invoices/${invoiceId}/payments`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, paymentMethod: method, paymentDate: new Date().toISOString().slice(0, 10) }),
      })
      onRecorded()
    } catch (err) {
      if (err instanceof AuthError) onLogout()
      else setError(err.message || 'Could not record payment.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form style={styles.paymentForm} onSubmit={handleSubmit}>
      <input
        style={styles.paymentInput}
        type="number"
        min="0.01"
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <select style={styles.paymentInput} value={method} onChange={(e) => setMethod(e.target.value)}>
        {['Cash', 'Card', 'UPI', 'Bank Transfer', 'Other'].map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <button type="submit" style={styles.smallButton} disabled={saving}>
        {saving ? 'Saving…' : 'Record payment'}
      </button>
      {error && <span style={styles.inlineError}>{error}</span>}
    </form>
  )
}

export default function Invoices({ token, user, onLogout }) {
  const canRecordPayment = user?.role === 'admin' || user?.role === 'sales'

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [status, setStatus] = useState('')
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

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, status])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (debouncedSearch) params.set('q', debouncedSearch)
    if (status) params.set('status', status)

    apiFetch(`/api/invoices?${params.toString()}`, token)
      .then((data) => {
        if (cancelled) return
        setItems(data.items)
        setTotal(data.total)
        setTotalPages(data.totalPages)
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof AuthError) {
          onLogout()
        } else {
          setError(err.message)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [token, debouncedSearch, status, page, onLogout, refreshKey])

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>Invoices</h2>
        <p style={styles.subtitle}>{total.toLocaleString()} invoices</p>
      </header>

      <div style={styles.toolbar}>
        <input
          style={styles.search}
          type="text"
          placeholder="Search by invoice # or customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select style={styles.statusFilter} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="paid">Paid</option>
          <option value="partial">Partially paid</option>
          <option value="unpaid">Unpaid</option>
        </select>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Invoice #</th>
              <th style={styles.th}>Date</th>
              <th style={styles.th}>Customer</th>
              <th style={styles.th}>Quotation Ref</th>
              <th style={styles.th}>Created by</th>
              <th style={styles.th}>Status</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Total</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Balance Due</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td style={styles.td} colSpan={8}>Loading…</td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td style={styles.td} colSpan={8}>No invoices match your search.</td>
              </tr>
            ) : (
              items.map((inv) => (
                <Fragment key={inv.id}>
                  <tr
                    style={styles.row}
                    onClick={() => setExpandedId(expandedId === inv.id ? null : inv.id)}
                  >
                    <td style={styles.td}>{inv.invoice_number}</td>
                    <td style={styles.td}>{formatDate(inv.invoice_date)}</td>
                    <td style={styles.td}>{inv.customer_name}</td>
                    <td style={styles.td}>{inv.quotation_number || '—'}</td>
                    <td style={styles.td}>{inv.created_by_username || '—'}</td>
                    <td style={styles.td}><StatusBadge status={inv.status} /></td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{formatPrice(inv.grand_total)}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>
                      {Number(inv.balance_due) > 0.01 ? formatPrice(inv.balance_due) : '—'}
                    </td>
                  </tr>
                  {expandedId === inv.id && (
                    <tr>
                      <td style={styles.detailCell} colSpan={8}>
                        <div style={styles.detailGrid}>
                          {inv.customer_phone && <span>Phone: {inv.customer_phone}</span>}
                          {inv.customer_address && <span>Address: {inv.customer_address}</span>}
                          <span>Payment method: {inv.payment_method || '—'}</span>
                        </div>

                        <table style={styles.innerTable}>
                          <thead>
                            <tr>
                              <th style={styles.innerTh}>Category</th>
                              <th style={styles.innerTh}>Product</th>
                              <th style={{ ...styles.innerTh, textAlign: 'right' }}>Qty</th>
                              <th style={{ ...styles.innerTh, textAlign: 'right' }}>Final Price</th>
                              <th style={{ ...styles.innerTh, textAlign: 'right' }}>Line Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(inv.items || []).map((item, idx) => (
                              <tr key={idx}>
                                <td style={styles.innerTd}>{item.category}</td>
                                <td style={styles.innerTd}>{item.name}</td>
                                <td style={{ ...styles.innerTd, textAlign: 'right' }}>{item.quantity}</td>
                                <td style={{ ...styles.innerTd, textAlign: 'right' }}>
                                  {formatPrice(item.finalPrice)}
                                </td>
                                <td style={{ ...styles.innerTd, textAlign: 'right' }}>
                                  {formatPrice(item.finalPrice * item.quantity)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {Number(inv.gst_rate) > 0 && (
                          <div style={styles.totalsNote}>
                            Subtotal: {formatPrice(inv.subtotal)} · GST ({inv.gst_rate}%): {formatPrice(inv.gst_amount)} · Grand total: {formatPrice(inv.grand_total)}
                          </div>
                        )}

                        <div style={styles.paymentsSection}>
                          <h4 style={styles.paymentsTitle}>
                            Payments ({(inv.payments || []).length}) — paid {formatPrice(inv.amount_paid)} of {formatPrice(inv.grand_total)}
                          </h4>
                          {(inv.payments || []).length > 0 && (
                            <table style={styles.innerTable}>
                              <thead>
                                <tr>
                                  <th style={styles.innerTh}>Date</th>
                                  <th style={styles.innerTh}>Method</th>
                                  <th style={styles.innerTh}>By</th>
                                  <th style={{ ...styles.innerTh, textAlign: 'right' }}>Amount</th>
                                </tr>
                              </thead>
                              <tbody>
                                {inv.payments.map((p) => (
                                  <tr key={p.id}>
                                    <td style={styles.innerTd}>{formatDate(p.paymentDate)}</td>
                                    <td style={styles.innerTd}>{p.paymentMethod || '—'}</td>
                                    <td style={styles.innerTd}>{p.createdBy || '—'}</td>
                                    <td style={{ ...styles.innerTd, textAlign: 'right' }}>{formatPrice(p.amount)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}

                          {canRecordPayment && Number(inv.balance_due) > 0.01 && (
                            <RecordPaymentForm
                              token={token}
                              onLogout={onLogout}
                              invoiceId={inv.id}
                              balanceDue={Number(inv.balance_due)}
                              onRecorded={() => setRefreshKey((k) => k + 1)}
                            />
                          )}
                        </div>
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
        <button
          style={styles.pageButton}
          onClick={() => setPage((p) => Math.max(p - 1, 1))}
          disabled={page <= 1}
        >
          Previous
        </button>
        <span style={styles.pageLabel}>Page {page} of {totalPages}</span>
        <button
          style={styles.pageButton}
          onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
          disabled={page >= totalPages}
        >
          Next
        </button>
      </div>
    </div>
  )
}

const styles = {
  header: {
    marginBottom: 20,
  },
  title: {
    margin: 0,
    fontSize: 18,
    color: '#0f172a',
  },
  subtitle: {
    margin: '4px 0 0 0',
    color: '#64748b',
    fontSize: 14,
  },
  toolbar: {
    display: 'flex',
    gap: 12,
    marginBottom: 16,
  },
  search: {
    flex: '1 1 240px',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    outline: 'none',
  },
  statusFilter: {
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    minWidth: 160,
  },
  error: {
    marginBottom: 12,
    padding: '10px 12px',
    borderRadius: 8,
    background: '#fef2f2',
    color: '#b91c1c',
    fontSize: 13,
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
  row: {
    cursor: 'pointer',
  },
  statusBadge: {
    padding: '3px 10px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
  },
  detailCell: {
    padding: '12px',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
  },
  detailGrid: {
    display: 'flex',
    gap: 16,
    marginBottom: 10,
    fontSize: 13,
    color: '#334155',
  },
  innerTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    marginBottom: 10,
  },
  innerTh: {
    textAlign: 'left',
    padding: '6px 10px',
    background: '#f1f5f9',
    borderBottom: '1px solid #e2e8f0',
    color: '#334155',
    fontWeight: 600,
  },
  innerTd: {
    padding: '6px 10px',
    borderBottom: '1px solid #f1f5f9',
    color: '#0f172a',
  },
  totalsNote: {
    marginTop: 8,
    marginBottom: 10,
    fontSize: 12,
    color: '#334155',
    fontWeight: 600,
  },
  paymentsSection: {
    marginTop: 4,
  },
  paymentsTitle: {
    margin: '0 0 8px 0',
    fontSize: 13,
    color: '#0f172a',
  },
  paymentForm: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  paymentInput: {
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    fontSize: 13,
    width: 110,
  },
  smallButton: {
    padding: '7px 12px',
    borderRadius: 6,
    border: 'none',
    background: '#1e3a8a',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  inlineError: {
    fontSize: 12,
    color: '#b91c1c',
  },
  pagination: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginTop: 16,
  },
  pageButton: {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    background: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  pageLabel: {
    fontSize: 13,
    color: '#475569',
  },
}
