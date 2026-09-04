import { Fragment, useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'
import { formatPrice } from './format'
import { buildDocumentPdf, generateDocumentNumber, todayIso } from './documentPdf'
import useCompanyInfo from './useCompanyInfo'

const STATUS_LABELS = {
  received: 'Received',
  diagnosing: 'Diagnosing',
  waiting_for_parts: 'Waiting for parts',
  in_repair: 'In repair',
  ready_for_pickup: 'Ready for pickup',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const IN_PROGRESS_STATUSES = ['received', 'diagnosing', 'waiting_for_parts', 'in_repair', 'ready_for_pickup']

function formatDate(value) {
  return typeof value === 'string' ? value.slice(0, 10) : value
}

function mapsLink(address) {
  if (!address) return null
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

// A single search-as-you-type part picker feeding a running "parts to
// use" list. No category filter, no catalogue/discount pricing — a
// technician can only pick a product and a quantity; the price is always
// whatever the catalogue says, decided server-side at billing time.
function PartPicker({ token, onLogout, onAdd }) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!query) {
      setSuggestions([])
      return
    }
    let cancelled = false
    const id = setTimeout(() => {
      apiFetch(`/api/products?q=${encodeURIComponent(query)}&pageSize=8`, token)
        .then((data) => {
          if (!cancelled) setSuggestions(data.items || [])
        })
        .catch((err) => {
          if (!cancelled && err instanceof AuthError) onLogout()
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [token, query, onLogout])

  return (
    <div style={{ position: 'relative' }}>
      <input
        style={styles.input}
        type="text"
        placeholder="Search for a part…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setShow(true)
        }}
        onFocus={() => setShow(true)}
        onBlur={() => setTimeout(() => setShow(false), 150)}
      />
      {show && query && suggestions.length > 0 && (
        <div style={styles.suggestions}>
          {suggestions.map((p) => (
            <div
              key={p.id}
              style={styles.suggestionItem}
              onMouseDown={() => {
                onAdd(p)
                setQuery('')
                setShow(false)
              }}
            >
              <span>{p.name}</span>
              <span style={styles.suggestionMeta}>{formatPrice(p.price)} · {p.quantity} in stock</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BillJobForm({ token, onLogout, ticket, onBilled }) {
  const [hoursWorked, setHoursWorked] = useState('')
  const [parts, setParts] = useState([]) // { productId, name, quantity, maxQuantity }
  const [gstRate, setGstRate] = useState(18)
  const [paymentMethod, setPaymentMethod] = useState('Cash')
  const [fullyPaid, setFullyPaid] = useState(true)
  const [amountReceived, setAmountReceived] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const companyInfo = useCompanyInfo()

  function addPart(product) {
    setParts((prev) => {
      if (prev.some((p) => p.productId === product.id)) return prev
      return [...prev, { productId: product.id, name: product.name, category: product.category, quantity: 1, maxQuantity: product.quantity }]
    })
  }

  function setPartQuantity(productId, quantity) {
    setParts((prev) => prev.map((p) => (p.productId === productId ? { ...p, quantity } : p)))
  }

  function removePart(productId) {
    setParts((prev) => prev.filter((p) => p.productId !== productId))
  }

  async function handleBill() {
    setError('')
    const hours = hoursWorked === '' ? null : Number(hoursWorked)
    if (hoursWorked !== '' && (!Number.isFinite(hours) || hours <= 0)) {
      setError('Hours worked must be a positive number.')
      return
    }
    if (hours === null && parts.length === 0) {
      setError('Log hours worked or add at least one part before billing.')
      return
    }
    for (const p of parts) {
      const qty = parseInt(p.quantity, 10)
      if (!Number.isInteger(qty) || qty <= 0) {
        setError(`Enter a valid quantity for "${p.name}".`)
        return
      }
    }

    setSaving(true)
    try {
      const invoiceNumber = generateDocumentNumber('INV')
      const invoiceDate = todayIso()
      const { invoice } = await apiFetch(`/api/repair-tickets/${ticket.id}/bill`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceNumber,
          invoiceDate,
          hoursWorked: hours,
          parts: parts.map((p) => ({ productId: p.productId, quantity: parseInt(p.quantity, 10) })),
          gstRate,
          paymentMethod,
          amountReceived: fullyPaid ? undefined : (amountReceived === '' ? 0 : Number(amountReceived)),
        }),
      })

      buildDocumentPdf({
        docLabel: 'Invoice',
        filePrefix: 'Invoice',
        number: invoice.invoice_number,
        date: formatDate(invoice.invoice_date),
        fields: [
          ['Customer', invoice.customer_name],
          ['Phone', invoice.customer_phone],
          ['Address', invoice.customer_address],
          ['Payment Method', invoice.payment_method],
          ['Repair Ticket Ref', invoice.ticket_number],
        ],
        items: invoice.items || [],
        companyInfo,
        subtotal: invoice.subtotal,
        gstRate: Number(invoice.gst_rate) || 0,
        gstAmount: invoice.gst_amount,
        grandTotal: invoice.grand_total,
      })

      onBilled(invoice)
    } catch (err) {
      if (err instanceof AuthError) onLogout()
      else setError(err.message || 'Could not bill this job.')
    } finally {
      setSaving(false)
    }
  }

  const laborPreview = hoursWorked && Number(hoursWorked) > 0 ? Number(hoursWorked) * (companyInfo.laborRatePerHour || 100) : 0
  const partsPreview = parts.reduce((sum, p) => sum + (parseInt(p.quantity, 10) || 0), 0)

  return (
    <div style={styles.billCard}>
      <h4 style={styles.sectionTitle}>Bill this job</h4>

      <div style={styles.fieldRow}>
        <label style={styles.fieldLabel}>Hours worked (labor)</label>
        <input
          style={styles.input}
          type="number"
          min="0"
          step="0.25"
          placeholder="e.g. 1.5"
          value={hoursWorked}
          onChange={(e) => setHoursWorked(e.target.value)}
        />
        {laborPreview > 0 && <span style={styles.previewNote}>≈ {formatPrice(laborPreview)} labor charge</span>}
      </div>

      <div style={styles.fieldRow}>
        <label style={styles.fieldLabel}>Parts used ({partsPreview} unit{partsPreview === 1 ? '' : 's'})</label>
        <PartPicker token={token} onLogout={onLogout} onAdd={addPart} />
        {parts.length > 0 && (
          <div style={styles.partsList}>
            {parts.map((p) => (
              <div key={p.productId} style={styles.partRow}>
                <span style={styles.partName}>{p.name}</span>
                <input
                  style={styles.qtyInput}
                  type="number"
                  min="1"
                  max={p.maxQuantity}
                  value={p.quantity}
                  onChange={(e) => setPartQuantity(p.productId, e.target.value)}
                />
                <button type="button" style={styles.removeButton} onClick={() => removePart(p.productId)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={styles.fieldRow}>
        <label style={styles.fieldLabel}>Payment method</label>
        <select style={styles.input} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
          {['Cash', 'Card', 'UPI', 'Bank Transfer', 'Other'].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <label style={styles.checkboxRow}>
        <input type="checkbox" checked={fullyPaid} onChange={(e) => setFullyPaid(e.target.checked)} />
        Collected in full
      </label>
      {!fullyPaid && (
        <div style={styles.fieldRow}>
          <label style={styles.fieldLabel}>Amount collected now</label>
          <input
            style={styles.input}
            type="number"
            min="0"
            step="0.01"
            value={amountReceived}
            onChange={(e) => setAmountReceived(e.target.value)}
          />
        </div>
      )}

      {error && <div style={styles.error}>{error}</div>}

      <button type="button" style={styles.billButton} onClick={handleBill} disabled={saving}>
        {saving ? 'Billing…' : 'Generate Invoice & Collect Payment'}
      </button>
    </div>
  )
}

function JobDetail({ token, onLogout, ticket, onUpdated }) {
  const [status, setStatus] = useState(ticket.status)
  const [savingStatus, setSavingStatus] = useState(false)
  const [billedInvoice, setBilledInvoice] = useState(null)
  const [error, setError] = useState('')

  async function handleStatusChange(newStatus) {
    setStatus(newStatus)
    setSavingStatus(true)
    setError('')
    try {
      await apiFetch(`/api/repair-tickets/${ticket.id}`, token, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      onUpdated()
    } catch (err) {
      if (err instanceof AuthError) onLogout()
      else setError(err.message || 'Could not update status.')
    } finally {
      setSavingStatus(false)
    }
  }

  const maps = mapsLink(ticket.customer_address)
  const alreadyBilled = Boolean(ticket.invoice_number)

  return (
    <div style={styles.detailCell}>
      <div style={styles.detailGrid}>
        <span><strong>Customer:</strong> {ticket.customer_name || '—'} {ticket.customer_phone ? `(${ticket.customer_phone})` : ''}</span>
        <span><strong>Device:</strong> {ticket.device_description}</span>
        <span><strong>Reported issue:</strong> {ticket.reported_issue}</span>
        {ticket.customer_address && <span><strong>Address:</strong> {ticket.customer_address}</span>}
        {maps && (
          <a href={maps} target="_blank" rel="noreferrer" style={styles.mapsLink}>
            Open in Maps →
          </a>
        )}
      </div>

      {!alreadyBilled && (
        <div style={styles.statusRow}>
          <label style={styles.fieldLabel}>Status</label>
          <select style={styles.input} value={status} onChange={(e) => handleStatusChange(e.target.value)} disabled={savingStatus}>
            {IN_PROGRESS_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
      )}

      {error && <div style={styles.error}>{error}</div>}

      {alreadyBilled ? (
        <div style={styles.billedNote}>
          Billed as invoice <strong>{ticket.invoice_number}</strong> — {formatPrice(ticket.final_cost)}. Job complete.
        </div>
      ) : billedInvoice ? (
        <div style={styles.billedNote}>
          Billed as invoice <strong>{billedInvoice.invoice_number}</strong> — {formatPrice(billedInvoice.grand_total)}.
          PDF downloaded. Job complete.
        </div>
      ) : (
        <BillJobForm
          token={token}
          onLogout={onLogout}
          ticket={ticket}
          onBilled={(invoice) => {
            setBilledInvoice(invoice)
            onUpdated()
          }}
        />
      )}
    </div>
  )
}

// No pagination here on purpose — a technician's own active job list is
// realistically a handful of tickets, not thousands of rows, so a single
// fetch (large enough to never truncate in practice) keeps this simple.
const MAX_JOBS = 100

export default function TechnicianJobs({ token, onLogout }) {
  const [items, setItems] = useState([])
  const [showCompleted, setShowCompleted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    apiFetch(`/api/repair-tickets?pageSize=${MAX_JOBS}`, token)
      .then((data) => {
        if (cancelled) return
        // Server already scopes this to tickets assigned to the technician;
        // client-side we just additionally hide completed/cancelled jobs
        // by default so "my jobs" reads as a to-do list, not a full history.
        const filtered = showCompleted
          ? data.items
          : data.items.filter((t) => !['completed', 'cancelled'].includes(t.status))
        setItems(filtered)
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
  }, [token, showCompleted, onLogout, refreshKey])

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>My Jobs</h2>
        <p style={styles.subtitle}>Tickets assigned to you.</p>
      </header>

      <div style={styles.toolbar}>
        <label style={styles.checkboxRow}>
          <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />
          Show completed jobs too
        </label>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Ticket #</th>
              <th style={styles.th}>Customer</th>
              <th style={styles.th}>Device</th>
              <th style={styles.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td style={styles.td} colSpan={4}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td style={styles.td} colSpan={4}>No jobs assigned to you right now.</td></tr>
            ) : (
              items.map((t) => (
                <Fragment key={t.id}>
                  <tr style={styles.row} onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
                    <td style={styles.td}>{t.ticket_number}</td>
                    <td style={styles.td}>{t.customer_name || '—'}</td>
                    <td style={styles.td}>{t.device_description}</td>
                    <td style={styles.td}>{STATUS_LABELS[t.status] || t.status}</td>
                  </tr>
                  {expandedId === t.id && (
                    <tr>
                      <td colSpan={4} style={{ padding: 0 }}>
                        <JobDetailLoader
                          token={token}
                          onLogout={onLogout}
                          ticketId={t.id}
                          onUpdated={() => setRefreshKey((k) => k + 1)}
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
    </div>
  )
}

// Fetches the full ticket (with address, issue, etc. — not in the list
// response) each time a row is expanded, so the detail always reflects
// the latest status/billing state.
function JobDetailLoader({ token, onLogout, ticketId, onUpdated }) {
  const [ticket, setTicket] = useState(null)
  const [error, setError] = useState('')

  function load() {
    apiFetch(`/api/repair-tickets/${ticketId}`, token)
      .then((data) => setTicket(data.ticket))
      .catch((err) => {
        if (err instanceof AuthError) onLogout()
        else setError(err.message)
      })
  }

  useEffect(load, [token, ticketId])

  if (error) return <div style={styles.detailCell}>{error}</div>
  if (!ticket) return <div style={styles.detailCell}>Loading…</div>

  return (
    <JobDetail
      token={token}
      onLogout={onLogout}
      ticket={ticket}
      onUpdated={() => {
        load()
        onUpdated()
      }}
    />
  )
}

const styles = {
  header: { marginBottom: 20 },
  title: { margin: 0, fontSize: 18, color: '#0f172a' },
  subtitle: { margin: '4px 0 0 0', color: '#64748b', fontSize: 14 },
  toolbar: { display: 'flex', gap: 12, marginBottom: 16 },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    fontWeight: 600,
    color: '#334155',
    cursor: 'pointer',
  },
  error: {
    marginTop: 12,
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
  detailCell: {
    padding: '16px 18px',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
  },
  detailGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginBottom: 14,
    fontSize: 13,
    color: '#334155',
  },
  mapsLink: {
    color: '#1e3a8a',
    fontWeight: 600,
    fontSize: 13,
    textDecoration: 'none',
  },
  statusRow: { maxWidth: 260, marginBottom: 16 },
  fieldLabel: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#334155',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    padding: '9px 11px',
    borderRadius: 7,
    border: '1px solid #cbd5e1',
    fontSize: 13,
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
  suggestionMeta: { color: '#64748b', whiteSpace: 'nowrap', fontSize: 12 },
  billCard: {
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 16,
    background: '#fff',
  },
  sectionTitle: { margin: '0 0 12px 0', fontSize: 14, color: '#0f172a' },
  fieldRow: { marginBottom: 14 },
  previewNote: { display: 'block', marginTop: 4, fontSize: 12, color: '#64748b' },
  partsList: { marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 },
  partRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
  },
  partName: { flex: 1, fontSize: 13, color: '#0f172a' },
  qtyInput: {
    width: 60,
    padding: '5px 7px',
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    fontSize: 12,
    textAlign: 'right',
  },
  removeButton: {
    padding: '5px 9px',
    borderRadius: 6,
    border: '1px solid #fecaca',
    background: '#fef2f2',
    color: '#b91c1c',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
  billButton: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 8,
    border: 'none',
    background: '#1e3a8a',
    color: '#fff',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  billedNote: {
    padding: '12px 14px',
    borderRadius: 8,
    background: '#f0fdf4',
    color: '#166534',
    fontSize: 13,
    fontWeight: 600,
  },
}
