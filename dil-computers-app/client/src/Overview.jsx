import { useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'
import { formatPrice } from './format'

function formatDate(value) {
  return typeof value === 'string' ? value.slice(0, 10) : value
}

export default function Overview({ token, onLogout }) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    apiFetch('/api/dashboard-summary', token)
      .then((data) => {
        if (!cancelled) setSummary(data)
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
  }, [token, onLogout])

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>Overview</h2>
        <p style={styles.subtitle}>Where things stand right now.</p>
      </header>

      {error && <div style={styles.error}>{error}</div>}

      {loading ? (
        <p style={styles.muted}>Loading…</p>
      ) : summary ? (
        <>
          <div style={styles.cardsGrid}>
            <div style={styles.card}>
              <span style={styles.cardLabel}>Sales this month</span>
              <span style={styles.cardValue}>{formatPrice(summary.salesThisMonth)}</span>
              <span style={styles.cardMeta}>{summary.invoiceCountThisMonth} invoice(s)</span>
            </div>
            <div style={styles.card}>
              <span style={styles.cardLabel}>Outstanding receivables</span>
              <span style={styles.cardValue}>{formatPrice(summary.outstandingReceivables)}</span>
              <span style={styles.cardMeta}>across partial/unpaid invoices</span>
            </div>
            <div style={{ ...styles.card, ...(summary.lowStockCount > 0 ? styles.cardWarn : {}) }}>
              <span style={styles.cardLabel}>Low stock items</span>
              <span style={styles.cardValue}>{summary.lowStockCount}</span>
              <span style={styles.cardMeta}>at or below reorder threshold</span>
            </div>
            <div style={{ ...styles.card, ...(summary.openRepairTickets > 0 ? styles.cardInfo : {}) }}>
              <span style={styles.cardLabel}>Open repair tickets</span>
              <span style={styles.cardValue}>{summary.openRepairTickets}</span>
              <span style={styles.cardMeta}>not yet completed or cancelled</span>
            </div>
            <div style={styles.card}>
              <span style={styles.cardLabel}>Active AMC contracts</span>
              <span style={styles.cardValue}>{summary.activeAmcContracts}</span>
              <span style={styles.cardMeta}>
                {summary.amcContractsExpiringSoon > 0
                  ? `${summary.amcContractsExpiringSoon} expiring within 30 days`
                  : 'none expiring soon'}
              </span>
            </div>
          </div>

          <div style={styles.card2}>
            <h3 style={styles.cardTitle}>Recent invoices</h3>
            {summary.recentInvoices.length === 0 ? (
              <p style={styles.muted}>No invoices yet.</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Invoice #</th>
                    <th style={styles.th}>Date</th>
                    <th style={styles.th}>Customer</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recentInvoices.map((inv) => (
                    <tr key={inv.invoice_number}>
                      <td style={styles.td}>{inv.invoice_number}</td>
                      <td style={styles.td}>{formatDate(inv.invoice_date)}</td>
                      <td style={styles.td}>{inv.customer_name || 'Walk-in'}</td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>{formatPrice(inv.grand_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}

const styles = {
  header: { marginBottom: 20 },
  title: { margin: 0, fontSize: 18, color: '#0f172a' },
  subtitle: { margin: '4px 0 0 0', color: '#64748b', fontSize: 14 },
  muted: { margin: 0, fontSize: 13, color: '#94a3b8' },
  error: {
    marginBottom: 12,
    padding: '10px 12px',
    borderRadius: 8,
    background: '#fef2f2',
    color: '#b91c1c',
    fontSize: 13,
  },
  cardsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
    marginBottom: 20,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '14px 16px',
    borderRadius: 10,
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
  },
  cardWarn: {
    background: '#fffbeb',
    borderColor: '#fde68a',
  },
  cardInfo: {
    background: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  cardLabel: { fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 },
  cardValue: { fontSize: 22, fontWeight: 700, color: '#0f172a' },
  cardMeta: { fontSize: 12, color: '#64748b' },
  card2: {
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 16,
    background: '#fff',
  },
  cardTitle: { margin: '0 0 12px 0', fontSize: 15, color: '#0f172a' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left',
    padding: '8px 10px',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    color: '#334155',
    fontWeight: 600,
  },
  td: { padding: '8px 10px', borderBottom: '1px solid #f1f5f9', color: '#0f172a' },
}
