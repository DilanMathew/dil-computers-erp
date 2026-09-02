import { useEffect, useState } from 'react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { apiFetch, AuthError } from './api'
import { formatPrice } from './format'

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function generateQuotationNumber() {
  const datePart = todayIso().replace(/-/g, '')
  const randomPart = Math.floor(1000 + Math.random() * 9000)
  return `Q-${datePart}-${randomPart}`
}

function buildQuotationPdf({ quotationNumber, quotationDate, customerName, items }) {
  const doc = new jsPDF()

  doc.setFontSize(18)
  doc.text('DIL Computers', 14, 20)
  doc.setFontSize(12)
  doc.setTextColor(100)
  doc.text('Quotation', 14, 27)
  doc.setTextColor(0)

  doc.setFontSize(10)
  let infoY = 37
  doc.text(`Quotation #: ${quotationNumber}`, 14, infoY)
  infoY += 6
  doc.text(`Date: ${quotationDate}`, 14, infoY)
  if (customerName) {
    infoY += 6
    doc.text(`Customer: ${customerName}`, 14, infoY)
  }

  const rows = items.map((item, idx) => [
    idx + 1,
    item.category,
    item.name,
    item.quantity,
    formatPrice(item.catalPrice),
    formatPrice(item.finalPrice),
    item.sameAsCatalogue ? 'Catalogue price' : 'Discounted',
    formatPrice(item.finalPrice * item.quantity),
  ])

  autoTable(doc, {
    startY: infoY + 8,
    head: [['#', 'Category', 'Product', 'Qty', 'Catalogue Price', 'Final Price', 'Note', 'Line Total']],
    body: rows,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [30, 58, 138] },
    columnStyles: {
      0: { cellWidth: 8 },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      7: { halign: 'right' },
    },
  })

  const grandTotal = items.reduce((sum, item) => sum + item.finalPrice * item.quantity, 0)
  const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY : infoY + 8

  doc.setFontSize(12)
  doc.setFont(undefined, 'bold')
  doc.text(`Grand Total: ${formatPrice(grandTotal)}`, 14, finalY + 12)
  doc.setFont(undefined, 'normal')

  doc.save(`Quotation-${quotationNumber}.pdf`)
}

