import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatPrice } from './format'

// Builds and downloads a PDF for a quotation or an invoice — same layout,
// different header fields and filename prefix. companyInfo/subtotal/
// gstRate/gstAmount/grandTotal drive the GST breakdown at the bottom; pass
// gstRate 0 (or omit) for a plain total with no tax line.
export function buildDocumentPdf({
  docLabel, filePrefix, number, date, fields, items,
  companyInfo, subtotal, gstRate = 0, gstAmount = 0, grandTotal,
}) {
  const doc = new jsPDF()

  doc.setFontSize(18)
  doc.text(companyInfo?.name || 'DIL Computers', 14, 20)
  doc.setFontSize(12)
  doc.setTextColor(100)
  doc.text(docLabel, 14, 27)
  doc.setTextColor(0)

  doc.setFontSize(9)
  let headerY = 33
  if (companyInfo?.address) {
    doc.text(companyInfo.address, 14, headerY)
    headerY += 5
  }
  if (companyInfo?.gstin) {
    doc.text(`GSTIN: ${companyInfo.gstin}`, 14, headerY)
    headerY += 5
  }

  doc.setFontSize(10)
  let infoY = headerY + 4
  doc.text(`${docLabel} #: ${number}`, 14, infoY)
  infoY += 6
  doc.text(`Date: ${date}`, 14, infoY)

  for (const [label, value] of fields) {
    if (!value) continue
    infoY += 6
    doc.text(`${label}: ${value}`, 14, infoY)
  }

  const rows = items.map((item, idx) => [
    idx + 1,
    item.category,
    item.name,
    item.hsnCode || '—',
    item.quantity,
    formatPrice(item.catalPrice),
    formatPrice(item.finalPrice),
    formatPrice(item.finalPrice * item.quantity),
  ])

  autoTable(doc, {
    startY: infoY + 8,
    head: [['#', 'Category', 'Product', 'HSN', 'Qty', 'Catalogue Price', 'Final Price', 'Line Total']],
    body: rows,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [30, 58, 138] },
    columnStyles: {
      0: { cellWidth: 8 },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
    },
  })

  const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY : infoY + 8
  const total = grandTotal ?? items.reduce((sum, item) => sum + item.finalPrice * item.quantity, 0)

  doc.setFontSize(10)
  let totalsY = finalY + 10
  if (gstRate > 0) {
    doc.text(`Subtotal: ${formatPrice(subtotal ?? total)}`, 140, totalsY, { align: 'left' })
    totalsY += 6
    doc.text(`GST (${gstRate}%): ${formatPrice(gstAmount)}`, 140, totalsY, { align: 'left' })
    totalsY += 8
  }

  doc.setFontSize(12)
  doc.setFont(undefined, 'bold')
  doc.text(`Grand Total: ${formatPrice(total)}`, 14, totalsY)
  doc.setFont(undefined, 'normal')

  doc.save(`${filePrefix}-${number}.pdf`)
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

export function generateDocumentNumber(prefix) {
  const datePart = todayIso().replace(/-/g, '')
  const randomPart = Math.floor(1000 + Math.random() * 9000)
  return `${prefix}-${datePart}-${randomPart}`
}
