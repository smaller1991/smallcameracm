import { profitAfterVat, vatDocumentOf } from './vat'

const SALE_GROUP_CATEGORIES = new Set(['Sale'])
const PURCHASE_GROUP_CATEGORIES = new Set(['Buy Stock'])

const num = value => Number(value || 0)
const isPurchaseInstallmentTx = tx => {
  const note = tx.note || ''
  return note.includes('ซื้อผ่อน') || note.includes('ชำระค่าซื้อ')
}

export const txProductCost = tx => (
  tx.category === 'Buy Stock'
    ? num(tx.products?.batch_total_cost || tx.products?.total_cost)
    : num(tx.products?.total_cost)
)

export const transactionGroupKey = tx => {
  if (SALE_GROUP_CATEGORIES.has(tx.category) && tx.products?.sale_batch_id) {
    const paymentEvent = [
      tx.date || '',
      tx.payment_method || '',
    ].join(':')
    return `sale:${tx.products.sale_batch_id}:${paymentEvent}`
  }
  if (PURCHASE_GROUP_CATEGORIES.has(tx.category) && tx.products?.batch_id) {
    if (isPurchaseInstallmentTx(tx)) {
      const paymentEvent = [
        tx.date || '',
        tx.payment_method || '',
        tx.id || '',
      ].join(':')
      return `purchase:${tx.products.batch_id}:${paymentEvent}`
    }
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

const saleProductKey = tx => tx.product_id || tx.products?.id || tx.id

const saleProductTotal = tx => num(tx.products?.installment_total || tx.products?.sold_price || tx.amount)

const saleBatchTotal = txs => {
  const seen = new Set()
  return txs.reduce((sum, tx) => {
    const key = saleProductKey(tx)
    if (seen.has(key)) return sum
    seen.add(key)
    return sum + saleProductTotal(tx)
  }, 0)
}

const buildSaleInstallmentMeta = (groups, allTxs) => {
  const txsByInstallment = (allTxs || []).reduce((map, tx) => {
    const batchId = tx.products?.sale_batch_id
    const productId = tx.product_id || tx.products?.id
    if (!SALE_GROUP_CATEGORIES.has(tx.category)) return map
    if (!batchId && !tx.products?.installment_total) return map
    const installmentKey = batchId ? `batch:${batchId}` : `product:${productId}`
    if (!map.has(installmentKey)) map.set(installmentKey, [])
    map.get(installmentKey).push(tx)
    return map
  }, new Map())

  const metaByKey = new Map()
  for (const [installmentKey, installmentTxs] of txsByInstallment.entries()) {
    const paymentGroups = new Map()
    const paymentOrder = []
    for (const tx of installmentTxs) {
      const key = transactionGroupKey(tx)
      if (!paymentGroups.has(key)) {
        paymentGroups.set(key, { key, txs: [], date: tx.date })
        paymentOrder.push(key)
      }
      const paymentGroup = paymentGroups.get(key)
      paymentGroup.txs.push(tx)
      if (new Date(tx.date || 0) < new Date(paymentGroup.date || 0)) paymentGroup.date = tx.date
    }

    const totalDue = installmentKey.startsWith('batch:')
      ? saleBatchTotal(installmentTxs)
      : saleProductTotal(installmentTxs[0])
    let paidSoFar = 0
    let firstPaymentDate = null
    paymentOrder
      .map(key => paymentGroups.get(key))
      .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))
      .forEach((paymentGroup, index) => {
        if (index === 0) firstPaymentDate = paymentGroup.date
        const paidThisRound = paymentGroup.txs.reduce((sum, tx) => sum + num(tx.amount), 0)
        paidSoFar += paidThisRound
        const remainingAfter = Math.max(0, totalDue - paidSoFar)
        metaByKey.set(paymentGroup.key, {
          installmentKey,
          installmentNumber: index + 1,
          paidThisRound,
          paidSoFar,
          totalDue,
          remainingAfter,
          firstPaymentDate,
          isFinalInstallment: totalDue > 0 && remainingAfter <= 0,
          hasInstallments: paymentOrder.length > 1 || remainingAfter > 0,
        })
      })
  }

  return groups.reduce((map, group) => {
    if (group.kind === 'sale') {
      const meta = metaByKey.get(group.key)
      if (meta) map[group.key] = meta
    }
    return map
  }, {})
}

const purchaseProductKey = tx => tx.product_id || tx.products?.id || tx.id

