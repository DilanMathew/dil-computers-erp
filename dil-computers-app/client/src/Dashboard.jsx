import { useState } from 'react'
import Overview from './Overview'
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
import CreateCreditNote from './CreateCreditNote'
import CreditNotes from './CreditNotes'
import CatalogueImportExport from './CatalogueImportExport'
import StaffMonitoring from './StaffMonitoring'
import PayrollCompensation from './PayrollCompensation'

// Which roles see each tab, grouped for the sidebar. 'staff' is
// deliberately narrow — create-only access to quotations and purchase
// orders, nothing else (no view lists, no other section). 'sales' can
// create and view sales/purchasing/service documents; 'accountant' can
// view financial and HR records read-only; 'admin' sees everything,
// including Users, the Audit Log, and HR editing.
const TABS = [
  { id: 'overview', label: 'Overview', group: 'Overview', roles: ['admin', 'sales', 'accountant'], Component: Overview },

  { id: 'quotation', label: 'Create Quotation', group: 'Sales', roles: ['admin', 'sales', 'staff'], Component: CreateQuotation },
  { id: 'quotations', label: 'Quotations', group: 'Sales', roles: ['admin', 'sales', 'accountant'], Component: Quotations },
  { id: 'invoice', label: 'Create Invoice', group: 'Sales', roles: ['admin', 'sales'], Component: CreateInvoice },
  { id: 'invoices', label: 'Invoices', group: 'Sales', roles: ['admin', 'sales', 'accountant'], Component: Invoices },
  { id: 'creditNote', label: 'Create Credit Note', group: 'Sales', roles: ['admin', 'sales'], Component: CreateCreditNote },
  { id: 'creditNotes', label: 'Credit Notes', group: 'Sales', roles: ['admin', 'sales', 'accountant'], Component: CreditNotes },
  { id: 'customers', label: 'Customers', group: 'Sales', roles: ['admin', 'sales', 'accountant'], Component: Customers },

  { id: 'purchaseOrder', label: 'Create Purchase Order', group: 'Purchasing', roles: ['admin', 'sales', 'staff'], Component: CreatePurchaseOrder },
  { id: 'purchaseOrders', label: 'Purchase Orders', group: 'Purchasing', roles: ['admin', 'sales', 'accountant'], Component: PurchaseOrders },
  { id: 'suppliers', label: 'Suppliers', group: 'Purchasing', roles: ['admin', 'sales', 'accountant'], Component: Suppliers },
  { id: 'lowStock', label: 'Low Stock', group: 'Purchasing', roles: ['admin', 'sales', 'accountant'], Component: LowStock },

  { id: 'catalogue', label: 'Product Catalogue', group: 'Catalogue', roles: ['admin', 'sales', 'accountant'], Component: Catalogue },
  { id: 'catalogueImportExport', label: 'Import / Export', group: 'Catalogue', roles: ['admin'], Component: CatalogueImportExport },

  { id: 'repairTicket', label: 'Create Repair Ticket', group: 'Service', roles: ['admin', 'sales'], Component: CreateRepairTicket },
  { id: 'repairTickets', label: 'Repair Tickets', group: 'Service', roles: ['admin', 'sales', 'accountant'], Component: RepairTickets },
  { id: 'amcContract', label: 'Create AMC Contract', group: 'Service', roles: ['admin', 'sales'], Component: CreateAmcContract },
  { id: 'amcContracts', label: 'AMC Contracts', group: 'Service', roles: ['admin', 'sales', 'accountant'], Component: AmcContracts },

  { id: 'staffMonitoring', label: 'Staff Monitoring', group: 'HR', roles: ['admin', 'accountant'], Component: StaffMonitoring },
  { id: 'payroll', label: 'Payroll & Compensation', group: 'HR', roles: ['admin', 'accountant'], Component: PayrollCompensation },

  { id: 'users', label: 'Users', group: 'Admin', roles: ['admin'], Component: Users },
  { id: 'audit', label: 'Audit Log', group: 'Admin', roles: ['admin'], Component: AuditLog },
]

const GROUP_ORDER = ['Overview', 'Sales', 'Purchasing', 'Catalogue', 'Service', 'HR', 'Admin']

