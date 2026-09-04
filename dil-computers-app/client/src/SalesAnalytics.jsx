import { useEffect, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList,
} from 'recharts'
import { apiFetch, AuthError } from './api'
import { formatPrice } from './format'

// One accent hue throughout — every chart here answers the same question
// ("how much"), which is a magnitude job, not an identity one. A fixed
// categorical palette would assign meaningless color identity where the
// axis labels already do the distinguishing work. Validated sequential
// blue ramp (dataviz skill's reference palette).
const BLUE = '#2a78d6'
const BLUE_LIGHT = '#9ec5f4'
const GRID = '#e8ebf0'
const TEXT_MUTED = '#64748b'

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function compactNumber(n) {
  const abs = Math.abs(n)
  if (abs >= 10000000) return `${(n / 10000000).toFixed(1)}Cr`
  if (abs >= 100000) return `${(n / 100000).toFixed(1)}L`
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(Math.round(n))
}

function formatDayLabel(dateStr) {
  const d = new Date(dateStr)
  return String(d.getUTCDate())
}

function formatFullDate(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function formatMonthLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
}

function ChartTooltip({ active, payload, label, formatLabel }) {
  if (!active || !payload || payload.length === 0) return null
  const value = payload[0].value
  return (
    <div style={styles.tooltip}>
      <div style={styles.tooltipLabel}>{formatLabel ? formatLabel(label) : label}</div>
      <div style={styles.tooltipValue}>{formatPrice(value)}</div>
    </div>
  )
}

function StatTile({ label, value, sub }) {
  return (
    <div style={styles.statTile}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
      {sub && <div style={styles.statSub}>{sub}</div>}
    </div>
  )
}

function ChartCard({ title, subtitle, empty, children, height = 260 }) {
  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>{title}</h3>
      {subtitle && <p style={styles.cardSubtitle}>{subtitle}</p>}
      {empty ? (
        <div style={{ ...styles.empty, height }}>{empty}</div>
      ) : (
        <div style={{ width: '100%', height }}>{children}</div>
      )}
    </div>
  )
}

