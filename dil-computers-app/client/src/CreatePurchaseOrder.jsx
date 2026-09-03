import { useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'
import { formatPrice } from './format'
import { generateDocumentNumber, todayIso } from './documentPdf'
import CustomerPicker from './CustomerPicker'

// A lean, purchase-specific product picker — separate from ProductPicker
// because buying works differently from selling: cost price instead of a
// catalogue/final price pair, and quantity only ever adds to stock (no
// "how much is left" ceiling to check against).
function PurchaseItemPicker({ token, onLogout, category, setCategory, categories, productQuery, setProductQuery, selectedProduct, setSelectedProduct, quantity, setQuantity, costPrice, setCostPrice }) {
  const [suggestions, setSuggestions] = useState([])
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!category) {
      setSuggestions([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true)
      const params = new URLSearchParams({ category, pageSize: '10', sort: 'name' })
      if (productQuery) params.set('q', productQuery)
      apiFetch(`/api/products?${params.toString()}`, token)
        .then((data) => {
          if (cancelled) return
          setSuggestions(data.items || [])
        })
        .catch((err) => {
          if (cancelled) return
          if (err instanceof AuthError) onLogout()
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [token, category, productQuery, onLogout])

  return (
    <div style={styles.itemGrid}>
      <div>
        <label style={styles.label} htmlFor="poCategory">Category</label>
        <select
          id="poCategory"
          style={styles.input}
          value={category}
          onChange={(e) => {
            setCategory(e.target.value)
            setProductQuery('')
            setSelectedProduct(null)
          }}
        >
          <option value="">Select category…</option>
          {categories.map((c) => (
            <option key={c.category} value={c.category}>{c.category}</option>
          ))}
        </select>
      </div>

      <div style={{ position: 'relative' }}>
        <label style={styles.label} htmlFor="poProduct">Product name</label>
        <input
          id="poProduct"
          style={styles.input}
          type="text"
          placeholder={category ? 'Search products…' : 'Select a category first'}
          value={productQuery}
          disabled={!category}
          onChange={(e) => {
            setProductQuery(e.target.value)
            setSelectedProduct(null)
            setShow(true)
          }}
          onFocus={() => setShow(true)}
          onBlur={() => setTimeout(() => setShow(false), 150)}
        />
        {show && category && (
          <div style={styles.suggestions}>
            {loading ? (
              <div style={styles.suggestionItem}>Loading…</div>
            ) : suggestions.length === 0 ? (
              <div style={styles.suggestionItem}>No matching products.</div>
            ) : (
              suggestions.map((p) => (
                <div
                  key={p.id}
                  style={styles.suggestionItem}
                  onMouseDown={() => {
                    setSelectedProduct(p)
                    setProductQuery(p.name)
                    setShow(false)
                  }}
                >
                  <span>{p.name}</span>
                  <span style={styles.suggestionMeta}>In stock: {p.quantity}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div>
        <label style={styles.label} htmlFor="poQuantity">Quantity received</label>
        <input
          id="poQuantity"
          style={styles.input}
          type="number"
          min="1"
          step="1"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </div>

      <div>
        <label style={styles.label} htmlFor="poCostPrice">Cost price (per unit)</label>
        <input
          id="poCostPrice"
          style={styles.input}
          type="number"
          min="0"
          step="0.01"
          value={costPrice}
          onChange={(e) => setCostPrice(e.target.value)}
        />
      </div>
    </div>
  )
}

export default function CreatePurchaseOrder({ token, onLogout }) {
  const [poNumber, setPoNumber] = useState(() => generateDocumentNumber('PO'))
  const [poDate, setPoDate] = useState(todayIso)
  const [supplierName, setSupplierName] = useState('')
  const [supplierId, setSupplierId] = useState(null)

  const [categories, setCategories] = useState([])
  const [category, setCategory] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [quantity, setQuantity] = useState('1')
  const [costPrice, setCostPrice] = useState('')

  const [lineItems, setLineItems] = useState([])
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiFetch('/api/categories', token)
      .then((data) => setCategories(data.categories || []))
      .catch((err) => {
        if (err instanceof AuthError) onLogout()
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function resetDraft() {
    setCategory('')
    setProductQuery('')
    setSelectedProduct(null)
    setQuantity('1')
    setCostPrice('')
  }

  function handleAddItem() {
    setFormError('')
    if (!category) {
      setFormError('Select a product category.')
      return
    }
    if (!selectedProduct) {
      setFormError('Pick a product from the suggestions list.')
      return
    }
    const qty = parseInt(quantity, 10)
    if (!Number.isFinite(qty) || qty <= 0) {
      setFormError('Enter a quantity greater than zero.')
      return
    }
    const cost = Number(costPrice)
    if (costPrice === '' || !Number.isFinite(cost) || cost < 0) {
      setFormError('Enter a cost price.')
      return
    }

    setLineItems((prev) => [
      ...prev,
      {
        id: `${selectedProduct.id}-${Date.now()}`,
        productId: selectedProduct.id,
        category,
        name: selectedProduct.name,
        quantity: qty,
        costPrice: cost,
      },
    ])
    resetDraft()
  }

  function handleRemoveItem(id) {
    setLineItems((prev) => prev.filter((item) => item.id !== id))
  }

  async function handleCreate() {
    setFormError('')
    setSuccessMessage('')
    if (lineItems.length === 0) {
      setFormError('Add at least one product to the purchase order first.')
      return
    }
    if (!poNumber.trim()) {
      setFormError('PO number is required.')
      return
    }

    setSaving(true)
    try {
      await apiFetch('/api/purchase-orders', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poNumber: poNumber.trim(),
          poDate,
          supplierName,
          supplierId,
          items: lineItems,
        }),
      })

      setSuccessMessage(`Purchase order ${poNumber.trim()} saved — stock updated.`)
      setLineItems([])
      setSupplierName('')
      setSupplierId(null)
      setPoNumber(generateDocumentNumber('PO'))
      setPoDate(todayIso())
    } catch (err) {
      if (err instanceof AuthError) {
        onLogout()
        return
      }
      setFormError(err.message || 'Could not save the purchase order. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const grandTotal = lineItems.reduce((sum, item) => sum + item.costPrice * item.quantity, 0)

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>Create Purchase Order</h2>
        <p style={styles.subtitle}>Receive stock from a supplier — quantities are added to the catalogue immediately.</p>
      </header>

      <div style={styles.detailsGrid}>
        <div>
          <label style={styles.label} htmlFor="poNumber">PO #</label>
          <input id="poNumber" style={styles.input} type="text" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
        </div>
        <div>
          <label style={styles.label} htmlFor="poDateField">Date</label>
          <input id="poDateField" style={styles.input} type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
        </div>
        <CustomerPicker
          token={token}
          onLogout={onLogout}
          id="supplierName"
          label="Supplier"
          endpoint="/api/suppliers"
          emptyMessage="No matching suppliers — this will be saved without a linked record."
          placeholder="Search by name or phone…"
          value={supplierName}
          onInputChange={(text) => {
            setSupplierName(text)
            setSupplierId(null)
          }}
          onSelect={(supplier) => {
            setSupplierName(supplier.name)
            setSupplierId(supplier.id)
          }}
        />
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Add a product</h3>
        <PurchaseItemPicker
          token={token}
          onLogout={onLogout}
          category={category}
          setCategory={setCategory}
          categories={categories}
          productQuery={productQuery}
          setProductQuery={setProductQuery}
          selectedProduct={selectedProduct}
          setSelectedProduct={setSelectedProduct}
          quantity={quantity}
          setQuantity={setQuantity}
          costPrice={costPrice}
          setCostPrice={setCostPrice}
        />

        {formError && <div style={styles.error}>{formError}</div>}

        <button type="button" style={styles.addButton} onClick={handleAddItem}>
          + Add item
        </button>
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Category</th>
              <th style={styles.th}>Product</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Qty</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Cost Price</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Line Total</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {lineItems.length === 0 ? (
              <tr><td style={styles.td} colSpan={6}>No products added yet.</td></tr>
            ) : (
              lineItems.map((item) => (
                <tr key={item.id}>
                  <td style={styles.td}>{item.category}</td>
                  <td style={styles.td}>{item.name}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{item.quantity}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{formatPrice(item.costPrice)}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{formatPrice(item.costPrice * item.quantity)}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    <button type="button" style={styles.removeButton} onClick={() => handleRemoveItem(item.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {successMessage && <div style={styles.success}>{successMessage}</div>}

      <div style={styles.footer}>
        <span style={styles.grandTotal}>Grand total: {formatPrice(grandTotal)}</span>
        <button type="button" style={styles.createButton} onClick={handleCreate} disabled={saving}>
          {saving ? 'Saving…' : 'Create Purchase Order'}
        </button>
      </div>
    </div>
  )
}

const styles = {
  header: { marginBottom: 20 },
  title: { margin: 0, fontSize: 18, color: '#0f172a' },
  subtitle: { margin: '4px 0 0 0', color: '#64748b', fontSize: 14 },
  detailsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
    marginBottom: 20,
  },
  card: {
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
    background: '#f8fafc',
  },
  cardTitle: { margin: '0 0 12px 0', fontSize: 15, color: '#0f172a' },
  itemGrid: {
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
  suggestions: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    zIndex: 10,
    background: '#fff',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    marginTop: 4,
    maxHeight: 220,
    overflowY: 'auto',
    boxShadow: '0 10px 20px rgba(15, 23, 42, 0.12)',
  },
  suggestionItem: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    padding: '8px 12px',
    fontSize: 13,
    color: '#0f172a',
    cursor: 'pointer',
    borderBottom: '1px solid #f1f5f9',
  },
  suggestionMeta: { color: '#64748b', whiteSpace: 'nowrap' },
  error: {
    marginTop: 12,
    padding: '10px 12px',
    borderRadius: 8,
    background: '#fef2f2',
    color: '#b91c1c',
    fontSize: 13,
  },
  success: {
    marginTop: 16,
    padding: '10px 12px',
    borderRadius: 8,
    background: '#f0fdf4',
    color: '#166534',
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
  removeButton: {
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid #fecaca',
    background: '#fef2f2',
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 16,
  },
  grandTotal: { fontSize: 16, fontWeight: 700, color: '#0f172a' },
  createButton: {
    padding: '11px 18px',
    borderRadius: 8,
    border: 'none',
    background: '#1e3a8a',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
}
