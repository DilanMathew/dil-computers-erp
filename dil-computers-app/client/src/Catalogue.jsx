import { Fragment, useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'
import { formatPrice } from './format'

const PAGE_SIZE = 50

function ProductManageRow({ token, onLogout, product, onSaved }) {
  const [reorderThreshold, setReorderThreshold] = useState(product.reorder_threshold ?? '')
  const [hsnCode, setHsnCode] = useState(product.hsn_code || '')
  const [warrantyMonths, setWarrantyMonths] = useState(product.warranty_months ?? '')
  const [barcode, setBarcode] = useState(product.barcode || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await apiFetch(`/api/products/${product.id}`, token, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reorderThreshold: reorderThreshold === '' ? null : reorderThreshold,
          hsnCode,
          warrantyMonths: warrantyMonths === '' ? null : warrantyMonths,
          barcode,
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
    <div style={styles.manageRow}>
      <div>
        <label style={styles.manageLabel}>Reorder at (stock ≤ this triggers Low Stock)</label>
        <input
          style={styles.manageInput}
          type="number"
          min="0"
          step="1"
          placeholder="Not set"
          value={reorderThreshold}
          onChange={(e) => setReorderThreshold(e.target.value)}
        />
      </div>
      <div>
        <label style={styles.manageLabel}>HSN code</label>
        <input
          style={styles.manageInput}
          type="text"
          placeholder="Not set"
          value={hsnCode}
          onChange={(e) => setHsnCode(e.target.value)}
        />
      </div>
      <div>
        <label style={styles.manageLabel}>Last cost price</label>
        <input style={styles.manageInput} type="text" readOnly value={product.cost_price ? formatPrice(product.cost_price) : '—'} />
      </div>
      <div>
        <label style={styles.manageLabel}>Warranty (months)</label>
        <input
          style={styles.manageInput}
          type="number"
          min="0"
          step="1"
          placeholder="Not set"
          value={warrantyMonths}
          onChange={(e) => setWarrantyMonths(e.target.value)}
        />
      </div>
      <div>
        <label style={styles.manageLabel}>Barcode</label>
        <input
          style={styles.manageInput}
          type="text"
          placeholder="Not set — scan or type"
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
        />
      </div>
      <div style={styles.manageActions}>
        <button type="button" style={styles.smallButton} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {error && <span style={styles.inlineError}>{error}</span>}
      </div>
    </div>
  )
}

export default function Catalogue({ token, user, onLogout }) {
  const canManage = user?.role === 'admin'

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
  const [expandedId, setExpandedId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

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
  }, [token, category, debouncedSearch, page, onLogout, refreshKey])

  return (
    <div>
      <header style={styles.header}>
        <div>
          <h2 style={styles.title}>Product Catalogue</h2>
          <p style={styles.subtitle}>
            {total.toLocaleString()} products
            {category ? ` in ${category}` : ''}
          </p>
        </div>
      </header>

      <div style={styles.toolbar}>
          <input
            style={styles.search}
            type="text"
            placeholder="Search products, or scan a barcode…"
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
                <th style={styles.th}>HSN</th>
                <th style={styles.th}>Warranty</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Price</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Quantity</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td style={styles.td} colSpan={6}>Loading…</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td style={styles.td} colSpan={6}>No products match your filters.</td>
                </tr>
              ) : (
                items.map((p) => (
                  <Fragment key={p.id}>
                    <tr
                      style={canManage ? styles.rowClickable : undefined}
                      onClick={canManage ? () => setExpandedId(expandedId === p.id ? null : p.id) : undefined}
                    >
                      <td style={styles.td}>{p.category}</td>
                      <td style={styles.td}>{p.name}</td>
                      <td style={styles.td}>{p.hsn_code || '—'}</td>
                      <td style={styles.td}>{p.warranty_months ? `${p.warranty_months} mo` : '—'}</td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>{formatPrice(p.price)}</td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>{p.quantity}</td>
                    </tr>
                    {canManage && expandedId === p.id && (
                      <tr>
                        <td colSpan={6} style={{ padding: 0 }}>
                          <ProductManageRow
                            token={token}
                            onLogout={onLogout}
                            product={p}
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
  rowClickable: {
    cursor: 'pointer',
  },
  manageRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
    alignItems: 'end',
    padding: '12px 16px',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
  },
  manageLabel: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#334155',
    marginBottom: 4,
  },
  manageInput: {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    fontSize: 13,
    background: '#fff',
  },
  manageActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
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