const purchaseGroupTotal = txs => {
  const batchItems = txs.find(tx => tx.products?.batch_items?.length)?.products?.batch_items || []
  if (batchItems.length) {
    return batchItems.reduce((sum, product) => sum + num(product.total_cost), 0)
  }

  const seen = new Set()
  return txs.reduce((sum, tx) => {
    const key = purchaseProductKey(tx)
    if (seen.has(key)) return sum
    seen.add(key)
    return sum + txProductCost(tx)
  }, 0)
}

const buildPurchaseInstallmentMeta = (groups, allTxs) => {
  const txsByInstallment = (allTxs || []).reduce((map, tx) => {
    if (!PURCHASE_GROUP_CATEGORIES.has(tx.category)) return map
    if (!isPurchaseInstallmentTx(tx)) return map
    const batchId = tx.products?.batch_id
    const productId = tx.product_id || tx.products?.id
    if (!batchId && !productId) return map
    const installmentKey = batchId ? `batch:${batchId}` : `product:${productId}`
    if (!map.has(installmentKey)) map.set(installmentKey, [])
    map.get(installmentKey).push(tx)
    return map
  }, new Map())

  const metaByKey = new Map()
  for (const [installmentKey, installmentTxs] of txsByInstallment.entries()) {
    const paymentGroups = new Map()
    const paymentOrder = []
    for (const tx of installmentTxs) {
      const key = transactionGroupKey(tx)
      if (!paymentGroups.has(key)) {
        paymentGroups.set(key, { key, txs: [], date: tx.date })
        paymentOrder.push(key)
      }
      const paymentGroup = paymentGroups.get(key)
      paymentGroup.txs.push(tx)
      if (new Date(tx.date || 0) < new Date(paymentGroup.date || 0)) paymentGroup.date = tx.date
    }

    const totalDue = purchaseGroupTotal(installmentTxs)
    let paidSoFar = 0
    let firstPaymentDate = null
    paymentOrder
      .map(key => paymentGroups.get(key))
      .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))
      .forEach((paymentGroup, index) => {
        if (index === 0) firstPaymentDate = paymentGroup.date
        const paidThisRound = paymentGroup.txs.reduce((sum, tx) => sum + num(tx.amount), 0)
        paidSoFar += paidThisRound
        const remainingAfter = Math.max(0, totalDue - paidSoFar)
        metaByKey.set(paymentGroup.key, {
          installmentKey,
          installmentNumber: index + 1,
          paidThisRound,
          paidSoFar,
          totalDue,
          remainingAfter,
          firstPaymentDate,
          purchasedAt: firstPaymentDate,
          isFinalInstallment: totalDue > 0 && remainingAfter <= 0,
          hasInstallments: paymentOrder.length > 1 || remainingAfter > 0,
          kind: 'purchase',
        })
      })
  }

  return groups.reduce((map, group) => {
    if (group.kind === 'purchase' || group.category === 'Buy Stock') {
      const meta = metaByKey.get(group.key)
      if (meta) map[group.key] = meta
    }
    return map
  }, {})
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
    amount: group.kind === 'sale' && group.installment?.hasInstallments && tx.products?.sale_batch_id
      ? saleProductTotal(tx)
      : num(tx.amount),
    cost: txProductCost(tx),
    profit: tx.category === 'Sale' && tx.products?.total_cost != null && (!group.installment || group.installment.isFinalInstallment)
      ? profitAfterVat(saleProductTotal(tx), tx.products.total_cost, vatDocumentOf(tx))
      : tx.category === 'Trade' && tx.trade_profit_a != null
      ? profitAfterVat(
          num(tx.trade_sell_a),
          num(tx.trade_sell_a) - num(tx.trade_profit_a),
          vatDocumentOf(tx),
        )
      : null,
    note: tx.note || tx.products?.customer_note || '',
  }))
}

export const buildTransactionGroups = (txs, allTxs = txs) => {
  const map = new Map()
  const order = []

  for (const tx of txs || []) {
    const key = transactionGroupKey(tx)
    if (!map.has(key)) {
      const kind = key.startsWith('sale:')
        ? 'sale'
        : key.startsWith('purchase:')
        ? 'purchase'
        : tx.category === 'Sale'
        ? 'sale'
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

  const groups = order.map(key => {
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

  const installmentMeta = {
    ...buildSaleInstallmentMeta(groups, allTxs),
    ...buildPurchaseInstallmentMeta(groups, allTxs),
  }

  return groups.map(group => {
    const installment = installmentMeta[group.key] || null
    const lines = groupLineItems({ ...group, installment })
    const itemCount = Math.max(lines.length, group.txs.length)
    return {
      ...group,
      lines,
      itemCount,
      isGrouped: group.isGrouped || Boolean(installment?.hasInstallments),
      title: groupKindLabel({ ...group, itemCount }),
      installment,
    }
  })
}
