import { useState } from 'react'
import { apiFetch, AuthError } from './api'

const STATUS_LABELS = {
  received: 'Received',
  diagnosing: 'Diagnosing',
  waiting_for_parts: 'Waiting for parts',
  in_repair: 'In repair',
  ready_for_pickup: 'Ready for pickup',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

function formatDate(value) {
  return typeof value === 'string' ? value.slice(0, 10) : value || '—'
}

function WarrantyBadge({ status, daysRemaining }) {
  if (status === 'in_warranty') {
    return (
      <span style={{ ...styles.badge, background: '#dcfce7', color: '#166534' }}>
        In warranty · {daysRemaining} day{daysRemaining === 1 ? '' : 's'} left
      </span>
    )
  }
  if (status === 'expired') {
    return (
      <span style={{ ...styles.badge, background: '#fee2e2', color: '#991b1b' }}>
        Expired {Math.abs(daysRemaining)} day{Math.abs(daysRemaining) === 1 ? '' : 's'} ago
      </span>
    )
  }
  return (
    <span style={{ ...styles.badge, background: '#f1f5f9', color: '#475569' }}>
      No warranty period set
    </span>
  )
}

export default function WarrantyLookup({ token, onLogout }) {
  const [serial, setSerial] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLookup() {
    const value = serial.trim()
    if (!value) {
      setError('Enter or scan a serial number.')
      return
    }
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const data = await apiFetch(`/api/serial-lookup?serial=${encodeURIComponent(value)}`, token)
      setResult(data)
    } catch (err) {
      if (err instanceof AuthError) onLogout()
      else setError(err.message || 'Could not look up that serial number.')
    } finally {
      setLoading(false)
    }
  }

  const nothingFound = result && result.sales.length === 0 && result.repairs.length === 0

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>Warranty Lookup</h2>
        <p style={styles.subtitle}>
          Scan or type a serial number to see what it was sold on, whether it's still in
          warranty, and any service history.
        </p>
      </header>

      <div style={styles.searchRow}>
        <input
          style={styles.search}
          type="text"
          autoFocus
          placeholder="Scan or type a serial number…"
          value={serial}
          onChange={(e) => setSerial(e.target.value)}
          onKeyDown={(e) => {
            // A USB barcode scanner types the code then presses Enter.
            if (e.key === 'Enter') handleLookup()
          }}
        />
        <button type="button" style={styles.button} onClick={handleLookup} disabled={loading}>
          {loading ? 'Looking up…' : 'Look up'}
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {nothingFound && (
        <div style={styles.empty}>
          No sale or repair recorded against “{result.serial}”. Serial numbers are only
          captured when they're entered on the invoice line at the time of sale.
        </div>
      )}

      {result && result.sales.length > 0 && (
        <section style={styles.section}>
          <h3 style={styles.sectionTitle}>Sold on</h3>
          {result.sales.map((s, i) => (
            <div key={`${s.invoice_id}-${i}`} style={styles.card}>
              <div style={styles.cardTop}>
                <div>
                  <div style={styles.productName}>{s.product_name}</div>
                  <div style={styles.meta}>{s.category}</div>
                </div>
                <WarrantyBadge status={s.warranty_status} daysRemaining={s.days_remaining} />
              </div>
              <div style={styles.detailGrid}>
                <span>Invoice: <strong>{s.invoice_number}</strong></span>
                <span>Sold: {formatDate(s.invoice_date)}</span>
                <span>Customer: {s.customer_name || '—'}</span>
                {s.customer_phone && <span>Phone: {s.customer_phone}</span>}
                {s.warranty_months
                  ? <span>Warranty: {s.warranty_months} months, until {s.warranty_expires_on}</span>
                  : <span>Warranty: not set on this product</span>}
              </div>
            </div>
          ))}
          <div style={styles.footnote}>
            Warranty length is read from the product's current catalogue setting — changing it
            there changes what past sales report here.
          </div>
        </section>
      )}

      {result && result.repairs.length > 0 && (
        <section style={styles.section}>
          <h3 style={styles.sectionTitle}>Service history</h3>
          {result.repairs.map((r) => (
            <div key={r.id} style={styles.card}>
              <div style={styles.cardTop}>
                <div style={styles.productName}>{r.ticket_number}</div>
                <span style={{ ...styles.badge, background: '#eff6ff', color: '#1e3a8a' }}>
                  {STATUS_LABELS[r.status] || r.status}
                </span>
              </div>
              <div style={styles.detailGrid}>
                <span>Received: {formatDate(r.received_date)}</span>
                {r.completed_date && <span>Completed: {formatDate(r.completed_date)}</span>}
                <span>Customer: {r.customer_name || '—'}</span>
                {r.invoice_number && <span>Billed on: {r.invoice_number}</span>}
                {r.warranty_days ? <span>Repair warranty: {r.warranty_days} days</span> : null}
              </div>
              <div style={styles.issue}>Issue: {r.reported_issue}</div>
              {r.diagnosis && <div style={styles.issue}>Diagnosis: {r.diagnosis}</div>}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

const styles = {
  header: { marginBottom: 20 },
  title: { margin: 0, fontSize: 18, color: '#0f172a' },
  subtitle: { margin: '4px 0 0 0', color: '#64748b', fontSize: 14 },
  searchRow: { display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
  search: {
    flex: '1 1 260px',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    outline: 'none',
  },
  button: {
    padding: '10px 18px',
    borderRadius: 8,
    border: 'none',
    background: '#1e3a8a',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  error: {
    marginBottom: 12,
    padding: '10px 12px',
    borderRadius: 8,
    background: '#fef2f2',
    color: '#b91c1c',
    fontSize: 13,
  },
  empty: {
    padding: '14px 16px',
    borderRadius: 8,
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    color: '#475569',
    fontSize: 13,
  },
  section: { marginTop: 20 },
  sectionTitle: { margin: '0 0 10px 0', fontSize: 14, color: '#0f172a' },
  card: {
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
    background: '#fff',
  },
  cardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  productName: { fontSize: 14, fontWeight: 600, color: '#0f172a' },
  meta: { fontSize: 12, color: '#64748b', marginTop: 2 },
  detailGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 16,
    fontSize: 13,
    color: '#334155',
  },
  issue: { marginTop: 8, fontSize: 13, color: '#475569' },
  badge: {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  footnote: { marginTop: 4, fontSize: 12, color: '#64748b' },
}
