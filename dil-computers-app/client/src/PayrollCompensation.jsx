import { Fragment, useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'
import { formatPrice } from './format'
import { todayIso } from './documentPdf'
import CustomerPicker from './CustomerPicker'

const PAGE_SIZE = 20

function formatDate(value) {
  return typeof value === 'string' ? value.slice(0, 10) : value
}

export default function PayrollCompensation({ token, user, onLogout }) {
  const canCreate = user.role === 'admin'

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [showForm, setShowForm] = useState(false)
  const [staffName, setStaffName] = useState('')
  const [staffId, setStaffId] = useState(null)
  const [payPeriod, setPayPeriod] = useState('')
  const [paymentDate, setPaymentDate] = useState(todayIso)
  const [salaryAmount, setSalaryAmount] = useState('')
  const [bonusAmount, setBonusAmount] = useState('')
  const [reimbursementAmount, setReimbursementAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [formError, setFormError] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(id)
  }, [search])

  useEffect(() => setPage(1), [debouncedSearch])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (debouncedSearch) params.set('q', debouncedSearch)

    apiFetch(`/api/payroll?${params.toString()}`, token)
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
  }, [token, debouncedSearch, page, onLogout, refreshKey])

  const totalPaid = items.reduce((sum, p) => sum + Number(p.total_amount), 0)

  async function handleCreate(e) {
    e.preventDefault()
    setFormError('')
    if (!staffId) {
      setFormError('Pick a staff member from the suggestions list.')
      return
    }
    if (!payPeriod.trim()) {
      setFormError('Pay period is required (e.g. "2026-09").')
      return
    }
    const salary = salaryAmount === '' ? 0 : Number(salaryAmount)
    const bonus = bonusAmount === '' ? 0 : Number(bonusAmount)
    const reimbursement = reimbursementAmount === '' ? 0 : Number(reimbursementAmount)
    if ([salary, bonus, reimbursement].some((n) => !Number.isFinite(n) || n < 0)) {
      setFormError('Enter valid non-negative amounts.')
      return
    }
    if (salary === 0 && bonus === 0 && reimbursement === 0) {
      setFormError('Enter at least one non-zero amount.')
      return
    }

    setCreating(true)
    try {
      await apiFetch('/api/payroll', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffId,
          payPeriod: payPeriod.trim(),
          paymentDate,
          salaryAmount: salary,
          bonusAmount: bonus,
          reimbursementAmount: reimbursement,
          notes,
        }),
      })
      setStaffName('')
      setStaffId(null)
      setPayPeriod('')
      setPaymentDate(todayIso())
      setSalaryAmount('')
      setBonusAmount('')
      setReimbursementAmount('')
      setNotes('')
      setShowForm(false)
      setRefreshKey((k) => k + 1)
    } catch (err) {
      if (err instanceof AuthError) onLogout()
      else setFormError(err.message || 'Could not save the payroll record.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>Payroll & Compensation</h2>
        <p style={styles.subtitle}>
          {total.toLocaleString()} record(s)
          {page === 1 && items.length > 0 ? ` · ${formatPrice(totalPaid)} shown on this page` : ''}
        </p>
      </header>

      <div style={styles.toolbar}>
        <input
          style={styles.search}
          type="text"
          placeholder="Search by staff name or pay period…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {canCreate && (
          <button type="button" style={styles.addButton} onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Cancel' : '+ Record a payment'}
          </button>
        )}
      </div>

      {showForm && canCreate && (
        <form style={styles.card} onSubmit={handleCreate}>
          <div style={styles.formGrid}>
            <CustomerPicker
              token={token}
              onLogout={onLogout}
              id="payrollStaff"
              label="Staff member"
              required
              endpoint="/api/staff"
              placeholder="Search staff by name…"
              emptyMessage="No matching staff — add them from Staff Monitoring first."
              value={staffName}
              onInputChange={(text) => {
                setStaffName(text)
                setStaffId(null)
              }}
              onSelect={(staff) => {
                setStaffName(staff.name)
                setStaffId(staff.id)
              }}
            />
            <div>
              <label style={styles.fieldLabel}>Pay period</label>
              <input style={styles.input} placeholder="e.g. 2026-09" value={payPeriod} onChange={(e) => setPayPeriod(e.target.value)} />
            </div>
            <div>
              <label style={styles.fieldLabel}>Payment date</label>
              <input style={styles.input} type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </div>
            <div>
              <label style={styles.fieldLabel}>Salary amount</label>
              <input style={styles.input} type="number" min="0" step="0.01" placeholder="0" value={salaryAmount} onChange={(e) => setSalaryAmount(e.target.value)} />
            </div>
            <div>
              <label style={styles.fieldLabel}>Bonus amount</label>
              <input style={styles.input} type="number" min="0" step="0.01" placeholder="0" value={bonusAmount} onChange={(e) => setBonusAmount(e.target.value)} />
            </div>
            <div>
              <label style={styles.fieldLabel}>Reimbursement amount</label>
              <input style={styles.input} type="number" min="0" step="0.01" placeholder="0" value={reimbursementAmount} onChange={(e) => setReimbursementAmount(e.target.value)} />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={styles.fieldLabel}>Notes (optional)</label>
            <input style={styles.input} placeholder="e.g. Diwali bonus, travel reimbursement…" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {formError && <div style={styles.error}>{formError}</div>}
          <button type="submit" style={{ ...styles.addButton, marginTop: 12 }} disabled={creating}>
            {creating ? 'Saving…' : 'Save payroll record'}
          </button>
        </form>
      )}

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Staff</th>
              <th style={styles.th}>Pay period</th>
              <th style={styles.th}>Date</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Total paid</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td style={styles.td} colSpan={4}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td style={styles.td} colSpan={4}>No payroll records match your search.</td></tr>
            ) : (
              items.map((p) => (
                <Fragment key={p.id}>
                  <tr style={styles.row} onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                    <td style={styles.td}>{p.staff_name || '—'}</td>
                    <td style={styles.td}>{p.pay_period}</td>
                    <td style={styles.td}>{formatDate(p.payment_date)}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{formatPrice(p.total_amount)}</td>
                  </tr>
                  {expandedId === p.id && (
                    <tr>
                      <td style={styles.detailCell} colSpan={4}>
                        <div style={styles.breakdown}>
                          <span>Salary: {formatPrice(p.salary_amount)}</span>
                          <span>Bonus: {formatPrice(p.bonus_amount)}</span>
                          <span>Reimbursement: {formatPrice(p.reimbursement_amount)}</span>
                        </div>
                        {p.notes && <div style={styles.metaLine}>Notes: {p.notes}</div>}
                        <div style={styles.metaLine}>Recorded by: {p.created_by_username || '—'}</div>
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
  toolbar: { display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' },
  search: {
    flex: '1 1 240px',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    outline: 'none',
  },
  addButton: {
    padding: '10px 16px',
    borderRadius: 8,
    border: 'none',
    background: '#334155',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  card: {
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    background: '#f8fafc',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
  },
  fieldLabel: {
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
  error: {
    marginTop: 12,
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
  detailCell: { padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
  breakdown: {
    display: 'flex',
    gap: 20,
    fontSize: 13,
    color: '#334155',
    fontWeight: 600,
    marginBottom: 6,
  },
  metaLine: { fontSize: 12, color: '#64748b', marginTop: 2 },
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
