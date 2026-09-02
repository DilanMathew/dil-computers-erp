import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatPrice } from './format'

// Builds and downloads a PDF for a quotation or an invoice — same layout,
// different header fields and filename prefix.
export function buildDocumentPdf({ docLabel, filePrefix, number, date, fields, items }) {
  const doc = new jsPDF()

  doc.setFontSize(18)
  doc.text('DIL Computers', 14, 20)
  doc.setFontSize(12)
  doc.setTextColor(100)
  doc.text(docLabel, 14, 27)
  doc.setTextColor(0)

  doc.setFontSize(10)
  let infoY = 37
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
    item.quantity,
    formatPrice(item.catalPrice),
    formatPrice(item.finalPrice),
    item.sameAsCatalogue ? 'Catalogue price' : 'Discounted',
    formatPrice(item.finalPrice * item.quantity),
  ])

  autoTable(doc, {
    startY: infoY + 8,
    head: [['#', 'Category', 'Product', 'Qty', 'Catalogue Price', 'Final Price', 'Note', 'Line Total']],
    body: rows,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [30, 58, 138] },
    columnStyles: {
      0: { cellWidth: 8 },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      7: { halign: 'right' },
    },
  })

  const grandTotal = items.reduce((sum, item) => sum + item.finalPrice * item.quantity, 0)
  const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY : infoY + 8

  doc.setFontSize(12)
  doc.setFont(undefined, 'bold')
  doc.text(`Grand Total: ${formatPrice(grandTotal)}`, 14, finalY + 12)
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
