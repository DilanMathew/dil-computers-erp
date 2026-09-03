// Shared formatting helpers.

export function formatPrice(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
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
