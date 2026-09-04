import { useState } from 'react'
import { apiFetch, AuthError } from './api'
import { formatPrice, GST_RATES, computeGstTotals } from './format'
import { buildDocumentPdf, todayIso } from './documentPdf'
import useDocumentNumber from './useDocumentNumber'
import useLineItemBuilder from './useLineItemBuilder'
import useCompanyInfo from './useCompanyInfo'
import ProductPicker from './ProductPicker'
import LineItemsTable from './LineItemsTable'
import CustomerPicker from './CustomerPicker'

export default function CreateQuotation({ token, onLogout }) {
  const [quotationNumber, setQuotationNumber, refreshQuotationNumber] = useDocumentNumber('Q', token)
  const [quotationDate, setQuotationDate] = useState(todayIso)
  const [customerName, setCustomerName] = useState('')
  const [customerId, setCustomerId] = useState(null)
  const [gstRate, setGstRate] = useState(18)

  const [lineItems, setLineItems] = useState([])
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [saving, setSaving] = useState(false)

  const builder = useLineItemBuilder({ token, onLogout })
  const companyInfo = useCompanyInfo()

  function handleAddItem() {
    setFormError('')
    const result = builder.buildItem()
    if (!result.ok) {
      setFormError(result.message)
      return
    }
    setLineItems((prev) => [...prev, result.item])
    builder.resetDraft()
  }

  function handleRemoveItem(id) {
    setLineItems((prev) => prev.filter((item) => item.id !== id))
  }

  async function handleCreateQuotation() {
    setFormError('')
    setSuccessMessage('')
    if (lineItems.length === 0) {
      setFormError('Add at least one product to the quotation first.')
      return
    }
    if (!quotationNumber.trim()) {
      setFormError('Quotation number is required.')
      return
    }

    setSaving(true)
    try {
      await apiFetch('/api/quotations', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quotationNumber: quotationNumber.trim(),
          quotationDate,
          customerName,
          customerId,
          items: lineItems,
          gstRate,
        }),
      })

      const totals = computeGstTotals(lineItems, gstRate)
      buildDocumentPdf({
        docLabel: 'Quotation',
        filePrefix: 'Quotation',
        number: quotationNumber.trim(),
        date: quotationDate,
        fields: [['Customer', customerName]],
        items: lineItems,
        companyInfo,
        gstRate,
        ...totals,
      })

      setSuccessMessage(`Quotation ${quotationNumber.trim()} saved.`)

      // Reset for the next quotation — otherwise the next save would
      // re-submit these same line items under a stale, already-used number.
      setLineItems([])
      setCustomerName('')
      setCustomerId(null)
      refreshQuotationNumber()
      setQuotationDate(todayIso())
    } catch (err) {
      if (err instanceof AuthError) {
        onLogout()
        return
      }
      setFormError(err.message || 'Could not save the quotation. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const { subtotal, gstAmount, grandTotal } = computeGstTotals(lineItems, gstRate)

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>Create Quotation</h2>
        <p style={styles.subtitle}>
          Add products from the catalogue, save the quotation, and generate a PDF.
        </p>
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
        <CustomerPicker
          token={token}
          onLogout={onLogout}
          id="customerName"
          label="Customer"
          value={customerName}
          placeholder="Walk-in customer"
          onInputChange={(text) => {
            setCustomerName(text)
            setCustomerId(null)
          }}
          onSelect={(customer) => {
            setCustomerName(customer.name)
            setCustomerId(customer.id)
          }}
        />
        <div>
          <label style={styles.label} htmlFor="gstRate">GST rate</label>
          <select id="gstRate" style={styles.input} value={gstRate} onChange={(e) => setGstRate(Number(e.target.value))}>
            {GST_RATES.map((r) => (
              <option key={r} value={r}>{r === 0 ? 'No GST' : `${r}%`}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Add a product</h3>
        <ProductPicker builder={builder} />

        {formError && <div style={styles.error}>{formError}</div>}

        <button type="button" style={styles.addButton} onClick={handleAddItem}>
          + Add item
        </button>
      </div>

      <LineItemsTable items={lineItems} onRemove={handleRemoveItem} />

      {successMessage && <div style={styles.success}>{successMessage}</div>}

      <div style={styles.footer}>
        <div style={styles.totalsBlock}>
          {gstRate > 0 && (
            <>
              <span style={styles.totalsLine}>Subtotal: {formatPrice(subtotal)}</span>
              <span style={styles.totalsLine}>GST ({gstRate}%): {formatPrice(gstAmount)}</span>
            </>
          )}
          <span style={styles.grandTotal}>Grand total: {formatPrice(grandTotal)}</span>
        </div>
        <button
          type="button"
          style={styles.createButton}
          onClick={handleCreateQuotation}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Create Quotation (PDF)'}
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
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 16,
  },
  totalsBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  totalsLine: {
    fontSize: 13,
    color: '#64748b',
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
