import { Fragment, useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'
import { formatPrice } from './format'
import { buildDocumentPdf } from './documentPdf'
import useCompanyInfo from './useCompanyInfo'

const PAGE_SIZE = 20

const SORT_OPTIONS = [
  { value: 'spend', label: 'Total spent' },
  { value: 'frequency', label: 'Frequency (# invoices)' },
  { value: 'recency', label: 'Recency (least recent first)' },
  { value: 'risk', label: 'Risk (overdue first)' },
]

const BADGE_COLORS = {
  good: { background: '#dcfce7', color: '#166534', label: 'Good' },
  watch: { background: '#fef9c3', color: '#854d0e', label: 'Watch' },
  risk: { background: '#fee2e2', color: '#991b1b', label: 'Risk' },
}

function formatDate(value) {
  return typeof value === 'string' ? value.slice(0, 10) : value
}

function HealthBadge({ badge }) {
  const c = BADGE_COLORS[badge] || BADGE_COLORS.good
  return <span style={{ ...styles.badge, background: c.background, color: c.color }}>{c.label}</span>
}

function CustomerInsightDetail({ token, onLogout, customerId, onSaved }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [riskTag, setRiskTag] = useState('')
  const [savingTag, setSavingTag] = useState(false)
  const companyInfo = useCompanyInfo()

  function load() {
    setLoading(true)
    apiFetch(`/api/customer-insights/${customerId}`, token)
      .then((data) => {
        setDetail(data)
        setRiskTag(data.customer.risk_tag || '')
      })
      .catch((err) => {
        if (err instanceof AuthError) onLogout()
        else setError(err.message)
      })
      .finally(() => setLoading(false))
  }

  useEffect(load, [token, customerId])

  async function handleSaveTag() {
    setSavingTag(true)
    setError('')
    try {
      await apiFetch(`/api/customer-insights/${customerId}/tag`, token, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riskTag }),
      })
      load()
      onSaved?.()
    } catch (err) {
      if (err instanceof AuthError) onLogout()
      else setError(err.message || 'Could not save tag.')
    } finally {
      setSavingTag(false)
    }
  }

  function downloadInvoicePdf(inv) {
    buildDocumentPdf({
      docLabel: 'Invoice',
      filePrefix: 'Invoice',
      number: inv.invoice_number,
      date: formatDate(inv.invoice_date),
      fields: [
        ['Customer', inv.customer_name],
        ['Phone', inv.customer_phone],
        ['Address', inv.customer_address],
        ['Payment Method', inv.payment_method],
        ['Quotation Ref', inv.quotation_number],
        ['Repair Ticket Ref', inv.ticket_number],
      ],
      items: inv.items || [],
      companyInfo,
      subtotal: inv.subtotal,
      gstRate: Number(inv.gst_rate) || 0,
      gstAmount: inv.gst_amount,
      grandTotal: inv.grand_total,
    })
  }

  if (loading) return <div style={styles.detailCell}>Loading…</div>
  if (!detail) return <div style={styles.detailCell}>{error || 'Could not load customer.'}</div>

  const { customer, invoices, productAffinity } = detail

  return (
    <div style={styles.detailCell}>
      <div style={styles.profileGrid}>
        <div style={styles.profileStat}>
          <span style={styles.profileLabel}>Customer since</span>
          <span style={styles.profileValue}>{customer.first_purchase_date ? formatDate(customer.first_purchase_date) : '—'}</span>
        </div>
        <div style={styles.profileStat}>
          <span style={styles.profileLabel}>Avg days between purchases</span>
          <span style={styles.profileValue}>
            {customer.avg_days_between_purchases != null ? `${Number(customer.avg_days_between_purchases).toFixed(0)} days` : '—'}
          </span>
        </div>
        <div style={styles.profileStat}>
          <span style={styles.profileLabel}>Avg days to pay in full</span>
          <span style={styles.profileValue}>
            {customer.avg_days_to_pay != null ? `${Number(customer.avg_days_to_pay).toFixed(0)} days` : '—'}
          </span>
        </div>
        <div style={styles.profileStat}>
          <span style={styles.profileLabel}>Late payments</span>
          <span style={styles.profileValue}>{customer.late_payment_count}</span>
        </div>
        <div style={styles.profileStat}>
          <span style={styles.profileLabel}>Returned (credit notes)</span>
          <span style={styles.profileValue}>{formatPrice(customer.return_value)}</span>
        </div>
        <div style={styles.profileStat}>
          <span style={styles.profileLabel}>Repair tickets</span>
          <span style={styles.profileValue}>{customer.repair_ticket_count}</span>
        </div>
        <div style={styles.profileStat}>
          <span style={styles.profileLabel}>Active AMC contracts</span>
          <span style={styles.profileValue}>
            {customer.active_amc_count}
            {customer.amc_expiring_soon_count > 0 && (
              <span style={styles.expiringNote}> ({customer.amc_expiring_soon_count} expiring soon)</span>
            )}
          </span>
        </div>
        {customer.notes && (
          <div style={{ ...styles.profileStat, gridColumn: '1 / -1' }}>
            <span style={styles.profileLabel}>Notes</span>
            <span style={styles.profileValue}>{customer.notes}</span>
          </div>
        )}
      </div>

      <div style={styles.tagRow}>
        <label style={styles.fieldLabel}>Manual tag (e.g. VIP, Watch, Do not extend credit)</label>
        <div style={styles.tagInputRow}>
          <input
            style={styles.tagInput}
            value={riskTag}
            placeholder="No tag set"
            onChange={(e) => setRiskTag(e.target.value)}
          />
          <button type="button" style={styles.smallButton} onClick={handleSaveTag} disabled={savingTag}>
            {savingTag ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {productAffinity.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <h4 style={styles.sectionTitle}>Most purchased</h4>
          <div style={styles.affinityList}>
            {productAffinity.map((p, idx) => (
              <span key={idx} style={styles.affinityChip}>
                {p.product_name} × {p.total_qty} ({p.times_bought} order{p.times_bought === '1' ? '' : 's'})
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 style={styles.sectionTitle}>Invoice history ({invoices.length})</h4>
        {invoices.length === 0 ? (
          <p style={styles.muted}>No invoices yet.</p>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.innerTable}>
              <thead>
                <tr>
                  <th style={styles.innerTh}>Invoice #</th>
                  <th style={styles.innerTh}>Date</th>
                  <th style={{ ...styles.innerTh, textAlign: 'right' }}>Total</th>
                  <th style={{ ...styles.innerTh, textAlign: 'right' }}>Balance due</th>
                  <th style={styles.innerTh}></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td style={styles.innerTd}>{inv.invoice_number}</td>
                    <td style={styles.innerTd}>{formatDate(inv.invoice_date)}</td>
                    <td style={{ ...styles.innerTd, textAlign: 'right' }}>{formatPrice(inv.grand_total)}</td>
                    <td style={{ ...styles.innerTd, textAlign: 'right' }}>
                      {Number(inv.balance_due) > 0.01 ? formatPrice(inv.balance_due) : '—'}
                    </td>
                    <td style={styles.innerTd}>
                      <button type="button" style={styles.smallButtonSecondary} onClick={() => downloadInvoicePdf(inv)}>
                        Download PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default function CustomerInsights({ token, onLogout }) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sort, setSort] = useState('spend')
  const [followupOnly, setFollowupOnly] = useState(false)
  const [page, setPage] = useState(1)

  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(id)
  }, [search])

  useEffect(() => setPage(1), [debouncedSearch, sort, followupOnly])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sort })
    if (debouncedSearch) params.set('q', debouncedSearch)
    if (followupOnly) params.set('view', 'followup')

    apiFetch(`/api/customer-insights?${params.toString()}`, token)
      .then((data) => {
        if (cancelled) return
        setItems(data.items)
        setTotal(data.total)
        setTotalPages(data.totalPages)
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
  }, [token, debouncedSearch, sort, followupOnly, page, onLogout, refreshKey])

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>Customer Insights</h2>
        <p style={styles.subtitle}>{total.toLocaleString()} recurring customer(s) — ranked, scored, and flagged for follow-up.</p>
      </header>

      <div style={styles.toolbar}>
        <input
          style={styles.search}
          type="text"
          placeholder="Search by name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select style={styles.select} value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <label style={styles.checkboxRow}>
          <input type="checkbox" checked={followupOnly} onChange={(e) => setFollowupOnly(e.target.checked)} />
          Follow-ups only
        </label>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Customer</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Total spent</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Invoices</th>
              <th style={styles.th}>Last purchase</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Outstanding</th>
              <th style={styles.th}>Health</th>
              <th style={styles.th}>Tag</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td style={styles.td} colSpan={7}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td style={styles.td} colSpan={7}>No customers match your filters.</td></tr>
            ) : (
              items.map((c) => (
                <Fragment key={c.id}>
                  <tr style={styles.row} onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}>
                    <td style={styles.td}>{c.name}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{formatPrice(c.total_spent)}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{c.invoice_count}</td>
                    <td style={styles.td}>{c.last_purchase_date ? formatDate(c.last_purchase_date) : '—'}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>
                      {Number(c.outstanding_balance) > 0.01 ? formatPrice(c.outstanding_balance) : '—'}
                    </td>
                    <td style={styles.td}><HealthBadge badge={c.healthBadge} /></td>
                    <td style={styles.td}>{c.risk_tag || '—'}</td>
                  </tr>
                  {expandedId === c.id && (
                    <tr>
                      <td colSpan={7} style={{ padding: 0 }}>
                        <CustomerInsightDetail
                          token={token}
                          onLogout={onLogout}
                          customerId={c.id}
                          onSaved={() => setRefreshKey((k) => k + 1)}
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

      <div style={styles.pagination}>
        <button style={styles.pageButton} onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={page <= 1}>
          Previous
        </button>
        <span style={styles.pageLabel}>Page {page} of {totalPages}</span>
        <button style={styles.pageButton} onClick={() => setPage((p) => Math.min(p + 1, totalPages))} disabled={page >= totalPages}>
          Next
        </button>
      </div>
    </div>
  )
}

const styles = {
  header: { marginBottom: 20 },
  title: { margin: 0, fontSize: 18, color: '#0f172a' },
  subtitle: { margin: '4px 0 0 0', color: '#64748b', fontSize: 14 },
  toolbar: { display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' },
  search: {
    flex: '1 1 220px',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    outline: 'none',
  },
  select: {
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    minWidth: 200,
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    fontWeight: 600,
    color: '#334155',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  error: {
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
  badge: {
    display: 'inline-block',
    padding: '2px 9px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
  },
  detailCell: {
    padding: '16px 18px',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
  },
  profileGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
    marginBottom: 16,
  },
  profileStat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    padding: '10px 12px',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
  },
  profileLabel: { fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.3 },
  profileValue: { fontSize: 14, fontWeight: 700, color: '#0f172a' },
  expiringNote: { fontSize: 11, fontWeight: 600, color: '#b45309' },
  tagRow: { marginBottom: 16 },
  fieldLabel: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#334155',
    marginBottom: 6,
  },
  tagInputRow: { display: 'flex', gap: 8, maxWidth: 420 },
  tagInput: {
    flex: 1,
    padding: '8px 10px',
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    fontSize: 13,
    background: '#fff',
  },
  sectionTitle: { margin: '0 0 8px 0', fontSize: 13, color: '#0f172a' },
  muted: { margin: 0, fontSize: 12, color: '#94a3b8' },
  affinityList: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  affinityChip: {
    padding: '4px 10px',
    borderRadius: 999,
    background: '#eff6ff',
    color: '#1e3a8a',
    fontSize: 12,
    fontWeight: 600,
  },
  innerTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
  },
  innerTh: {
    textAlign: 'left',
    padding: '6px 10px',
    background: '#f1f5f9',
    borderBottom: '1px solid #e2e8f0',
    color: '#334155',
    fontWeight: 600,
  },
  innerTd: { padding: '6px 10px', borderBottom: '1px solid #f1f5f9', color: '#0f172a' },
  smallButton: {
    padding: '8px 14px',
    borderRadius: 6,
    border: 'none',
    background: '#1e3a8a',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  smallButtonSecondary: {
    padding: '5px 10px',
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    background: '#fff',
    color: '#334155',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 16 },
  pageButton: {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    background: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  pageLabel: { fontSize: 13, color: '#475569' },
}
