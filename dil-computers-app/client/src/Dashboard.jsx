import { useState } from 'react'
import Catalogue from './Catalogue'
import CreateQuotation from './CreateQuotation'
import Quotations from './Quotations'
import CreateInvoice from './CreateInvoice'
import Invoices from './Invoices'
import Users from './Users'
import AuditLog from './AuditLog'
import Customers from './Customers'
import CreatePurchaseOrder from './CreatePurchaseOrder'
import PurchaseOrders from './PurchaseOrders'
import Suppliers from './Suppliers'
import LowStock from './LowStock'
import CreateRepairTicket from './CreateRepairTicket'
import RepairTickets from './RepairTickets'
import CreateAmcContract from './CreateAmcContract'
import AmcContracts from './AmcContracts'

// Which roles see each tab. 'sales' can create and view sales/purchasing
// documents; 'accountant' can view them but not create (read-only);
// 'admin' sees everything plus user management and the audit log.
const TABS = [
  { id: 'quotation', label: 'Create Quotation', roles: ['admin', 'sales'], Component: CreateQuotation },
  { id: 'quotations', label: 'Quotations', roles: ['admin', 'sales', 'accountant'], Component: Quotations },
  { id: 'invoice', label: 'Create Invoice', roles: ['admin', 'sales'], Component: CreateInvoice },
  { id: 'invoices', label: 'Invoices', roles: ['admin', 'sales', 'accountant'], Component: Invoices },
  { id: 'customers', label: 'Customers', roles: ['admin', 'sales', 'accountant'], Component: Customers },
  { id: 'purchaseOrder', label: 'Create Purchase Order', roles: ['admin', 'sales'], Component: CreatePurchaseOrder },
  { id: 'purchaseOrders', label: 'Purchase Orders', roles: ['admin', 'sales', 'accountant'], Component: PurchaseOrders },
  { id: 'suppliers', label: 'Suppliers', roles: ['admin', 'sales', 'accountant'], Component: Suppliers },
  { id: 'lowStock', label: 'Low Stock', roles: ['admin', 'sales', 'accountant'], Component: LowStock },
  { id: 'catalogue', label: 'Product Catalogue', roles: ['admin', 'sales', 'accountant'], Component: Catalogue },
  { id: 'repairTicket', label: 'Create Repair Ticket', roles: ['admin', 'sales'], Component: CreateRepairTicket },
  { id: 'repairTickets', label: 'Repair Tickets', roles: ['admin', 'sales', 'accountant'], Component: RepairTickets },
  { id: 'amcContract', label: 'Create AMC Contract', roles: ['admin', 'sales'], Component: CreateAmcContract },
  { id: 'amcContracts', label: 'AMC Contracts', roles: ['admin', 'sales', 'accountant'], Component: AmcContracts },
  { id: 'users', label: 'Users', roles: ['admin'], Component: Users },
  { id: 'audit', label: 'Audit Log', roles: ['admin'], Component: AuditLog },
]

export default function Dashboard({ token, user, onLogout }) {
  const visibleTabs = TABS.filter((t) => t.roles.includes(user.role))
  const [tab, setTab] = useState(visibleTabs[0]?.id)

  const active = visibleTabs.find((t) => t.id === tab) || visibleTabs[0]
  const ActiveComponent = active?.Component

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <header style={styles.header}>
          <div>
            <h1 style={styles.title}>DIL Computers</h1>
            <nav style={styles.nav}>
              {visibleTabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  style={{
                    ...styles.tabButton,
                    ...(active?.id === t.id ? styles.tabButtonActive : {}),
                  }}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
          <div style={styles.headerRight}>
            <span style={styles.whoami}>
              {user.fullName || user.username} <span style={styles.roleBadge}>{user.role}</span>
            </span>
            <button style={styles.logoutButton} onClick={onLogout}>
              Log out
            </button>
          </div>
        </header>

        <main>
          {ActiveComponent && <ActiveComponent token={token} user={user} onLogout={onLogout} />}
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
    flexWrap: 'wrap',
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
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  whoami: {
    fontSize: 13,
    color: '#334155',
    fontWeight: 600,
  },
  roleBadge: {
    marginLeft: 6,
    padding: '2px 8px',
    borderRadius: 999,
    background: '#eff6ff',
    color: '#1e3a8a',
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
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
