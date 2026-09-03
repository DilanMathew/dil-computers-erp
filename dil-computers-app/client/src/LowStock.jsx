import { useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'
import { formatPrice } from './format'

const PAGE_SIZE = 50

export default function LowStock({ token, onLogout }) {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      lowStock: 'true',
      sort: 'quantity',
    })

    apiFetch(`/api/products?${params.toString()}`, token)
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
  }, [token, page, onLogout])

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>Low Stock</h2>
        <p style={styles.subtitle}>
          {total.toLocaleString()} products at or below their reorder threshold
        </p>
      </header>

      <p style={styles.note}>
        Set a reorder threshold for a product from the Product Catalogue (click a row, admin only)
        to have it show up here once stock runs low.
      </p>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Category</th>
              <th style={styles.th}>Product</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>In Stock</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Reorder At</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Last Cost</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td style={styles.td} colSpan={5}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td style={styles.td} colSpan={5}>Nothing is low on stock right now.</td></tr>
            ) : (
              items.map((p) => (
                <tr key={p.id}>
                  <td style={styles.td}>{p.category}</td>
                  <td style={styles.td}>{p.name}</td>
                  <td style={{ ...styles.td, textAlign: 'right', color: '#b91c1c', fontWeight: 600 }}>
                    {p.quantity}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{p.reorder_threshold}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{p.cost_price ? formatPrice(p.cost_price) : '—'}</td>
                </tr>
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
  header: { marginBottom: 8 },
  title: { margin: 0, fontSize: 18, color: '#0f172a' },
  subtitle: { margin: '4px 0 0 0', color: '#64748b', fontSize: 14 },
  note: { margin: '0 0 16px 0', fontSize: 12, color: '#94a3b8' },
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
