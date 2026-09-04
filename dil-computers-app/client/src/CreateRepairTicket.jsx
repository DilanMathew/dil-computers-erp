import { useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'
import { todayIso } from './documentPdf'
import useDocumentNumber from './useDocumentNumber'
import CustomerPicker from './CustomerPicker'

export default function CreateRepairTicket({ token, onLogout }) {
  const [ticketNumber, setTicketNumber, refreshTicketNumber] = useDocumentNumber('TKT', token)
  const [receivedDate, setReceivedDate] = useState(todayIso)
  const [customerName, setCustomerName] = useState('')
  const [customerId, setCustomerId] = useState(null)
  const [deviceDescription, setDeviceDescription] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [reportedIssue, setReportedIssue] = useState('')
  const [estimatedCost, setEstimatedCost] = useState('')

  const [amcQuery, setAmcQuery] = useState('')
  const [amcContractId, setAmcContractId] = useState(null)
  const [amcSuggestions, setAmcSuggestions] = useState([])
  const [showAmcSuggestions, setShowAmcSuggestions] = useState(false)

  const [technicians, setTechnicians] = useState([])
  const [assignedToUsername, setAssignedToUsername] = useState('')

  // Filled in only when the typed customer isn't one we have on file — the
  // ticket then creates the customer record too (see POST /api/repair-tickets).
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [newCustomerAddress, setNewCustomerAddress] = useState('')

  // A name typed but not picked from the dropdown means "not on file yet".
  const isNewCustomer = Boolean(customerName.trim()) && !customerId

  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiFetch('/api/technicians', token)
      .then((data) => setTechnicians(data.technicians || []))
      .catch((err) => {
        if (err instanceof AuthError) onLogout()
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Look up AMC contracts as the user types, same pattern as the
  // quotation-reference autocomplete on Create Invoice.
  useEffect(() => {
    if (!amcQuery) {
      setAmcSuggestions([])
      return
    }
    let cancelled = false
    const id = setTimeout(() => {
      apiFetch(`/api/amc-contracts?q=${encodeURIComponent(amcQuery)}&pageSize=6`, token)
        .then((data) => {
          if (cancelled) return
          setAmcSuggestions(data.items || [])
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
  }, [token, amcQuery, onLogout])

  async function handleCreate() {
    setFormError('')
    setSuccessMessage('')
    if (!ticketNumber.trim()) {
      setFormError('Ticket number is required.')
      return
    }
    if (!customerId && !customerName.trim()) {
      setFormError('Enter a customer — pick a saved one, or type a new name to add them.')
      return
    }
    if (!deviceDescription.trim()) {
      setFormError('Device description is required.')
      return
    }
    if (!reportedIssue.trim()) {
      setFormError('Reported issue is required.')
      return
    }

    setSaving(true)
    try {
      const { ticket, customer } = await apiFetch('/api/repair-tickets', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketNumber: ticketNumber.trim(),
          customerId,
          newCustomer: isNewCustomer
            ? {
                name: customerName.trim(),
                phone: newCustomerPhone,
                address: newCustomerAddress,
              }
            : undefined,
          deviceDescription: deviceDescription.trim(),
          serialNumber,
          reportedIssue: reportedIssue.trim(),
          estimatedCost: estimatedCost === '' ? null : estimatedCost,
          receivedDate,
          amcContractId,
          assignedToUsername,
        }),
      })

      setSuccessMessage(
        customer
          ? `Ticket ${ticket.ticket_number} saved, and "${customer.name}" was added to Customers.`
          : `Ticket ${ticket.ticket_number} saved. Update its status from the Repair Tickets list as work progresses.`
      )

      refreshTicketNumber()
      setReceivedDate(todayIso())
      setCustomerName('')
      setCustomerId(null)
      setNewCustomerPhone('')
      setNewCustomerAddress('')
      setDeviceDescription('')
      setSerialNumber('')
      setReportedIssue('')
      setEstimatedCost('')
      setAmcQuery('')
      setAmcContractId(null)
      setAssignedToUsername('')
    } catch (err) {
      if (err instanceof AuthError) {
        onLogout()
        return
      }
      setFormError(err.message || 'Could not save the ticket. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>Create Repair Ticket</h2>
        <p style={styles.subtitle}>Log a device dropped off for repair or service.</p>
      </header>

      <div style={styles.detailsGrid}>
        <div>
          <label style={styles.label} htmlFor="ticketNumber">Ticket #</label>
          <input
            id="ticketNumber"
            style={styles.input}
            type="text"
            value={ticketNumber}
            onChange={(e) => setTicketNumber(e.target.value)}
          />
        </div>
        <div>
          <label style={styles.label} htmlFor="receivedDate">Received date</label>
          <input
            id="receivedDate"
            style={styles.input}
            type="date"
            value={receivedDate}
            onChange={(e) => setReceivedDate(e.target.value)}
          />
        </div>
        <CustomerPicker
          token={token}
          onLogout={onLogout}
          id="ticketCustomer"
          label="Customer"
          required
          placeholder="Search saved customers…"
          value={customerName}
          onInputChange={(text) => {
            setCustomerName(text)
            setCustomerId(null)
          }}
          onSelect={(customer) => {
            setCustomerName(customer.name)
            setCustomerId(customer.id)
          }}
          emptyMessage="No match — keep typing to add them as a new customer."
        />
        <div>
          <label style={styles.label} htmlFor="serialNumber">Serial number (optional)</label>
          <input
            id="serialNumber"
            style={styles.input}
            type="text"
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
          />
        </div>
        <div>
          <label style={styles.label} htmlFor="assignedTech">Assign technician (optional)</label>
          <select
            id="assignedTech"
            style={styles.input}
            value={assignedToUsername}
            onChange={(e) => setAssignedToUsername(e.target.value)}
          >
            <option value="">Unassigned</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.username}>{t.full_name || t.username}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={styles.label} htmlFor="estimatedCost">Estimated cost (optional)</label>
          <input
            id="estimatedCost"
            style={styles.input}
            type="number"
            min="0"
            step="0.01"
            value={estimatedCost}
            onChange={(e) => setEstimatedCost(e.target.value)}
          />
        </div>
        <div style={{ position: 'relative' }}>
          <label style={styles.label} htmlFor="amcRef">Covered by AMC contract # (optional)</label>
          <input
            id="amcRef"
            style={styles.input}
            type="text"
            placeholder="Search by contract # or customer…"
            value={amcQuery}
            onChange={(e) => {
              setAmcQuery(e.target.value)
              setAmcContractId(null)
              setShowAmcSuggestions(true)
            }}
            onFocus={() => setShowAmcSuggestions(true)}
            onBlur={() => setTimeout(() => setShowAmcSuggestions(false), 150)}
          />
          {showAmcSuggestions && amcQuery && amcSuggestions.length > 0 && (
            <div style={styles.suggestions}>
              {amcSuggestions.map((a) => (
                <div
                  key={a.id}
                  style={styles.suggestionItem}
                  onMouseDown={() => {
                    setAmcQuery(a.contract_number)
                    setAmcContractId(a.id)
                    setShowAmcSuggestions(false)
                  }}
                >
                  <span>{a.contract_number} — {a.customer_name || '—'}</span>
                  <span style={styles.suggestionMeta}>{a.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {isNewCustomer && (
        <div style={styles.newCustomerPanel}>
          <div style={styles.newCustomerTitle}>
            New customer — “{customerName.trim()}” will be added to Customers
          </div>
          <div style={styles.newCustomerGrid}>
            <div>
              <label style={styles.label} htmlFor="newCustomerPhone">Phone</label>
              <input
                id="newCustomerPhone"
                style={styles.input}
                type="text"
                placeholder="Contact number"
                value={newCustomerPhone}
                onChange={(e) => setNewCustomerPhone(e.target.value)}
              />
            </div>
            <div>
              <label style={styles.label} htmlFor="newCustomerAddress">Address</label>
              <input
                id="newCustomerAddress"
                style={styles.input}
                type="text"
                placeholder="Where the technician should go"
                value={newCustomerAddress}
                onChange={(e) => setNewCustomerAddress(e.target.value)}
              />
            </div>
          </div>
          <div style={styles.newCustomerHint}>
            Both are optional, but the address is what the technician opens in Maps for an on-site job.
          </div>
        </div>
      )}

      <div>
        <label style={styles.label} htmlFor="deviceDescription">Device description</label>
        <input
          id="deviceDescription"
          style={styles.input}
          type="text"
          placeholder="e.g. Dell Inspiron 15 laptop"
          value={deviceDescription}
          onChange={(e) => setDeviceDescription(e.target.value)}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={styles.label} htmlFor="reportedIssue">Reported issue</label>
        <textarea
          id="reportedIssue"
          style={styles.textarea}
          rows={3}
          placeholder="What the customer says is wrong"
          value={reportedIssue}
          onChange={(e) => setReportedIssue(e.target.value)}
        />
      </div>

      {formError && <div style={styles.error}>{formError}</div>}
      {successMessage && <div style={styles.success}>{successMessage}</div>}

      <div style={styles.footer}>
        <button type="button" style={styles.createButton} onClick={handleCreate} disabled={saving}>
          {saving ? 'Saving…' : 'Create Repair Ticket'}
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
  textarea: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    outline: 'none',
    background: '#fff',
    resize: 'vertical',
    fontFamily: 'inherit',
  },
  newCustomerPanel: {
    border: '1px solid #bfdbfe',
    background: '#eff6ff',
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
  },
  newCustomerTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: '#1e3a8a',
    marginBottom: 10,
  },
  newCustomerGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
  },
  newCustomerHint: {
    marginTop: 8,
    fontSize: 12,
    color: '#475569',
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
  suggestionMeta: {
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
    marginTop: 12,
    padding: '10px 12px',
    borderRadius: 8,
    background: '#f0fdf4',
    color: '#166534',
    fontSize: 13,
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: 16,
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
