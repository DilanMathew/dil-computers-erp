import { useState } from 'react'
import Catalogue from './Catalogue'
import CreateQuotation from './CreateQuotation'
import CreateInvoice from './CreateInvoice'
import Invoices from './Invoices'

const TABS = [
  { id: 'quotation', label: 'Create Quotation' },
  { id: 'invoice', label: 'Create Invoice' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'catalogue', label: 'Product Catalogue' },
]

export default function Dashboard({ token, onLogout }) {
  const [tab, setTab] = useState('quotation')

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <header style={styles.header}>
          <div>
            <h1 style={styles.title}>DIL Computers</h1>
            <nav style={styles.nav}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  style={{
                    ...styles.tabButton,
                    ...(tab === t.id ? styles.tabButtonActive : {}),
                  }}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
          <button style={styles.logoutButton} onClick={onLogout}>
            Log out
          </button>
        </header>

        <main>
          {tab === 'quotation' && <CreateQuotation token={token} onLogout={onLogout} />}
          {tab === 'invoice' && <CreateInvoice token={token} onLogout={onLogout} />}
          {tab === 'invoices' && <Invoices token={token} onLogout={onLogout} />}
          {tab === 'catalogue' && <Catalogue token={token} onLogout={onLogout} />}
        </main>
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#f1f5f9',
    padding: '32px 16px',
  },
  shell: {
    maxWidth: 1000,
    margin: '0 auto',
    background: '#fff',
    borderRadius: 12,
    boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
    padding: 24,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
    flexWrap: 'wrap',
    gap: 12,
  },
  title: {
    margin: '0 0 12px 0',
    fontSize: 22,
    color: '#0f172a',
  },
  nav: {
    display: 'flex',
    gap: 8,
  },
  tabButton: {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    background: '#fff',
    color: '#334155',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  tabButtonActive: {
    background: '#1e3a8a',
    borderColor: '#1e3a8a',
    color: '#fff',
  },
  logoutButton: {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    background: '#fff',
    color: '#334155',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
}
