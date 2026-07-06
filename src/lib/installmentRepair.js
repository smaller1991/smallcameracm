const num = value => Number(value || 0)

const txTime = tx => new Date(tx?.date || tx?.created_at || 0).getTime()

const txCreatedTime = tx => new Date(tx?.created_at || tx?.date || 0).getTime()

const isAtOrAfterTx = (tx, anchor) => {
  const dateDiff = txTime(tx) - txTime(anchor)
  if (dateDiff !== 0) return dateDiff > 0
  return txCreatedTime(tx) >= txCreatedTime(anchor)
}

const receiptAccount = tx => {
  if (num(tx?.bank_amount) > 0) return 'bank'
  if (num(tx?.cash_amount) > 0) return 'cash'
  return tx?.payment_method === 'เงินสด' ? 'cash' : 'bank'
}

const batchKey = product => product.sale_batch_id || `product:${product.id}`

export async function repairSaleInstallmentRounding(supabase) {
  const { data: products, error: productError } = await supabase
    .from('products')
    .select('id,model,serial_number,status,total_cost,sold_price,sold_date,warranty_expiry,installment_total,installment_paid,sale_batch_id')
    .not('installment_total', 'is', null)

  if (productError) throw productError
  const saleInstallmentProducts = (products || []).filter(p => num(p.installment_total) > 0)
  if (!saleInstallmentProducts.length) return { repaired: 0 }

  const productIds = saleInstallmentProducts.map(p => p.id)
  const { data: txs, error: txError } = await supabase
    .from('transactions')
    .select('id,date,created_at,type,category,amount,payment_method,bank_amount,cash_amount,bank_after,cash_after,product_id,note')
    .eq('category', 'Sale')
    .in('product_id', productIds)
    .order('date', { ascending: true })

  if (txError) throw txError

  const batches = saleInstallmentProducts.reduce((map, product) => {
    const key = batchKey(product)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(product)
    return map
  }, new Map())

  let repaired = 0

  for (const batchProducts of batches.values()) {
    const ids = new Set(batchProducts.map(p => p.id))
    const batchTxs = (txs || []).filter(tx => ids.has(tx.product_id))
    if (!batchTxs.length) continue

    const totalDue = batchProducts.reduce((sum, product) => sum + num(product.installment_total), 0)
    const totalPaid = batchTxs.reduce((sum, tx) => sum + num(tx.amount), 0)
    const missing = Math.round(totalDue - totalPaid)
    if (missing !== 1) continue

    const paidByProduct = batchTxs.reduce((map, tx) => {
      map[tx.product_id] = (map[tx.product_id] || 0) + num(tx.amount)
      return map
    }, {})
    const productWithMissingBaht = batchProducts.find(product => (
      Math.round(num(product.installment_total) - num(paidByProduct[product.id])) === missing
    ))
    const candidateTxs = productWithMissingBaht
      ? batchTxs.filter(tx => tx.product_id === productWithMissingBaht.id)
      : batchTxs
    const targetTx = [...candidateTxs].sort((a, b) => (
      txTime(b) - txTime(a) || txCreatedTime(b) - txCreatedTime(a)
    ))[0]
    if (!targetTx) continue

    const account = receiptAccount(targetTx)
    const hasSplit = targetTx.bank_amount != null || targetTx.cash_amount != null
    const txUpdate = {
      amount: num(targetTx.amount) + missing,
    }
    if (hasSplit) {
      if (account === 'bank') txUpdate.bank_amount = num(targetTx.bank_amount) + missing
      else txUpdate.cash_amount = num(targetTx.cash_amount) + missing
    }

    const { error: updateTxError } = await supabase
      .from('transactions')
      .update(txUpdate)
      .eq('id', targetTx.id)
    if (updateTxError) throw updateTxError

    const snapshotTxs = (txs || []).filter(tx => (
      tx.bank_after != null
      && tx.cash_after != null
      && isAtOrAfterTx(tx, targetTx)
    ))
    for (const snapshotTx of snapshotTxs) {
      const snapshotUpdate = account === 'bank'
        ? { bank_after: num(snapshotTx.bank_after) + missing }
        : { cash_after: num(snapshotTx.cash_after) + missing }
      const { error: snapshotError } = await supabase
        .from('transactions')
        .update(snapshotUpdate)
        .eq('id', snapshotTx.id)
      if (snapshotError) throw snapshotError
    }

    const { data: balance } = await supabase
      .from('balances')
      .select('bank,cash')
      .eq('id', 'main')
      .maybeSingle()
    if (balance) {
      const balanceUpdate = account === 'bank'
        ? { bank: num(balance.bank) + missing, updated_at: new Date().toISOString() }
        : { cash: num(balance.cash) + missing, updated_at: new Date().toISOString() }
      const { error: balanceError } = await supabase
        .from('balances')
        .update(balanceUpdate)
        .eq('id', 'main')
      if (balanceError) throw balanceError
    }

    const soldAt = targetTx.date || new Date().toISOString()
    const warranty = new Date(new Date(soldAt).getTime() + 15 * 86400000).toISOString()
    for (const product of batchProducts) {
      const { error: productUpdateError } = await supabase
        .from('products')
        .update({
          installment_paid: num(product.installment_total),
          status: 'Sold',
          sold_price: num(product.installment_total),
          sold_date: product.sold_date || soldAt,
          warranty_expiry: product.warranty_expiry || warranty,
        })
        .eq('id', product.id)
      if (productUpdateError) throw productUpdateError
    }

    repaired += 1
  }

  return { repaired }
}
