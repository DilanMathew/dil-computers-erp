import { useEffect, useState } from 'react'
import { apiFetch, AuthError } from './api'

// Shared state + logic behind the "pick a category, search a product,
// set a quantity and a final price" form used by both quotation and
// invoice creation. Returns everything a <ProductPicker> needs to render,
// plus buildItem() to turn the current draft into a validated line item.
export default function useLineItemBuilder({ token, onLogout }) {
  const [categories, setCategories] = useState([])

  const [category, setCategory] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestLoading, setSuggestLoading] = useState(false)

  const [quantity, setQuantity] = useState('1')
  const [finalPrice, setFinalPrice] = useState('')
  const [sameAsCatalogue, setSameAsCatalogue] = useState(false)
  const [serialNumbersText, setSerialNumbersText] = useState('')

  useEffect(() => {
    apiFetch('/api/categories', token)
      .then((data) => setCategories(data.categories || []))
      .catch((err) => {
        if (err instanceof AuthError) onLogout()
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Look up products in the selected category as the user types a name.
  useEffect(() => {
    if (!category) {
      setSuggestions([])
      return
    }

    let cancelled = false
    const id = setTimeout(() => {
      setSuggestLoading(true)
      const params = new URLSearchParams({ category, pageSize: '10', sort: 'name' })
      if (productQuery) params.set('q', productQuery)

      apiFetch(`/api/products?${params.toString()}`, token)
        .then((data) => {
          if (cancelled) return
          setSuggestions(data.items || [])
        })
        .catch((err) => {
          if (cancelled) return
          if (err instanceof AuthError) onLogout()
        })
        .finally(() => {
          if (!cancelled) setSuggestLoading(false)
        })
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [token, category, productQuery, onLogout])

  function resetDraft() {
    setProductQuery('')
    setSelectedProduct(null)
    setSuggestions([])
    setShowSuggestions(false)
    setQuantity('1')
    setFinalPrice('')
    setSameAsCatalogue(false)
    setSerialNumbersText('')
  }

  function handleCategoryChange(value) {
    setCategory(value)
    setProductQuery('')
    setSelectedProduct(null)
    setShowSuggestions(false)
    setFinalPrice('')
    setSameAsCatalogue(false)
    setSerialNumbersText('')
  }

  function handleSelectSuggestion(product) {
    setSelectedProduct(product)
    setProductQuery(product.name)
    setShowSuggestions(false)
    setFinalPrice('')
    setSameAsCatalogue(false)
    setSerialNumbersText('')
  }

  function handleSameAsCatalogueChange(checked) {
    setSameAsCatalogue(checked)
    if (checked && selectedProduct) {
      setFinalPrice(String(selectedProduct.price))
    } else {
      setFinalPrice('')
    }
  }

  function handleProductQueryChange(value) {
    setProductQuery(value)
    setSelectedProduct(null)
    setShowSuggestions(true)
  }

  // Validates the current draft and returns { ok: true, item } or
  // { ok: false, message }. Does not reset the draft — call resetDraft()
  // yourself once the item has been added.
  function buildItem() {
    if (!category) {
      return { ok: false, message: 'Select a product category.' }
    }
    if (!selectedProduct) {
      return { ok: false, message: 'Pick a product from the suggestions list.' }
    }
    const qty = parseInt(quantity, 10)
    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, message: 'Enter a quantity greater than zero.' }
    }
    if (qty > selectedProduct.quantity) {
      return {
        ok: false,
        message: `Only ${selectedProduct.quantity} of "${selectedProduct.name}" left in stock.`,
      }
    }

    let resolvedFinalPrice
    if (sameAsCatalogue) {
      resolvedFinalPrice = Number(selectedProduct.price)
    } else {
      resolvedFinalPrice = Number(finalPrice)
      if (finalPrice === '' || !Number.isFinite(resolvedFinalPrice) || resolvedFinalPrice < 0) {
        return { ok: false, message: 'Enter a final price, or tick "Same as catalogue price".' }
      }
    }

    const serials = serialNumbersText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (serials.length > 0 && serials.length !== qty) {
      return { ok: false, message: `Enter ${qty} serial number(s) (comma-separated), or leave that field blank.` }
    }

    return {
      ok: true,
      item: {
        id: `${selectedProduct.id}-${Date.now()}`,
        productId: selectedProduct.id,
        category,
        name: selectedProduct.name,
        quantity: qty,
        catalPrice: Number(selectedProduct.price),
        finalPrice: resolvedFinalPrice,
        sameAsCatalogue,
        hsnCode: selectedProduct.hsn_code || null,
        warrantyMonths: selectedProduct.warranty_months || null,
        serialNumbers: serials.length > 0 ? serials : null,
      },
    }
  }

  return {
    categories,
    category,
    productQuery,
    selectedProduct,
    suggestions,
    showSuggestions,
    suggestLoading,
    quantity,
    finalPrice,
    sameAsCatalogue,
    serialNumbersText,
    setQuantity,
    setFinalPrice,
    setSerialNumbersText,
    setShowSuggestions,
    handleCategoryChange,
    handleSelectSuggestion,
    handleSameAsCatalogueChange,
    handleProductQueryChange,
    resetDraft,
    buildItem,
  }
}