export default function CreateQuotation({ token, onLogout }) {
  const [quotationNumber, setQuotationNumber] = useState(generateQuotationNumber)
  const [quotationDate, setQuotationDate] = useState(todayIso)
  const [customerName, setCustomerName] = useState('')

  const [categories, setCategories] = useState([])

  const [category, setCategory] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestLoading, setSuggestLoading] = useState(false)

  const [quantity, setQuantity] = useState('1')
  const [finalPrice, setFinalPrice] = useState('')
  const [sameAsCatalogue, setSameAsCatalogue] = useState(false)

  const [lineItems, setLineItems] = useState([])
  const [formError, setFormError] = useState('')

  useEffect(() => {
    apiFetch('/api/categories', token)
      .then((data) => setCategories(data.categories || []))
      .catch((err) => {
        if (err instanceof AuthError) onLogout()
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Look up products in the selected category as the user types a name.
  useEffect(() => {
    if (!category) {
      setSuggestions([])
      return
    }

    let cancelled = false
    const id = setTimeout(() => {
      setSuggestLoading(true)
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
          if (!cancelled) setSuggestLoading(false)
        })
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [token, category, productQuery, onLogout])

  function resetDraft() {
    setProductQuery('')
    setSelectedProduct(null)
    setSuggestions([])
    setShowSuggestions(false)
    setQuantity('1')
    setFinalPrice('')
    setSameAsCatalogue(false)
  }

  function handleCategoryChange(value) {
    setCategory(value)
    setProductQuery('')
    setSelectedProduct(null)
    setShowSuggestions(false)
    setFinalPrice('')
    setSameAsCatalogue(false)
  }

  function handleSelectSuggestion(product) {
    setSelectedProduct(product)
    setProductQuery(product.name)
    setShowSuggestions(false)
    setFinalPrice('')
    setSameAsCatalogue(false)
  }

  function handleSameAsCatalogueChange(checked) {
    setSameAsCatalogue(checked)
    if (checked && selectedProduct) {
      setFinalPrice(String(selectedProduct.price))
    } else {
      setFinalPrice('')
    }
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

    let resolvedFinalPrice
    if (sameAsCatalogue) {
      resolvedFinalPrice = Number(selectedProduct.price)
    } else {
      resolvedFinalPrice = Number(finalPrice)
      if (finalPrice === '' || !Number.isFinite(resolvedFinalPrice) || resolvedFinalPrice < 0) {
        setFormError('Enter a final price, or tick "Same as catalogue price".')
        return
      }
    }

    setLineItems((prev) => [
      ...prev,
      {
        id: `${selectedProduct.id}-${Date.now()}`,
        category,
        name: selectedProduct.name,
        quantity: qty,
        catalPrice: Number(selectedProduct.price),
        finalPrice: resolvedFinalPrice,
        sameAsCatalogue,
      },
    ])

    resetDraft()
  }

  function handleRemoveItem(id) {
    setLineItems((prev) => prev.filter((item) => item.id !== id))
  }

  function handleCreateQuotation() {
    setFormError('')
    if (lineItems.length === 0) {
      setFormError('Add at least one product to the quotation first.')
      return
    }

    buildQuotationPdf({ quotationNumber, quotationDate, customerName, items: lineItems })
  }

  const grandTotal = lineItems.reduce((sum, item) => sum + item.finalPrice * item.quantity, 0)

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>Create Quotation</h2>
        <p style={styles.subtitle}>Add products from the catalogue, then generate a PDF quotation.</p>
      </header>

      <div style={styles.detailsGrid}>
        <div>
          <label style={styles.label} htmlFor="quotationNumber">Quotation #</label>
          <input
            id="quotationNumber"
            style={styles.input}
            type="text"
            value={quotationNumber}
            onChange={(e) => setQuotationNumber(e.target.value)}
          />
        </div>
        <div>
          <label style={styles.label} htmlFor="quotationDate">Date</label>
          <input
            id="quotationDate"
            style={styles.input}
            type="date"
            value={quotationDate}
            onChange={(e) => setQuotationDate(e.target.value)}
          />
        </div>
        <div>
          <label style={styles.label} htmlFor="customerName">Customer name (optional)</label>
          <input
            id="customerName"
            style={styles.input}
            type="text"
            placeholder="Walk-in customer"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
        </div>
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Add a product</h3>

        <div style={styles.itemGrid}>
          <div>
            <label style={styles.label} htmlFor="category">Category</label>
            <select
              id="category"
              style={styles.input}
              value={category}
              onChange={(e) => handleCategoryChange(e.target.value)}
            >
              <option value="">Select category…</option>
              {categories.map((c) => (
                <option key={c.category} value={c.category}>
                  {c.category}
                </option>
              ))}
            </select>
          </div>

          <div style={{ position: 'relative' }}>
            <label style={styles.label} htmlFor="product">Product name</label>
            <input
              id="product"
              style={styles.input}
              type="text"
              placeholder={category ? 'Search products…' : 'Select a category first'}
              value={productQuery}
              disabled={!category}
              onChange={(e) => {
                setProductQuery(e.target.value)
                setSelectedProduct(null)
                setShowSuggestions(true)
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            />
            {showSuggestions && category && (
              <div style={styles.suggestions}>
                {suggestLoading ? (
                  <div style={styles.suggestionItem}>Loading…</div>
                ) : suggestions.length === 0 ? (
                  <div style={styles.suggestionItem}>No matching products.</div>
                ) : (
                  suggestions.map((p) => (
                    <div
                      key={p.id}
                      style={styles.suggestionItem}
                      onMouseDown={() => handleSelectSuggestion(p)}
                    >
                      <span>{p.name}</span>
                      <span style={styles.suggestionPrice}>{formatPrice(p.price)}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div>
            <label style={styles.label} htmlFor="quantity">Quantity</label>
            <input
              id="quantity"
              style={styles.input}
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>

          <div>
            <label style={styles.label}>Catalogue price</label>
            <input
              style={styles.input}
              type="text"
              readOnly
              value={selectedProduct ? formatPrice(selectedProduct.price) : '—'}
            />
          </div>

          <div>
            <label style={styles.label} htmlFor="finalPrice">Final price</label>
            <input
              id="finalPrice"
              style={styles.input}
              type="number"
              min="0"
              step="0.01"
              placeholder="Enter discounted price"
              value={finalPrice}
              disabled={sameAsCatalogue}
              onChange={(e) => setFinalPrice(e.target.value)}
            />
            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={sameAsCatalogue}
                onChange={(e) => handleSameAsCatalogueChange(e.target.checked)}
              />
              Same as catalogue price
            </label>
          </div>
        </div>

        {selectedProduct && (
          <p style={styles.stockNote}>In stock: {selectedProduct.quantity.toLocaleString()}</p>
        )}

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
              <th style={{ ...styles.th, textAlign: 'right' }}>Catalogue Price</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Final Price</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Line Total</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {lineItems.length === 0 ? (
              <tr>
                <td style={styles.td} colSpan={7}>No products added yet.</td>
              </tr>
            ) : (
              lineItems.map((item) => (
                <tr key={item.id}>
                  <td style={styles.td}>{item.category}</td>
                  <td style={styles.td}>{item.name}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{item.quantity}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{formatPrice(item.catalPrice)}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{formatPrice(item.finalPrice)}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    {formatPrice(item.finalPrice * item.quantity)}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    <button
                      type="button"
                      style={styles.removeButton}
                      onClick={() => handleRemoveItem(item.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={styles.footer}>
        <span style={styles.grandTotal}>Grand total: {formatPrice(grandTotal)}</span>
        <button type="button" style={styles.createButton} onClick={handleCreateQuotation}>
          Create Quotation (PDF)
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
  cardTitle: {
    margin: '0 0 12px 0',
    fontSize: 15,
    color: '#0f172a',
  },
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
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    fontSize: 13,
    color: '#334155',
    fontWeight: 500,
    cursor: 'pointer',
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
  suggestionPrice: {
    color: '#64748b',
    whiteSpace: 'nowrap',
  },
  stockNote: {
    margin: '10px 0 0 0',
    fontSize: 12,
    color: '#64748b',
  },
  error: {
    marginTop: 12,
    padding: '10px 12px',
    borderRadius: 8,
    background: '#fef2f2',
    color: '#b91c1c',
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
  grandTotal: {
    fontSize: 16,
    fontWeight: 700,
    color: '#0f172a',
  },
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