export default function SalesAnalytics({ token, onLogout }) {
  const [month, setMonth] = useState(currentMonth)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    apiFetch(`/api/sales-analytics?month=${month}`, token)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof AuthError) onLogout()
        else setError(err.message)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token, month, onLogout])

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>Sales Analytics</h2>
        <p style={styles.subtitle}>Revenue trends for the month, at a glance.</p>
      </header>

      <div style={styles.toolbar}>
        <label style={styles.label} htmlFor="analyticsMonth">Month</label>
        <input
          id="analyticsMonth"
          style={styles.monthInput}
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </div>

      {error && <div style={styles.error}>{error}</div>}
      {loading && <div style={styles.muted}>Loading…</div>}

      {data && !loading && (
        <>
          <div style={styles.statsRow}>
            <StatTile label="Revenue" value={formatPrice(data.totals.revenue)} />
            <StatTile label="Invoices" value={data.totals.invoiceCount.toLocaleString()} />
            <StatTile label="Average invoice" value={formatPrice(data.totals.avgInvoice)} />
          </div>

          <div style={styles.grid}>
            <ChartCard
              title="Daily revenue"
              subtitle={formatMonthLabel(month)}
              empty={data.dailyTrend.length === 0 ? 'No invoices this month.' : null}
            >
              <ResponsiveContainer>
                <BarChart data={data.dailyTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDayLabel}
                    tick={{ fontSize: 11, fill: TEXT_MUTED }}
                    axisLine={{ stroke: GRID }}
                    tickLine={false}
                    interval={Math.max(0, Math.floor(data.dailyTrend.length / 10))}
                  />
                  <YAxis
                    tickFormatter={compactNumber}
                    tick={{ fontSize: 11, fill: TEXT_MUTED }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip
                    content={<ChartTooltip formatLabel={formatFullDate} />}
                    cursor={{ fill: 'rgba(42,120,214,0.06)' }}
                  />
                  <Bar dataKey="total" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Last 6 months"
              subtitle="Total revenue by month"
              empty={data.monthlyTrend.every((m) => m.total === 0) ? 'No invoices in this range.' : null}
            >
              <ResponsiveContainer>
                <BarChart data={data.monthlyTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickFormatter={formatMonthLabel}
                    tick={{ fontSize: 11, fill: TEXT_MUTED }}
                    axisLine={{ stroke: GRID }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={compactNumber}
                    tick={{ fontSize: 11, fill: TEXT_MUTED }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip content={<ChartTooltip formatLabel={formatMonthLabel} />} cursor={{ fill: 'rgba(42,120,214,0.06)' }} />
                  <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={36}>
                    {data.monthlyTrend.map((m) => (
                      <Cell key={m.month} fill={m.month === month ? BLUE : BLUE_LIGHT} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Revenue by category"
              subtitle={formatMonthLabel(month)}
              empty={data.byCategory.length === 0 ? 'No invoices this month.' : null}
              height={Math.max(140, data.byCategory.length * 42 + 40)}
            >
              <ResponsiveContainer>
                <BarChart
                  data={data.byCategory}
                  layout="vertical"
                  margin={{ top: 4, right: 44, left: 8, bottom: 4 }}
                >
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="category"
                    type="category"
                    tick={{ fontSize: 12, fill: '#0f172a' }}
                    axisLine={false}
                    tickLine={false}
                    width={90}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(42,120,214,0.06)' }} />
                  <Bar dataKey="total" fill={BLUE} radius={[0, 4, 4, 0]} maxBarSize={24}>
                    <LabelList
                      dataKey="total"
                      position="right"
                      formatter={(v) => compactNumber(v)}
                      style={{ fill: '#0f172a', fontSize: 12, fontWeight: 600 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Top customers"
              subtitle={formatMonthLabel(month)}
              empty={data.topCustomers.length === 0 ? 'No invoices this month.' : null}
              height={Math.max(140, data.topCustomers.length * 32 + 40)}
            >
              <ResponsiveContainer>
                <BarChart
                  data={data.topCustomers}
                  layout="vertical"
                  margin={{ top: 4, right: 44, left: 8, bottom: 4 }}
                >
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tick={{ fontSize: 11.5, fill: '#0f172a' }}
                    axisLine={false}
                    tickLine={false}
                    width={140}
                    tickFormatter={(v) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(42,120,214,0.06)' }} />
                  <Bar dataKey="total" fill={BLUE} radius={[0, 4, 4, 0]} maxBarSize={18}>
                    <LabelList
                      dataKey="total"
                      position="right"
                      formatter={(v) => compactNumber(v)}
                      style={{ fill: '#0f172a', fontSize: 11.5, fontWeight: 600 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
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
  toolbar: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 },
  label: { fontSize: 13, fontWeight: 600, color: '#334155' },
  monthInput: {
    padding: '9px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    outline: 'none',
    background: '#fff',
  },
  statsRow: { display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' },
  statTile: {
    flex: '1 1 160px',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: '14px 16px',
    background: '#fff',
  },
  statLabel: { fontSize: 12, color: '#64748b', fontWeight: 600 },
  statValue: { fontSize: 22, fontWeight: 700, color: '#0f172a', marginTop: 4 },
  statSub: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
    gap: 16,
  },
  card: {
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: 16,
    background: '#fff',
  },
  cardTitle: { margin: 0, fontSize: 14, fontWeight: 700, color: '#0f172a' },
  cardSubtitle: { margin: '2px 0 12px 0', fontSize: 12, color: '#94a3b8' },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#94a3b8',
    fontSize: 13,
  },
  tooltip: {
    background: '#0f172a',
    color: '#fff',
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 12.5,
    boxShadow: '0 8px 20px rgba(15,23,42,0.25)',
  },
  tooltipLabel: { color: '#cbd5e1', marginBottom: 2 },
  tooltipValue: { fontWeight: 700 },
  muted: { fontSize: 13, color: '#64748b' },
  error: {
    marginBottom: 12,
    padding: '10px 12px',
    borderRadius: 8,
    background: '#fef2f2',
    color: '#b91c1c',
    fontSize: 13,
  },
}
