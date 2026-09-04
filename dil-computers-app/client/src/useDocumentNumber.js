import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from './api'
import { generateDocumentNumber } from './documentPdf'

// Document numbers are unique per document type (enforced by a unique index
// — see server/db/seed.js), and a bare 4-digit random suffix collides more
// often than it looks: with ~9,000 possibilities a day, a busy day of
// invoicing stands a real chance of picking the same number twice. So ask
// the server for one it has checked against what's already stored.
//
// A local number is set first so the field is never empty, and it stays put
// if that request fails — the form still works offline, and the unique index
// plus the create route's 409 remain the actual guarantee either way.
//
// Returns [number, setNumber, refresh]: setNumber for the editable input,
// refresh for after a save, when the next document needs a fresh number.
export default function useDocumentNumber(prefix, token) {
  const [number, setNumber] = useState(() => generateDocumentNumber(prefix))

  const refresh = useCallback(() => {
    setNumber(generateDocumentNumber(prefix))
    apiFetch(`/api/next-document-number?prefix=${encodeURIComponent(prefix)}`, token)
      .then((data) => {
        if (data?.number) setNumber(data.number)
      })
      .catch(() => {})
  }, [prefix, token])

  useEffect(() => {
    refresh()
  }, [refresh])

  return [number, setNumber, refresh]
}
