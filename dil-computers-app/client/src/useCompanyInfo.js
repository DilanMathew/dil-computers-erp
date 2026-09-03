import { useEffect, useState } from 'react'

// Seller info printed on quotation/invoice PDFs (name, GSTIN, address).
// Public endpoint, no token needed — same info a printed letterhead has.
export default function useCompanyInfo() {
  const [companyInfo, setCompanyInfo] = useState({ name: 'DIL Computers', gstin: '', address: '' })

  useEffect(() => {
    fetch('/api/company-info')
      .then((res) => res.json())
      .then((data) => setCompanyInfo(data))
      .catch(() => {})
  }, [])

  return companyInfo
}
