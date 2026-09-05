// Shared formatting helpers.

// Rupees, with Indian digit grouping (1,23,456.78 — not 123,456.78).
export function formatPrice(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value)
}

// Same number, but "Rs." instead of the ₹ glyph. jsPDF's built-in fonts are
// WinAnsi-encoded and have no U+20B9, so a ₹ in a PDF renders as a stray
// box or drops out entirely — PDFs use this instead of formatPrice.
export function formatPriceAscii(value) {
  const amount = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
  return `Rs. ${amount}`
}

// Standard Indian GST slabs. Kept in sync with the server's GST_RATES —
// the server is authoritative and ignores/zeroes anything else, but
// matching the choices here avoids a rate silently getting dropped.
export const GST_RATES = [0, 5, 12, 18, 28]

export function computeGstTotals(items, gstRate) {
  const subtotal = items.reduce((sum, item) => sum + item.finalPrice * item.quantity, 0)
  const gstAmount = Math.round(subtotal * (gstRate / 100) * 100) / 100
  return { subtotal, gstAmount, grandTotal: subtotal + gstAmount }
}
