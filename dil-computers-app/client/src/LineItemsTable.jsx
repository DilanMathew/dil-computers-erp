import { formatPrice } from './format'

export default function LineItemsTable({ items, onRemove }) {
  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Category</th>
            <th style={styles.th}>Product</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Qty</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Catalogue Price</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Final Price</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Line Total</th>
            <th style={styles.th}></th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td style={styles.td} colSpan={7}>No products added yet.</td>
            </tr>
          ) : (
            items.map((item) => (
              <tr key={item.id}>
                <td style={styles.td}>{item.category}</td>
                <td style={styles.td}>
                  {item.name}
                  {item.serialNumbers && item.serialNumbers.length > 0 && (
                    <div style={styles.serialsNote}>SN: {item.serialNumbers.join(', ')}</div>
                  )}
                </td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{item.quantity}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{formatPrice(item.catalPrice)}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{formatPrice(item.finalPrice)}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>
                  {formatPrice(item.finalPrice * item.quantity)}
                </td>
                <td style={{ ...styles.td, textAlign: 'right' }}>
                  <button type="button" style={styles.removeButton} onClick={() => onRemove(item.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

const styles = {
  tableWrap: {
    overflowX: 'auto',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 14,
  },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    color: '#334155',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '10px 12px',
    borderBottom: '1px solid #f1f5f9',
    color: '#0f172a',
  },
  serialsNote: {
    marginTop: 2,
    fontSize: 11,
    color: '#64748b',
  },
  removeButton: {
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid #fecaca',
    background: '#fef2f2',
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
}
