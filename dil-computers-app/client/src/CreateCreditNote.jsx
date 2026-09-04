import { useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'
import { formatPrice } from './format'
import useDocumentNumber from './useDocumentNumber'

const REFUND_METHODS = ['Cash', 'Card', 'UPI', 'Bank Transfer', 'Store Credit', 'Other']

export default function CreateCreditNote({ token, onLogout }) {
  const [creditNoteNumber, setCreditNoteNumber, refreshCreditNoteNumber] = useDocumentNumber('CN', token)
  const [reason, setReason] = useState('')
  const [refundMethod, setRefundMethod] = useState(REFUND_METHODS[0])

  const [invoiceQuery, setInvoiceQuery] = useState('')
  const [invoiceSuggestions, setInvoiceSuggestions] = useState([])
  const [showInvoiceSuggestions, setShowInvoiceSuggestions] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState(null)

  const [returnItems, setReturnItems] = useState([]) // items with alreadyReturned/maxReturnable
  const [quantities, setQuantities] = useState({}) // productId -> quantity to return
  const [loadingItems, setLoadingItems] = useState(false)

  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!invoiceQuery || selectedInvoice) {
      setInvoiceSuggestions([])
      return
    }
    let cancelled = false
    const id = setTimeout(() => {
      apiFetch(`/api/invoices?q=${encodeURIComponent(invoiceQuery)}&pageSize=6`, token)
        .then((data) => {
          if (cancelled) return
          setInvoiceSuggestions(data.items || [])
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
  }, [token, invoiceQuery, selectedInvoice, onLogout])

  function pickInvoice(invoice) {
    setSelectedInvoice(invoice)
    setInvoiceQuery(invoice.invoice_number)
    setShowInvoiceSuggestions(false)
    setFormError('')
    setLoadingItems(true)
    apiFetch(`/api/invoices/${invoice.id}/return-summary`, token)
      .then((data) => {
        setReturnItems(data.items || [])
        setQuantities({})
      })
      .catch((err) => {
        if (err instanceof AuthError) onLogout()
        else setFormError(err.message || 'Could not load that invoice.')
      })
      .finally(() => setLoadingItems(false))
  }

  function clearInvoice() {
    setSelectedInvoice(null)
    setInvoiceQuery('')
    setReturnItems([])
    setQuantities({})
  }

  const linesToReturn = returnItems
    .map((item) => ({ item, quantity: Number(quantities[item.productId]) || 0 }))
    .filter((l) => l.quantity > 0)

  const previewSubtotal = linesToReturn.reduce((sum, l) => sum + l.item.finalPrice * l.quantity, 0)

  async function handleCreate() {
    setFormError('')
    setSuccessMessage('')
    if (!creditNoteNumber.trim()) {
      setFormError('Credit note number is required.')
      return
    }
    if (!selectedInvoice) {
      setFormError('Pick the invoice this return is against.')
      return
    }
    if (linesToReturn.length === 0) {
      setFormError('Enter a quantity to return for at least one item.')
      return
    }

    setSaving(true)
    try {
      const { creditNote } = await apiFetch('/api/credit-notes', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creditNoteNumber: creditNoteNumber.trim(),
          invoiceId: selectedInvoice.id,
          reason,
          refundMethod,
          items: linesToReturn.map((l) => ({ productId: l.item.productId, quantity: l.quantity })),
        }),
      })

      setSuccessMessage(
        `Credit note ${creditNote.credit_note_number} saved — ${formatPrice(creditNote.grand_total)} refundable. Stock updated.`
      )

      refreshCreditNoteNumber()
      setReason('')
      setRefundMethod(REFUND_METHODS[0])
      clearInvoice()
    } catch (err) {
      if (err instanceof AuthError) {
        onLogout()
        return
      }
      setFormError(err.message || 'Could not save the credit note. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>Create Credit Note</h2>
        <p style={styles.subtitle}>Process a return against an existing invoice. Returned stock goes back on the shelf.</p>
      </header>

      <div style={styles.detailsGrid}>
        <div>
          <label style={styles.label} htmlFor="creditNoteNumber">Credit note #</label>
          <input
            id="creditNoteNumber"
            style={styles.input}
            type="text"
            value={creditNoteNumber}
            onChange={(e) => setCreditNoteNumber(e.target.value)}
          />
        </div>
        <div style={{ position: 'relative' }}>
          <label style={styles.label} htmlFor="invoiceRef">Invoice to return against</label>
          <input
            id="invoiceRef"
            style={styles.input}
            type="text"
            placeholder="Search by invoice # or customer…"
            value={invoiceQuery}
            onChange={(e) => {
              setInvoiceQuery(e.target.value)
              setSelectedInvoice(null)
              setReturnItems([])
              setQuantities({})
              setShowInvoiceSuggestions(true)
            }}
            onFocus={() => setShowInvoiceSuggestions(true)}
            onBlur={() => setTimeout(() => setShowInvoiceSuggestions(false), 150)}
          />
          {showInvoiceSuggestions && invoiceQuery && !selectedInvoice && invoiceSuggestions.length > 0 && (
            <div style={styles.suggestions}>
              {invoiceSuggestions.map((inv) => (
                <div key={inv.id} style={styles.suggestionItem} onMouseDown={() => pickInvoice(inv)}>
                  <span>{inv.invoice_number} — {inv.customer_name || 'Walk-in'}</span>
                  <span style={styles.suggestionPrice}>{formatPrice(inv.grand_total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <label style={styles.label} htmlFor="refundMethod">Refund method</label>
          <select id="refundMethod" style={styles.input} value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
            {REFUND_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label style={styles.label} htmlFor="reason">Reason (optional)</label>
        <input
          id="reason"
          style={styles.input}
          type="text"
          placeholder="e.g. Defective on arrival, wrong item ordered…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      {selectedInvoice && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Items on {selectedInvoice.invoice_number}</h3>
          {loadingItems ? (
            <p style={styles.muted}>Loading…</p>
          ) : returnItems.length === 0 ? (
            <p style={styles.muted}>No line items found on this invoice.</p>
          ) : (
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Product</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>Sold Qty</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>Already Returned</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>Unit Price</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>Return Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {returnItems.map((item) => (
                    <tr key={item.productId}>
                      <td style={styles.td}>{item.name}</td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>{item.quantity}</td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>{item.alreadyReturned}</td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>{formatPrice(item.finalPrice)}</td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>
                        <input
                          style={styles.qtyInput}
                          type="number"
                          min="0"
                          max={item.maxReturnable}
                          step="1"
                          disabled={item.maxReturnable <= 0}
                          placeholder={item.maxReturnable <= 0 ? 'Fully returned' : '0'}
                          value={quantities[item.productId] ?? ''}
                          onChange={(e) =>
                            setQuantities((q) => ({ ...q, [item.productId]: e.target.value }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {formError && <div style={styles.error}>{formError}</div>}
      {successMessage && <div style={styles.success}>{successMessage}</div>}

      <div style={styles.footer}>
        <div style={styles.totalsBlock}>
          <span style={styles.grandTotal}>Refund preview: {formatPrice(previewSubtotal)} + GST</span>
        </div>
        <button type="button" style={styles.createButton} onClick={handleCreate} disabled={saving}>
          {saving ? 'Saving…' : 'Create Credit Note'}
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
    marginBottom: 12,
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
  qtyInput: {
    width: 80,
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    fontSize: 13,
    background: '#fff',
    textAlign: 'right',
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
  muted: {
    margin: 0,
    fontSize: 13,
    color: '#94a3b8',
  },
  tableWrap: { overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left',
    padding: '8px 10px',
    background: '#f1f5f9',
    borderBottom: '1px solid #e2e8f0',
    color: '#334155',
    fontWeight: 600,
  },
  td: { padding: '8px 10px', borderBottom: '1px solid #f1f5f9', color: '#0f172a' },
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
  grandTotal: {
    fontSize: 14,
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
