import { useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'

// Search-as-you-type customer lookup. Fully controlled: the parent owns
// the text value and the selected id, this component just fetches
// suggestions and reports what the user typed or picked. Typing after a
// selection is treated as "not that customer anymore" by the parent
// (it should clear the id whenever the text changes).
export default function CustomerPicker({
  token,
  onLogout,
  id = 'customer',
  label = 'Customer',
  value,
  onInputChange,
  onSelect,
  placeholder = 'Search by name or phone…',
  required = false,
}) {
  const [suggestions, setSuggestions] = useState([])
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!value) {
      setSuggestions([])
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true)
      apiFetch(`/api/customers?q=${encodeURIComponent(value)}&pageSize=6`, token)
        .then((data) => {
          if (cancelled) return
          setSuggestions(data.items || [])
        })
        .catch((err) => {
          if (cancelled) return
          if (err instanceof AuthError) onLogout()
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [token, value, onLogout])

  return (
    <div style={{ position: 'relative' }}>
      <label style={styles.label} htmlFor={id}>{label}{required ? '' : ' (optional)'}</label>
      <input
        id={id}
        style={styles.input}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onInputChange(e.target.value)
          setShow(true)
        }}
        onFocus={() => setShow(true)}
        onBlur={() => setTimeout(() => setShow(false), 150)}
      />
      {show && value && (
        <div style={styles.suggestions}>
          {loading ? (
            <div style={styles.suggestionItem}>Loading…</div>
          ) : suggestions.length === 0 ? (
            <div style={styles.suggestionItem}>No matching customers — this will be saved as a walk-in.</div>
          ) : (
            suggestions.map((c) => (
              <div
                key={c.id}
                style={styles.suggestionItem}
                onMouseDown={() => {
                  onSelect(c)
                  setShow(false)
                }}
              >
                <span>{c.name}</span>
                <span style={styles.suggestionMeta}>{c.phone || ''}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

const styles = {
  label: {
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
  suggestions: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    zIndex: 10,
    background: '#fff',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    marginTop: 4,
    maxHeight: 220,
    overflowY: 'auto',
    boxShadow: '0 10px 20px rgba(15, 23, 42, 0.12)',
  },
  suggestionItem: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    padding: '8px 12px',
    fontSize: 13,
    color: '#0f172a',
    cursor: 'pointer',
    borderBottom: '1px solid #f1f5f9',
  },
  suggestionMeta: {
    color: '#64748b',
    whiteSpace: 'nowrap',
  },
}
