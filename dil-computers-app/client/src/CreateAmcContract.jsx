import { useState } from 'react'
import { apiFetch, AuthError } from './api'
import { generateDocumentNumber, todayIso } from './documentPdf'
import CustomerPicker from './CustomerPicker'

export default function CreateAmcContract({ token, onLogout }) {
  const [contractNumber, setContractNumber] = useState(() => generateDocumentNumber('AMC'))
  const [startDate, setStartDate] = useState(todayIso)
  const [endDate, setEndDate] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerId, setCustomerId] = useState(null)
  const [amount, setAmount] = useState('')
  const [coveredDevices, setCoveredDevices] = useState('')
  const [notes, setNotes] = useState('')

  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    setFormError('')
    setSuccessMessage('')
    if (!contractNumber.trim()) {
      setFormError('Contract number is required.')
      return
    }
    if (!customerId) {
      setFormError('Pick a saved customer for this contract.')
      return
    }
    if (!startDate || !endDate) {
      setFormError('Start and end dates are required.')
      return
    }
    if (endDate < startDate) {
      setFormError('End date cannot be before the start date.')
      return
    }
    const amountNum = Number(amount)
    if (amount === '' || !Number.isFinite(amountNum) || amountNum < 0) {
      setFormError('Enter a valid contract amount.')
      return
    }

    setSaving(true)
    try {
      const { contract } = await apiFetch('/api/amc-contracts', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractNumber: contractNumber.trim(),
          customerId,
          startDate,
          endDate,
          amount: amountNum,
          coveredDevices,
          notes,
        }),
      })

      setSuccessMessage(`AMC contract ${contract.contract_number} saved, running to ${contract.end_date.slice(0, 10)}.`)

      setContractNumber(generateDocumentNumber('AMC'))
      setStartDate(todayIso())
      setEndDate('')
      setCustomerName('')
      setCustomerId(null)
      setAmount('')
      setCoveredDevices('')
      setNotes('')
    } catch (err) {
      if (err instanceof AuthError) {
        onLogout()
        return
      }
      setFormError(err.message || 'Could not save the contract. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>Create AMC Contract</h2>
        <p style={styles.subtitle}>Set up an annual maintenance contract for a customer.</p>
      </header>

      <div style={styles.detailsGrid}>
        <div>
          <label style={styles.label} htmlFor="contractNumber">Contract #</label>
          <input
            id="contractNumber"
            style={styles.input}
            type="text"
            value={contractNumber}
            onChange={(e) => setContractNumber(e.target.value)}
          />
        </div>
        <CustomerPicker
          token={token}
          onLogout={onLogout}
          id="amcCustomer"
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
          emptyMessage="No matching customers — add one from the Customers section first."
        />
        <div>
          <label style={styles.label} htmlFor="startDate">Start date</label>
          <input
            id="startDate"
            style={styles.input}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <label style={styles.label} htmlFor="endDate">End date</label>
          <input
            id="endDate"
            style={styles.input}
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <div>
          <label style={styles.label} htmlFor="amount">Contract amount</label>
          <input
            id="amount"
            style={styles.input}
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label style={styles.label} htmlFor="coveredDevices">Covered devices (optional)</label>
        <input
          id="coveredDevices"
          style={styles.input}
          type="text"
          placeholder="e.g. 3 desktops, 1 printer"
          value={coveredDevices}
          onChange={(e) => setCoveredDevices(e.target.value)}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={styles.label} htmlFor="notes">Notes (optional)</label>
        <textarea
          id="notes"
          style={styles.textarea}
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {formError && <div style={styles.error}>{formError}</div>}
      {successMessage && <div style={styles.success}>{successMessage}</div>}

      <div style={styles.footer}>
        <button type="button" style={styles.createButton} onClick={handleCreate} disabled={saving}>
          {saving ? 'Saving…' : 'Create AMC Contract'}
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
