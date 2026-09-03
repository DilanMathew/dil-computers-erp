import { Fragment, useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'
import { formatPrice } from './format'

const PAGE_SIZE = 20

function formatDate(value) {
  return typeof value === 'string' ? value.slice(0, 10) : value
}

export default function CreditNotes({ token, onLogout }) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)

  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState(null)

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

    apiFetch(`/api/credit-notes?${params.toString()}`, token)
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
  }, [token, debouncedSearch, page, onLogout])

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>Credit Notes</h2>
        <p style={styles.subtitle}>{total.toLocaleString()} credit notes</p>
      </header>

      <div style={styles.toolbar}>
        <input
          style={styles.search}
          type="text"
          placeholder="Search by credit note #, invoice #, or customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Credit Note #</th>
              <th style={styles.th}>Date</th>
              <th style={styles.th}>Against Invoice</th>
              <th style={styles.th}>Customer</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Refund</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td style={styles.td} colSpan={5}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td style={styles.td} colSpan={5}>No credit notes match your search.</td></tr>
            ) : (
              items.map((cn) => (
                <Fragment key={cn.id}>
                  <tr style={styles.row} onClick={() => setExpandedId(expandedId === cn.id ? null : cn.id)}>
                    <td style={styles.td}>{cn.credit_note_number}</td>
                    <td style={styles.td}>{formatDate(cn.created_at)}</td>
                    <td style={styles.td}>{cn.invoice_number}</td>
                    <td style={styles.td}>{cn.customer_name || '—'}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{formatPrice(cn.grand_total)}</td>
                  </tr>
                  {expandedId === cn.id && (
                    <tr>
                      <td style={styles.detailCell} colSpan={5}>
                        {cn.reason && <div style={styles.metaLine}>Reason: {cn.reason}</div>}
                        {cn.refund_method && <div style={styles.metaLine}>Refund method: {cn.refund_method}</div>}
                        <div style={styles.metaLine}>Created by: {cn.created_by_username || '—'}</div>
                        <table style={styles.innerTable}>
                          <thead>
                            <tr>
                              <th style={styles.innerTh}>Product</th>
                              <th style={{ ...styles.innerTh, textAlign: 'right' }}>Qty Returned</th>
                              <th style={{ ...styles.innerTh, textAlign: 'right' }}>Unit Price</th>
                              <th style={{ ...styles.innerTh, textAlign: 'right' }}>Line Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(cn.items || []).map((item, idx) => (
                              <tr key={idx}>
                                <td style={styles.innerTd}>{item.name}</td>
                                <td style={{ ...styles.innerTd, textAlign: 'right' }}>{item.quantity}</td>
                                <td style={{ ...styles.innerTd, textAlign: 'right' }}>{formatPrice(item.finalPrice)}</td>
                                <td style={{ ...styles.innerTd, textAlign: 'right' }}>
                                  {formatPrice(item.finalPrice * item.quantity)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {Number(cn.gst_rate) > 0 && (
                          <div style={styles.totalsNote}>
                            Subtotal: {formatPrice(cn.subtotal)} · GST ({cn.gst_rate}%): {formatPrice(cn.gst_amount)} · Refund total: {formatPrice(cn.grand_total)}
                          </div>
                        )}
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
  toolbar: { display: 'flex', gap: 12, marginBottom: 16 },
  search: {
    flex: '1 1 240px',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    outline: 'none',
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
  detailCell: { padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
  metaLine: { fontSize: 12, color: '#334155', marginBottom: 4 },
  innerTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    marginTop: 8,
  },
  innerTh: {
    textAlign: 'left',
    padding: '6px 10px',
    background: '#f1f5f9',
    borderBottom: '1px solid #e2e8f0',
    color: '#334155',
    fontWeight: 600,
  },
  innerTd: { padding: '6px 10px', borderBottom: '1px solid #f1f5f9', color: '#0f172a' },
  totalsNote: {
    marginTop: 8,
    fontSize: 12,
    color: '#334155',
    fontWeight: 600,
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
