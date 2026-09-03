import { useRef, useState } from 'react'
import { AuthError } from './api'

// Bulk catalogue tools (admin only): download the full catalogue as a CSV
// (in the same column shape the import expects, so export → edit in a
// spreadsheet → re-import round-trips cleanly), or upload a CSV to
// create/update products in bulk. Not built on apiFetch — export needs a
// blob response and import needs a raw-text body, neither of which fit
// apiFetch's JSON-in/JSON-out shape.
export default function CatalogueImportExport({ token, onLogout }) {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  const [file, setFile] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [importResult, setImportResult] = useState(null)
  const fileInputRef = useRef(null)

  async function handleExport() {
    setExporting(true)
    setExportError('')
    try {
      const res = await fetch('/api/products/export', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) throw new AuthError('Session expired')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || `Export failed (${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'product_catalogue_export.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      if (err instanceof AuthError) onLogout()
      else setExportError(err.message || 'Could not export the catalogue.')
    } finally {
      setExporting(false)
    }
  }

  async function handleImport() {
    if (!file) {
      setImportError('Choose a CSV file first.')
      return
    }
    setImporting(true)
    setImportError('')
    setImportResult(null)
    try {
      const text = await file.text()
      const res = await fetch('/api/products/import', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/csv',
        },
        body: text,
      })
      if (res.status === 401) throw new AuthError('Session expired')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.message || `Import failed (${res.status})`)
      }
      setImportResult(data)
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      if (err instanceof AuthError) onLogout()
      else setImportError(err.message || 'Could not import that file.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div>
      <header style={styles.header}>
        <h2 style={styles.title}>Catalogue Import / Export</h2>
        <p style={styles.subtitle}>Bulk product updates via CSV — handy for supplier price lists or a full price review.</p>
      </header>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Export</h3>
        <p style={styles.cardBody}>
          Download every product as a CSV (category, name, price, quantity, hsn_code,
          reorder_threshold, cost_price, warranty_months, barcode) — the same shape
          the import below expects, so you can edit it in a spreadsheet and bring it
          straight back in.
        </p>
        {exportError && <div style={styles.error}>{exportError}</div>}
        <button type="button" style={styles.button} onClick={handleExport} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export catalogue (CSV)'}
        </button>
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Import</h3>
        <p style={styles.cardBody}>
          Upload a CSV with at least <code>category</code> and <code>name</code> columns.
          A row matching an existing product (by category + name) updates only the
          columns present in that row — leave a column blank or out entirely to leave
          it untouched. A row that doesn't match an existing product is created new
          (needs <code>price</code> and <code>quantity</code>). Up to 5,000 rows per upload.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          style={styles.fileInput}
        />
        {importError && <div style={styles.error}>{importError}</div>}
        <button type="button" style={styles.button} onClick={handleImport} disabled={importing || !file}>
          {importing ? 'Importing…' : 'Import CSV'}
        </button>

        {importResult && (
          <div style={styles.result}>
            <p style={styles.resultLine}>
              {importResult.totalRows} row(s) processed — {importResult.created} created,{' '}
              {importResult.updated} updated
              {importResult.errorCount > 0 ? `, ${importResult.errorCount} skipped with errors` : ''}.
            </p>
            {importResult.errors && importResult.errors.length > 0 && (
              <ul style={styles.errorList}>
                {importResult.errors.map((e, idx) => (
                  <li key={idx}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const styles = {
  header: { marginBottom: 20 },
  title: { margin: 0, fontSize: 18, color: '#0f172a' },
  subtitle: { margin: '4px 0 0 0', color: '#64748b', fontSize: 14 },
  card: {
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
    background: '#f8fafc',
  },
  cardTitle: { margin: '0 0 8px 0', fontSize: 15, color: '#0f172a' },
  cardBody: { margin: '0 0 14px 0', fontSize: 13, color: '#475569', lineHeight: 1.5 },
  fileInput: { display: 'block', marginBottom: 12, fontSize: 13 },
  button: {
    padding: '10px 16px',
    borderRadius: 8,
    border: 'none',
    background: '#1e3a8a',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  error: {
    marginBottom: 12,
    padding: '10px 12px',
    borderRadius: 8,
    background: '#fef2f2',
    color: '#b91c1c',
    fontSize: 13,
  },
  result: {
    marginTop: 14,
    padding: '10px 12px',
    borderRadius: 8,
    background: '#f0fdf4',
    color: '#166534',
    fontSize: 13,
  },
  resultLine: { margin: 0, fontWeight: 600 },
  errorList: {
    margin: '8px 0 0 0',
    paddingLeft: 18,
    color: '#b91c1c',
    fontSize: 12,
    maxHeight: 200,
    overflowY: 'auto',
  },
}
