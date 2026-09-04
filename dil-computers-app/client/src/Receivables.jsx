import { useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'
import { formatPrice } from './format'

// Usual aging convention: not yet due, then 30-day bands past the due date.
const BUCKETS = [
  { key: 'not_due', label: 'Not yet due', color: '#166534', background: '#dcfce7' },
  { key: 'd1_30', label: '1–30 days', color: '#854d0e', background: '#fef9c3' },
  { key: 'd31_60', label: '31–60 days', color: '#92400e', background: '#fef3c7' },
  { key: 'd61_90', label: '61–90 days', color: '#9a3412', background: '#ffedd5' },
  { key: 'd90_plus', label: '90+ days', color: '#991b1b', background: '#fee2e2' },
]

function formatDate(value) {
  return typeof value === 'string' ? value.slice(0, 10) : value || '—'
}

export default function Receivables({ token, onLogout }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [bucketFilter, setBucketFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch('/api/receivables-aging', token)
      .then((d) => {
        if (!cancelled) setData(d)
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

  if (loading) return <div style={styles.muted}>Loading receivables…</div>
  if (error) return <div style={styles.error}>{error}</div>
  if (!data) return null

  const shown = bucketFilter
    ? data.invoices.filter((i) => i.bucket === bucketFilter)
    : data.invoices

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>Receivables</h2>
        <p style={styles.subtitle}>
          Every invoice still owing money, by how far past its due date it is. An invoice with no
          due date was due on receipt.
        </p>
      </header>

      <div style={styles.totals}>
        <div style={styles.totalCard}>
          <div style={styles.totalLabel}>Total outstanding</div>
          <div style={styles.totalValue}>{formatPrice(data.totalOutstanding)}</div>
        </div>
        <div style={{ ...styles.totalCard, borderColor: '#fecaca' }}>
          <div style={styles.totalLabel}>Overdue</div>
          <div style={{ ...styles.totalValue, color: '#b91c1c' }}>{formatPrice(data.totalOverdue)}</div>
        </div>
      </div>

      <div style={styles.buckets}>
        {BUCKETS.map((b) => {
          const active = bucketFilter === b.key
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => setBucketFilter(active ? '' : b.key)}
              style={{
                ...styles.bucket,
                background: b.background,
                borderColor: active ? b.color : 'transparent',
              }}
            >
              <div style={{ ...styles.bucketLabel, color: b.color }}>{b.label}</div>
              <div style={{ ...styles.bucketValue, color: b.color }}>
                {formatPrice(data.buckets[b.key] || 0)}
              </div>
            </button>
          )
        })}
      </div>
      {bucketFilter && (
        <div style={styles.filterNote}>
          Showing the “{BUCKETS.find((b) => b.key === bucketFilter)?.label}” band —{' '}
          <button type="button" style={styles.linkButton} onClick={() => setBucketFilter('')}>
            show all
          </button>
        </div>
      )}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Invoice #</th>
              <th style={styles.th}>Customer</th>
              <th style={styles.th}>Invoiced</th>
              <th style={styles.th}>Due</th>
              <th style={styles.th}>Overdue by</th>
              <th style={styles.thRight}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td style={styles.td} colSpan={6}>
                  {data.invoices.length === 0
                    ? 'Nothing outstanding — every invoice is paid in full.'
                    : 'No invoices in this band.'}
                </td>
              </tr>
            ) : (
              shown.map((i) => (
                <tr key={i.id}>
                  <td style={styles.td}>{i.invoice_number}</td>
                  <td style={styles.td}>
                    {i.customer_name || '—'}
                    {i.customer_phone && <span style={styles.phone}> · {i.customer_phone}</span>}
                  </td>
                  <td style={styles.td}>{formatDate(i.invoice_date)}</td>
                  <td style={styles.td}>
                    {i.due_date ? formatDate(i.due_date) : <span style={styles.muted}>On receipt</span>}
                  </td>
                  <td style={styles.td}>
                    {i.bucket === 'not_due'
                      ? <span style={styles.muted}>—</span>
                      : <span style={styles.overdue}>{i.days_overdue} day{Number(i.days_overdue) === 1 ? '' : 's'}</span>}
                  </td>
                  <td style={styles.tdRight}>{formatPrice(i.balance_due)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const styles = {
  header: { marginBottom: 20 },
  title: { margin: 0, fontSize: 18, color: '#0f172a' },
  subtitle: { margin: '4px 0 0 0', color: '#64748b', fontSize: 14 },
  totals: { display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' },
  totalCard: {
    flex: '1 1 180px',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: 14,
    background: '#fff',
  },
  totalLabel: { fontSize: 12, color: '#64748b', fontWeight: 600 },
  totalValue: { fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 4 },
  buckets: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 },
  bucket: {
    flex: '1 1 140px',
    border: '2px solid transparent',
    borderRadius: 10,
    padding: '10px 12px',
    cursor: 'pointer',
    textAlign: 'left',
    font: 'inherit',
  },
  bucketLabel: { fontSize: 12, fontWeight: 700 },
  bucketValue: { fontSize: 16, fontWeight: 700, marginTop: 2 },
  filterNote: { fontSize: 13, color: '#475569', marginBottom: 12 },
  linkButton: {
    border: 'none',
    background: 'none',
    padding: 0,
    color: '#1e3a8a',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    textDecoration: 'underline',
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
  thRight: {
    textAlign: 'right',
    padding: '10px 12px',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    color: '#334155',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  td: { padding: '10px 12px', borderBottom: '1px solid #f1f5f9', color: '#0f172a' },
  tdRight: {
    padding: '10px 12px',
    borderBottom: '1px solid #f1f5f9',
    color: '#0f172a',
    textAlign: 'right',
    fontWeight: 600,
  },
  phone: { color: '#64748b', fontSize: 12 },
  overdue: { color: '#b91c1c', fontWeight: 600 },
  muted: { color: '#94a3b8' },
  error: {
    padding: '10px 12px',
    borderRadius: 8,
    background: '#fef2f2',
    color: '#b91c1c',
    fontSize: 13,
  },
}
