import { useEffect, useState } from 'react'

// Seller info printed on quotation/invoice PDFs (name, GSTIN, address),
// plus the current labor rate (for the technician on-site billing
// preview — the server is still authoritative on the actual charge).
// Public endpoint, no token needed — same info a printed letterhead has.
export default function useCompanyInfo() {
  const [companyInfo, setCompanyInfo] = useState({ name: 'DIL Computers', gstin: '', address: '', laborRatePerHour: 100 })

  useEffect(() => {
    fetch('/api/company-info')
      .then((res) => res.json())
      .then((data) => setCompanyInfo(data))
      .catch(() => {})
  }, [])

  return companyInfo
}
