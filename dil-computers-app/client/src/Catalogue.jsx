import { useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'

const PAGE_SIZE = 50

function formatPrice(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

export default function Catalogue({ token, onLogout }) {
  const [categories, setCategories] = useState([])
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)

  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Debounce the search box so we're not firing a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(id)
  }, [search])

  // Reset to page 1 whenever a filter changes.
  useEffect(() => {
    setPage(1)
  }, [category, debouncedSearch])

  useEffect(() => {
    apiFetch('/api/categories', token)
      .then((data) => setCategories(data.categories || []))
      .catch((err) => {
        if (err instanceof AuthError) onLogout()
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    })
    if (category) params.set('category', category)
    if (debouncedSearch) params.set('q', debouncedSearch)

    apiFetch(`/api/products?${params.toString()}`, token)
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
  }, [token, category, debouncedSearch, page, onLogout])

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <header style={styles.header}>
          <div>
            <h1 style={styles.title}>Product Catalogue</h1>
            <p style={styles.subtitle}>
              {total.toLocaleString()} products
              {category ? ` in ${category}` : ''}
            </p>
          </div>
          <button style={styles.logoutButton} onClick={onLogout}>
            Log out
          </button>
        </header>

        <div style={styles.toolbar}>
          <input
            style={styles.search}
            type="text"
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            style={styles.select}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.category} value={c.category}>
                {c.category} ({c.count})
              </option>
            ))}
          </select>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Category</th>
                <th style={styles.th}>Product</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Price</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Quantity</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td style={styles.td} colSpan={4}>Loading…</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td style={styles.td} colSpan={4}>No products match your filters.</td>
                </tr>
              ) : (
                items.map((p) => (
                  <tr key={p.id}>
                    <td style={styles.td}>{p.category}</td>
                    <td style={styles.td}>{p.name}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{formatPrice(p.price)}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{p.quantity}</td>
                  </tr>
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
          <span style={styles.pageLabel}>
            Page {page} of {totalPages}
          </span>
          <button
            style={styles.pageButton}
            onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
            disabled={page >= totalPages}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#f1f5f9',
    padding: '32px 16px',
  },
  shell: {
    maxWidth: 1000,
    margin: '0 auto',
    background: '#fff',
    borderRadius: 12,
    boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
    padding: 24,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  title: {
    margin: 0,
    fontSize: 22,
    color: '#0f172a',
  },
  subtitle: {
    margin: '4px 0 0 0',
    color: '#64748b',
    fontSize: 14,
  },
  logoutButton: {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    background: '#fff',
    color: '#334155',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  toolbar: {
    display: 'flex',
    gap: 12,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
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
    minWidth: 200,
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
