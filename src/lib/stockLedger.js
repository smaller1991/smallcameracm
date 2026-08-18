const numberValue = value => Number(value || 0)

const productBaseCost = product => {
  if (!product) return 0
  if (product.base_cost != null) return numberValue(product.base_cost)
  const addOnTotal = (product.report_add_ons || []).reduce((sum, item) => sum + numberValue(item.cost), 0)
  return Math.max(0, numberValue(product.total_cost) - addOnTotal)
}

const happenedOnOrBefore = (candidate, event) => (
  new Date(candidate?.date || 0).getTime() <= new Date(event?.date || 0).getTime()
)

// Reconstruct stock value backwards from the current balance. Transactions are
// expected newest-first, matching the account report query.
export function buildStockMap(transactions, currentStockValue) {
  const txs = transactions || []
  const map = {}
  let runningStock = numberValue(currentStockValue)
  const soldProductSeen = new Set()
  const addOnsByProduct = txs.reduce((result, tx) => {
    if (tx.category !== 'Add-on' || !tx.product_id) return result
    if (!result.has(tx.product_id)) result.set(tx.product_id, [])
    result.get(tx.product_id).push(tx)
    return result
  }, new Map())

  const costAtEvent = tx => {
    const base = productBaseCost(tx.products)
    const addOns = (addOnsByProduct.get(tx.product_id) || [])
      .filter(addOn => happenedOnOrBefore(addOn, tx))
      .reduce((sum, addOn) => sum + numberValue(addOn.amount), 0)
    return base + addOns
  }

  const purchaseCost = tx => {
    const batchItems = tx.products?.batch_items || []
    if (batchItems.length > 1) return batchItems.reduce((sum, product) => sum + productBaseCost(product), 0)
    return productBaseCost(tx.products)
  }

  const stockDelta = tx => {
    if (tx.category === 'Buy Stock' && tx.product_id) {
      if (String(tx.note || '').includes('ชำระค่าซื้อ')) return 0
      return purchaseCost(tx)
    }
    if (tx.category === 'Add-on' && tx.product_id) return numberValue(tx.amount)
    if (tx.category === 'Sale' && tx.product_id && tx.products?.status === 'Sold' && !soldProductSeen.has(tx.product_id)) {
      soldProductSeen.add(tx.product_id)
      return -costAtEvent(tx)
    }
    if (tx.category === 'Trade') {
      const sellA = numberValue(tx.trade_sell_a)
      const profitA = numberValue(tx.trade_profit_a)
      if (!sellA && !profitA) return 0
      const costA = sellA - profitA
      const cashDifference = tx.type === 'Income' ? numberValue(tx.amount) : -numberValue(tx.amount)
      const buyB = sellA - cashDifference
      return buyB - costA
    }
    return 0
  }

  for (const tx of txs) {
    map[tx.id] = runningStock
    runningStock -= stockDelta(tx)
  }
  return map
}