export default function Dashboard({ token, user, onLogout }) {
  const visibleTabs = TABS.filter((t) => t.roles.includes(user.role))
  const [tab, setTab] = useState(visibleTabs[0]?.id)

  const active = visibleTabs.find((t) => t.id === tab) || visibleTabs[0]
  const ActiveComponent = active?.Component

  const groups = GROUP_ORDER
    .map((name) => ({ name, tabs: visibleTabs.filter((t) => t.group === name) }))
    .filter((g) => g.tabs.length > 0)

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <aside style={styles.sidebar}>
          <div style={styles.brand}>
            <div style={styles.brandMark}>DC</div>
            <div>
              <div style={styles.brandName}>DIL Computers</div>
              <div style={styles.brandTagline}>Business Suite</div>
            </div>
          </div>

          <nav style={styles.nav}>
            {groups.map((group) => (
              <div key={group.name} style={styles.navGroup}>
                <div style={styles.navGroupLabel}>{group.name}</div>
                {group.tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    style={{
                      ...styles.navButton,
                      ...(active?.id === t.id ? styles.navButtonActive : {}),
                    }}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div style={styles.sidebarFooter}>
            <div style={styles.whoami}>
              <div style={styles.whoamiName}>{user.fullName || user.username}</div>
              <span style={styles.roleBadge}>{user.role}</span>
            </div>
            <button style={styles.logoutButton} onClick={onLogout}>
              Log out
            </button>
          </div>
        </aside>

        <main style={styles.content}>
          <div style={styles.contentInner}>
            {ActiveComponent && <ActiveComponent token={token} user={user} onLogout={onLogout} />}
          </div>
        </main>
      </div>
    </div>
  )
}

const NAVY = '#0f1b2d'
const NAVY_DEEP = '#0a1420'
const ACCENT = '#c9a648'

const styles = {
  page: {
    minHeight: '100vh',
    background: '#eef1f6',
    padding: 0,
  },
  shell: {
    display: 'flex',
    minHeight: '100vh',
    alignItems: 'stretch',
  },
  sidebar: {
    width: 260,
    flexShrink: 0,
    background: `linear-gradient(180deg, ${NAVY} 0%, ${NAVY_DEEP} 100%)`,
    color: '#e2e8f0',
    display: 'flex',
    flexDirection: 'column',
    padding: '24px 0',
    boxShadow: '2px 0 12px rgba(0,0,0,0.15)',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0 20px 24px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    marginBottom: 12,
  },
  brandMark: {
    width: 38,
    height: 38,
    borderRadius: 8,
    background: ACCENT,
    color: NAVY_DEEP,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 800,
    fontSize: 14,
    letterSpacing: 0.5,
    flexShrink: 0,
  },
  brandName: {
    fontSize: 15,
    fontWeight: 700,
    color: '#fff',
    letterSpacing: 0.2,
  },
  brandTagline: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  nav: {
    flex: 1,
    overflowY: 'auto',
    padding: '4px 12px',
  },
  navGroup: {
    marginBottom: 18,
  },
  navGroupLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    padding: '0 10px',
    marginBottom: 6,
  },
  navButton: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '9px 12px',
    borderRadius: 7,
    border: 'none',
    background: 'transparent',
    color: '#cbd5e1',
    fontSize: 13.5,
    fontWeight: 500,
    cursor: 'pointer',
    marginBottom: 2,
    transition: 'background 0.15s, color 0.15s',
  },
  navButtonActive: {
    background: 'rgba(201, 166, 72, 0.16)',
    color: '#fff',
    fontWeight: 700,
    boxShadow: `inset 3px 0 0 ${ACCENT}`,
  },
  sidebarFooter: {
    borderTop: '1px solid rgba(255,255,255,0.08)',
    padding: '16px 20px 0 20px',
    marginTop: 12,
  },
  whoami: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  whoamiName: {
    fontSize: 13,
    fontWeight: 600,
    color: '#fff',
  },
  roleBadge: {
    padding: '2px 9px',
    borderRadius: 999,
    background: 'rgba(201, 166, 72, 0.18)',
    color: ACCENT,
    fontSize: 10.5,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  logoutButton: {
    width: '100%',
    padding: '9px 12px',
    borderRadius: 7,
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'transparent',
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  content: {
    flex: 1,
    padding: '32px 36px',
    overflowY: 'auto',
  },
  contentInner: {
    maxWidth: 1080,
    margin: '0 auto',
    background: '#fff',
    borderRadius: 14,
    boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 12px 32px rgba(15,23,42,0.06)',
    padding: 28,
    border: '1px solid #e8ebf0',
  },
}
