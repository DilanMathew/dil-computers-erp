import { useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'
import { formatPrice } from './format'

// Month boundaries in local terms, formatted as the YYYY-MM-DD the API wants.
function monthRange(month) {
  const [y, m] = month.split('-').map(Number)
  const first = `${month}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: first, to: `${month}-${String(lastDay).padStart(2, '0')}` }
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function RateTable({ rows, emptyMessage }) {
  if (!rows || rows.length === 0) {
    return <p style={styles.empty}>{emptyMessage}</p>
  }
  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>GST rate</th>
          <th style={styles.thRight}>Documents</th>
          <th style={styles.thRight}>Taxable value</th>
          <th style={styles.thRight}>Tax</th>
          <th style={styles.thRight}>Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.rate}>
            <td style={styles.td}>{r.rate}%</td>
            <td style={styles.tdRight}>{r.document_count}</td>
            <td style={styles.tdRight}>{formatPrice(r.taxable_value)}</td>
            <td style={styles.tdRight}>{formatPrice(r.tax_amount)}</td>
            <td style={styles.tdRight}>{formatPrice(r.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function GstSummary({ token, onLogout }) {
  const [month, setMonth] = useState(currentMonth)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const { from, to } = monthRange(month)
    setLoading(true)
    setError('')
    apiFetch(`/api/gst-summary?from=${from}&to=${to}`, token)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof AuthError) onLogout()
        else setError(err.message)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token, month, onLogout])

  // Built here rather than server-side: it's a straight reshape of what's
  // already on screen, and keeps the download working offline.
  function downloadCsv() {
    if (!data) return
    const lines = [['Section', 'GST rate (%)', 'Documents', 'Taxable value', 'Tax', 'Total']]
    for (const r of data.sales.byRate) {
      lines.push(['Sales', r.rate, r.document_count, r.taxable_value, r.tax_amount, r.total])
    }
    for (const r of data.creditNotes.byRate) {
      lines.push(['Credit notes', r.rate, r.document_count, r.taxable_value, r.tax_amount, r.total])
    }
    for (const r of data.net) {
      lines.push(['Net', r.rate, '', r.taxableValue, r.taxAmount, r.total])
    }
    lines.push(['Net total', '', '', data.netTotals.taxableValue, data.netTotals.taxAmount, data.netTotals.total])

    const csv = lines.map((row) => row.map((c) => `"${String(c ?? '')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `GST-summary-${month}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>GST Summary</h2>
        <p style={styles.subtitle}>
          Taxable value and tax by rate slab for a month, with returns deducted — the figures
          behind a filing, without adding invoices up by hand.
        </p>
      </header>

      <div style={styles.toolbar}>
        <div>
          <label style={styles.label} htmlFor="gstMonth">Month</label>
          <input
            id="gstMonth"
            style={styles.input}
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
        <button type="button" style={styles.button} onClick={downloadCsv} disabled={!data || loading}>
          Download CSV
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}
      {loading && <div style={styles.muted}>Loading…</div>}

      {data && !loading && (
        <>
          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>Sales (outward supplies)</h3>
            <RateTable rows={data.sales.byRate} emptyMessage="No invoices in this month." />
            {data.sales.byRate.length > 0 && (
              <div style={styles.totalLine}>
                {data.sales.totals.documentCount} invoice{data.sales.totals.documentCount === 1 ? '' : 's'} · taxable{' '}
                {formatPrice(data.sales.totals.taxableValue)} · tax{' '}
                <strong>{formatPrice(data.sales.totals.taxAmount)}</strong>
              </div>
            )}
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>Credit notes (returns)</h3>
            <RateTable rows={data.creditNotes.byRate} emptyMessage="No credit notes in this month." />
            {data.creditNotes.byRate.length > 0 && (
              <div style={styles.totalLine}>
                {data.creditNotes.totals.documentCount} credit note{data.creditNotes.totals.documentCount === 1 ? '' : 's'} · taxable{' '}
                {formatPrice(data.creditNotes.totals.taxableValue)} · tax{' '}
                <strong>{formatPrice(data.creditNotes.totals.taxAmount)}</strong>
              </div>
            )}
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>Net (sales less returns)</h3>
            {data.net.length === 0 ? (
              <p style={styles.empty}>Nothing in this month.</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>GST rate</th>
                    <th style={styles.thRight}>Taxable value</th>
                    <th style={styles.thRight}>Tax</th>
                    <th style={styles.thRight}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.net.map((r) => (
                    <tr key={r.rate}>
                      <td style={styles.td}>{r.rate}%</td>
                      <td style={styles.tdRight}>{formatPrice(r.taxableValue)}</td>
                      <td style={styles.tdRight}>{formatPrice(r.taxAmount)}</td>
                      <td style={styles.tdRight}>{formatPrice(r.total)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={styles.tdTotal}>Total</td>
                    <td style={styles.tdRightTotal}>{formatPrice(data.netTotals.taxableValue)}</td>
                    <td style={styles.tdRightTotal}>{formatPrice(data.netTotals.taxAmount)}</td>
                    <td style={styles.tdRightTotal}>{formatPrice(data.netTotals.total)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </section>

          <div style={styles.note}>
            <strong>Sales side only.</strong> Purchase orders don't record GST — only a total — so
            input tax credit can't be calculated from what's stored and is left out entirely rather
            than shown as zero. Credit notes carry no date of their own, so they're counted in the
            month they were recorded. Check these figures against your own records before filing.
          </div>
        </>
      )}
    </div>
  )
}

const styles = {
  header: { marginBottom: 20 },
  title: { margin: 0, fontSize: 18, color: '#0f172a' },
  subtitle: { margin: '4px 0 0 0', color: '#64748b', fontSize: 14 },
  toolbar: { display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 },
  input: {
    padding: '9px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    outline: 'none',
    background: '#fff',
  },
  button: {
    padding: '10px 16px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    background: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  section: { marginBottom: 22 },
  sectionTitle: { margin: '0 0 8px 0', fontSize: 14, color: '#0f172a' },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 14,
    border: '1px solid #e2e8f0',
    borderRadius: 8,
  },
  th: {
    textAlign: 'left',
    padding: '9px 12px',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    color: '#334155',
    fontWeight: 600,
  },
  thRight: {
    textAlign: 'right',
    padding: '9px 12px',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    color: '#334155',
    fontWeight: 600,
  },
  td: { padding: '9px 12px', borderBottom: '1px solid #f1f5f9', color: '#0f172a' },
  tdRight: { padding: '9px 12px', borderBottom: '1px solid #f1f5f9', color: '#0f172a', textAlign: 'right' },
  tdTotal: { padding: '9px 12px', color: '#0f172a', fontWeight: 700, borderTop: '2px solid #e2e8f0' },
  tdRightTotal: {
    padding: '9px 12px',
    color: '#0f172a',
    textAlign: 'right',
    fontWeight: 700,
    borderTop: '2px solid #e2e8f0',
  },
  totalLine: { marginTop: 8, fontSize: 13, color: '#475569' },
  empty: { fontSize: 13, color: '#64748b', margin: 0 },
  muted: { fontSize: 13, color: '#64748b' },
  note: {
    marginTop: 8,
    padding: '12px 14px',
    borderRadius: 8,
    background: '#fffbeb',
    border: '1px solid #fde68a',
    color: '#78350f',
    fontSize: 12.5,
    lineHeight: 1.6,
  },
  error: {
    marginBottom: 12,
    padding: '10px 12px',
    borderRadius: 8,
    background: '#fef2f2',
    color: '#b91c1c',
    fontSize: 13,
  },
}
