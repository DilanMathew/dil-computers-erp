import { formatPrice } from './format'

// Category → product search → quantity → price picker. Driven entirely by
// the state and handlers from useLineItemBuilder(); this component just
// renders it and reports "add item" clicks.
export default function ProductPicker({ builder }) {
  const {
    categories,
    category,
    productQuery,
    selectedProduct,
    suggestions,
    showSuggestions,
    suggestLoading,
    quantity,
    finalPrice,
    sameAsCatalogue,
    serialNumbersText,
    setQuantity,
    setSerialNumbersText,
    setShowSuggestions,
    handleCategoryChange,
    handleSelectSuggestion,
    handleSameAsCatalogueChange,
    handleProductQueryChange,
  } = builder

  return (
    <div>
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
            onChange={(e) => handleProductQueryChange(e.target.value)}
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
            onChange={(e) => builder.setFinalPrice(e.target.value)}
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
        <>
          <p style={styles.stockNote}>In stock: {selectedProduct.quantity.toLocaleString()}</p>
          <div style={{ marginTop: 10 }}>
            <label style={styles.label} htmlFor="serialNumbers">Serial numbers (optional, comma-separated)</label>
            <input
              id="serialNumbers"
              style={styles.input}
              type="text"
              placeholder={`e.g. one per unit — leave blank if not tracked`}
              value={serialNumbersText}
              onChange={(e) => setSerialNumbersText(e.target.value)}
            />
          </div>
        </>
      )}
    </div>
  )
}

const styles = {
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
}
