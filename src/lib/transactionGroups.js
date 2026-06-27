const SALE_GROUP_CATEGORIES = new Set(['Sale'])
const PURCHASE_GROUP_CATEGORIES = new Set(['Buy Stock'])

const num = value => Number(value || 0)

export const txProductCost = tx => (
  tx.category === 'Buy Stock'
    ? num(tx.products?.batch_total_cost || tx.products?.total_cost)
    : num(tx.products?.total_cost)
)

export const transactionGroupKey = tx => {
  if (SALE_GROUP_CATEGORIES.has(tx.category) && tx.products?.sale_batch_id) {
    return `sale:${tx.products.sale_batch_id}`
  }
  if (PURCHASE_GROUP_CATEGORIES.has(tx.category) && tx.products?.batch_id) {
    return `purchase:${tx.products.batch_id}`
  }
  return `tx:${tx.id}`
}

export const groupKindLabel = group => {
  if (group.kind === 'sale') return group.itemCount > 1 ? `ขายรวม ${group.itemCount} รายการ` : 'ขายสินค้า'
  if (group.kind === 'purchase') return group.itemCount > 1 ? `ซื้อรวม ${group.itemCount} รายการ` : 'ซื้อสินค้า'
  if (group.kind === 'trade') return 'แลกเปลี่ยน'
  return group.category || 'รายการบัญชี'
}

export const groupPaymentLabel = txs => {
  const bank = txs.reduce((sum, tx) => sum + num(tx.bank_amount), 0)
  const cash = txs.reduce((sum, tx) => sum + num(tx.cash_amount), 0)
  if (bank || cash) {
    return [
      bank ? `โอน ฿${bank.toLocaleString('th-TH')}` : '',
      cash ? `สด ฿${cash.toLocaleString('th-TH')}` : '',
    ].filter(Boolean).join(' + ')
  }
  const methods = [...new Set(txs.map(tx => tx.payment_method).filter(Boolean))]
  return methods.length ? methods.join(', ') : ''
}

export const groupLineItems = group => {
  if (group.kind === 'purchase') {
    const batchItems = group.txs[0]?.products?.batch_items || []
    if (batchItems.length) {
      return batchItems.map(product => ({
        id: product.id,
        model: product.model || '',
        serial: product.serial_number || '',
        category: product.category || '',
        amount: num(product.total_cost),
        cost: num(product.total_cost),
        note: product.notes || '',
      }))
    }
  }

  return group.txs.map(tx => ({
    id: tx.id,
    tx,
    model: tx.products?.model || '',
    serial: tx.products?.serial_number || '',
    category: tx.products?.category || '',
    amount: num(tx.amount),
    cost: txProductCost(tx),
    profit: tx.category === 'Sale' && tx.products?.total_cost != null
      ? num(tx.amount) - num(tx.products.total_cost)
      : tx.category === 'Trade' && tx.trade_profit_a != null
      ? num(tx.trade_profit_a)
      : null,
    note: tx.note || tx.products?.customer_note || '',
  }))
}

export const buildTransactionGroups = txs => {
  const map = new Map()
  const order = []

  for (const tx of txs || []) {
    const key = transactionGroupKey(tx)
    if (!map.has(key)) {
      const kind = key.startsWith('sale:')
        ? 'sale'
        : key.startsWith('purchase:')
        ? 'purchase'
        : tx.category === 'Trade'
        ? 'trade'
        : 'single'
      map.set(key, {
        key,
        kind,
        category: tx.category,
        type: tx.type,
        txs: [],
        date: tx.date,
      })
      order.push(key)
    }
    map.get(key).txs.push(tx)
  }

  return order.map(key => {
    const group = map.get(key)
    const representative = group.txs[0]
    const balanceTx = group.txs.reduce((latest, tx) => (
      new Date(tx.created_at || tx.date) > new Date(latest.created_at || latest.date) ? tx : latest
    ), representative)
    const totalAmount = group.txs.reduce((sum, tx) => sum + num(tx.amount), 0)
    const bankAmount = group.txs.reduce((sum, tx) => sum + num(tx.bank_amount), 0)
    const cashAmount = group.txs.reduce((sum, tx) => sum + num(tx.cash_amount), 0)
    const lines = groupLineItems({ ...group, totalAmount })
    const itemCount = Math.max(lines.length, group.txs.length)
    const isGrouped = itemCount > 1 || group.kind === 'trade'
    return {
      ...group,
      representative,
      balanceTx,
      coverTx: group.txs.find(tx => tx.images?.length) || representative,
      totalAmount,
      bankAmount,
      cashAmount,
      lines,
      itemCount,
      isGrouped,
      title: groupKindLabel({ ...group, itemCount }),
      paymentLabel: groupPaymentLabel(group.txs),
    }
  })
}
