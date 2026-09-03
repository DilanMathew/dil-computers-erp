import { useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'
import { formatPrice, GST_RATES, computeGstTotals } from './format'
import { buildDocumentPdf, generateDocumentNumber, todayIso } from './documentPdf'
import useLineItemBuilder from './useLineItemBuilder'
import useCompanyInfo from './useCompanyInfo'
import ProductPicker from './ProductPicker'
import LineItemsTable from './LineItemsTable'
import CustomerPicker from './CustomerPicker'

const PAYMENT_METHODS = ['Cash', 'Card', 'UPI', 'Bank Transfer', 'Other']

export default function CreateInvoice({ token, onLogout }) {
  const [invoiceNumber, setInvoiceNumber] = useState(() => generateDocumentNumber('INV'))
  const [invoiceDate, setInvoiceDate] = useState(todayIso)
  const [customerName, setCustomerName] = useState('')
  const [customerId, setCustomerId] = useState(null)
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0])
  const [gstRate, setGstRate] = useState(18)
  const [fullyPaid, setFullyPaid] = useState(true)
  const [amountReceived, setAmountReceived] = useState('')

  const [quotationQuery, setQuotationQuery] = useState('')
  const [quotationSuggestions, setQuotationSuggestions] = useState([])
  const [showQuotationSuggestions, setShowQuotationSuggestions] = useState(false)

  const [lineItems, setLineItems] = useState([])
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [saving, setSaving] = useState(false)

  const builder = useLineItemBuilder({ token, onLogout })
  const companyInfo = useCompanyInfo()
  const { subtotal, gstAmount, grandTotal } = computeGstTotals(lineItems, gstRate)

  // Look up quotations as the user types into the "reference quotation #"
  // field, so they can pick an existing one instead of retyping it exactly.
  useEffect(() => {
    if (!quotationQuery) {
      setQuotationSuggestions([])
      return
    }

    let cancelled = false
    const id = setTimeout(() => {
      apiFetch(`/api/quotations?q=${encodeURIComponent(quotationQuery)}&pageSize=6`, token)
        .then((data) => {
          if (cancelled) return
          setQuotationSuggestions(data.items || [])
        })
        .catch((err) => {
          if (cancelled) return
          if (err instanceof AuthError) onLogout()
        })
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [token, quotationQuery, onLogout])

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

  async function handleCreateInvoice() {
    setFormError('')
    setSuccessMessage('')
    if (!customerName.trim()) {
      setFormError('Customer name is required.')
      return
    }
    if (lineItems.length === 0) {
      setFormError('Add at least one product to the invoice first.')
      return
    }
    if (!invoiceNumber.trim()) {
      setFormError('Invoice number is required.')
      return
    }

    let received = grandTotal
    if (!fullyPaid) {
      received = amountReceived === '' ? 0 : Number(amountReceived)
      if (!Number.isFinite(received) || received < 0) {
        setFormError('Enter a valid amount received (0 or more).')
        return
      }
      if (received > grandTotal) {
        setFormError('Amount received cannot exceed the invoice total.')
        return
      }
    }

    setSaving(true)
    try {
      await apiFetch('/api/invoices', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceNumber: invoiceNumber.trim(),
          invoiceDate,
          customerName: customerName.trim(),
          customerId,
          customerPhone,
          customerAddress,
          paymentMethod,
          quotationNumber: quotationQuery,
          items: lineItems,
          amountReceived: received,
          gstRate,
        }),
      })

      const balanceDue = grandTotal - received
      buildDocumentPdf({
        docLabel: 'Invoice',
        filePrefix: 'Invoice',
        number: invoiceNumber.trim(),
        date: invoiceDate,
        fields: [
          ['Customer', customerName],
          ['Phone', customerPhone],
          ['Address', customerAddress],
          ['Payment Method', paymentMethod],
          ['Quotation Ref', quotationQuery],
          ...(balanceDue > 0.01
            ? [['Amount Paid', formatPrice(received)], ['Balance Due', formatPrice(balanceDue)]]
            : []),
        ],
        items: lineItems,
        companyInfo,
        subtotal,
        gstRate,
        gstAmount,
        grandTotal,
      })

      setSuccessMessage(
        balanceDue > 0.01
          ? `Invoice ${invoiceNumber.trim()} saved — ${formatPrice(balanceDue)} still due. Stock updated.`
          : `Invoice ${invoiceNumber.trim()} saved and stock updated.`
      )

      // Reset for the next invoice — otherwise the next save would
      // re-submit these same line items under a stale, already-used number,
      // and double-deduct stock for products already sold above.
      setLineItems([])
      setCustomerName('')
      setCustomerId(null)
      setCustomerPhone('')
      setCustomerAddress('')
      setPaymentMethod(PAYMENT_METHODS[0])
      setFullyPaid(true)
      setAmountReceived('')
      setQuotationQuery('')
      setInvoiceNumber(generateDocumentNumber('INV'))
      setInvoiceDate(todayIso())
    } catch (err) {
      if (err instanceof AuthError) {
        onLogout()
        return
      }
      setFormError(err.message || 'Could not save the invoice. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>Create Invoice</h2>
        <p style={styles.subtitle}>Record a sale, save it, and generate a PDF invoice.</p>
      </header>

      <div style={styles.detailsGrid}>
        <div>
          <label style={styles.label} htmlFor="invoiceNumber">Invoice #</label>
          <input
            id="invoiceNumber"
            style={styles.input}
            type="text"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
          />
        </div>
        <div>
          <label style={styles.label} htmlFor="invoiceDate">Date</label>
          <input
            id="invoiceDate"
            style={styles.input}
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
          />
        </div>
        <div>
          <label style={styles.label} htmlFor="paymentMethod">Payment method</label>
          <select
            id="paymentMethod"
            style={styles.input}
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={styles.label} htmlFor="gstRate">GST rate</label>
          <select id="gstRate" style={styles.input} value={gstRate} onChange={(e) => setGstRate(Number(e.target.value))}>
            {GST_RATES.map((r) => (
              <option key={r} value={r}>{r === 0 ? 'No GST' : `${r}%`}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={styles.detailsGrid}>
        <CustomerPicker
          token={token}
          onLogout={onLogout}
          id="customerName"
          label="Customer name"
          required
          placeholder="Required"
          value={customerName}
          onInputChange={(text) => {
            setCustomerName(text)
            setCustomerId(null)
          }}
          onSelect={(customer) => {
            setCustomerName(customer.name)
            setCustomerId(customer.id)
            if (customer.phone) setCustomerPhone(customer.phone)
            if (customer.address) setCustomerAddress(customer.address)
          }}
        />
        <div>
          <label style={styles.label} htmlFor="customerPhone">Customer phone (optional)</label>
          <input
            id="customerPhone"
            style={styles.input}
            type="text"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
          />
        </div>
        <div>
          <label style={styles.label} htmlFor="customerAddress">Customer address (optional)</label>
          <input
            id="customerAddress"
            style={styles.input}
            type="text"
            value={customerAddress}
            onChange={(e) => setCustomerAddress(e.target.value)}
          />
        </div>
        <div style={{ position: 'relative' }}>
          <label style={styles.label} htmlFor="quotationRef">Reference quotation # (optional)</label>
          <input
            id="quotationRef"
            style={styles.input}
            type="text"
            placeholder="Search by quotation # or customer…"
            value={quotationQuery}
            onChange={(e) => {
              setQuotationQuery(e.target.value)
              setShowQuotationSuggestions(true)
            }}
            onFocus={() => setShowQuotationSuggestions(true)}
            onBlur={() => setTimeout(() => setShowQuotationSuggestions(false), 150)}
          />
          {showQuotationSuggestions && quotationQuery && quotationSuggestions.length > 0 && (
            <div style={styles.suggestions}>
              {quotationSuggestions.map((q) => (
                <div
                  key={q.id}
                  style={styles.suggestionItem}
                  onMouseDown={() => {
                    setQuotationQuery(q.quotation_number)
                    setShowQuotationSuggestions(false)
                  }}
                >
                  <span>{q.quotation_number} — {q.customer_name || 'Walk-in'}</span>
                  <span style={styles.suggestionPrice}>{formatPrice(q.grand_total)}</span>
                </div>
              ))}
            </div>
          )}
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

      <div style={styles.paymentCard}>
        <label style={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={fullyPaid}
            onChange={(e) => {
              setFullyPaid(e.target.checked)
              if (e.target.checked) setAmountReceived('')
            }}
          />
          Paid in full now
        </label>

        {!fullyPaid && (
          <div style={styles.amountRow}>
            <div>
              <label style={styles.label} htmlFor="amountReceived">Amount received now</label>
              <input
                id="amountReceived"
                style={styles.input}
                type="number"
                min="0"
                step="0.01"
                placeholder="0 for a credit sale"
                value={amountReceived}
                onChange={(e) => setAmountReceived(e.target.value)}
              />
            </div>
            <div style={styles.balanceNote}>
              Balance due: {formatPrice(Math.max(grandTotal - (Number(amountReceived) || 0), 0))}
            </div>
          </div>
        )}
      </div>

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
          onClick={handleCreateInvoice}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Create Invoice (PDF)'}
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
    marginBottom: 12,
  },
  card: {
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 16,
    marginTop: 8,
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
  paymentCard: {
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 16,
    marginTop: 16,
    background: '#f8fafc',
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    fontWeight: 600,
    color: '#334155',
    cursor: 'pointer',
  },
  amountRow: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 16,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  balanceNote: {
    fontSize: 13,
    fontWeight: 600,
    color: '#b45309',
    paddingBottom: 10,
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
