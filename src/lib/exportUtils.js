import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { thDate, thDateShort } from './dateUtils.js'
import { roundMoney } from './money.js'
import { buildStockMap } from './stockLedger.js'

const STATUS_TH = { Available: 'พร้อมขาย', Reserved: 'จอง', Sold: 'ขายแล้ว', Pending: 'รอชำระ' }
const PRODUCT_CATEGORY_ORDER = ['กล้อง','เลนส์','แฟลช','อุปกรณ์','กล้องดิจิตอลเก่า','อื่นๆ']
const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')
const safeStr = s => (s || '').replace(/[/\\:*?"<>|]/g, '_')
const PROFIT_DEDUCT_CATS = new Set(['Shipping','Marketing','Operating','Other'])
const vatDocumentOf = tx => Array.isArray(tx?.vat_documents) ? tx.vat_documents[0] : tx?.vat_documents
const amountBeforeVat = (amount, document) => {
  const gross = Number(amount || 0)
  const total = Number(document?.total_amount || 0)
  const subtotal = Number(document?.subtotal || 0)
  if (!document || document.status === 'void' || total <= 0 || subtotal < 0) return gross
  return roundMoney(gross * subtotal / total)
}
const profitAfterVat = (saleAmount, cost, transaction) => roundMoney(
  amountBeforeVat(saleAmount, vatDocumentOf(transaction)) - Number(cost || 0),
)
const productProfitAfterVat = product => roundMoney(
  amountBeforeVat(product?.sold_price, product?._vatDocument) - Number(product?.total_cost || 0),
)
const appendVatDocumentNumbers = (note, transactions) => {
  const numbers = [...new Set((transactions || [])
    .map(transaction => vatDocumentOf(transaction))
    .filter(document => document?.status !== 'void' && String(document?.document_number || '').trim())
    .map(document => String(document.document_number).trim()))]
  if (!numbers.length) return note
  return [note, numbers.map(number => `(${number})`).join('\n')].filter(Boolean).join('\n\n')
}
const inventoryReportNote = product => {
  const addOns = (product?.report_add_ons || []).map(addOn => {
    const purchasedDate = addOn.purchased_at ? ` (${thDateShort(addOn.purchased_at)})` : ''
    return `- ${addOn.name || 'อุปกรณ์เสริม'} ฿${Number(addOn.cost || 0).toLocaleString('th-TH')}${purchasedDate}`
  })
  const accessoryBlock = addOns.length ? `อุปกรณ์เสริม\n${addOns.join('\n')}` : ''
  return [accessoryBlock, String(product?.notes || '').trim()].filter(Boolean).join('\n\n')
}
const THAI_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']
const dateAtLocalMidnight = value => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`) : null
const isLastDayOfMonth = date => date && date.getDate() === new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
const localDateKey = value => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
const accountReportTitle = (from, to) => {
  const start = dateAtLocalMidnight(from)
  const end = dateAtLocalMidnight(to)
  if (!start || !end) return 'รายงานรายการบัญชี'
  const sameYear = start.getFullYear() === end.getFullYear()
  const sameMonth = sameYear && start.getMonth() === end.getMonth()
  const buddhistYear = year => year + 543
  if (sameYear && start.getMonth() === 0 && start.getDate() === 1 && end.getMonth() === 11 && end.getDate() === 31) {
    return `รายงานรายการบัญชีทั้งปี ${buddhistYear(start.getFullYear())} เดือน มกราคม - ธันวาคม`
  }
  if (sameMonth && start.getDate() === 1 && isLastDayOfMonth(end)) {
    return `รายงานรายการบัญชี เดือน ${THAI_MONTHS[start.getMonth()]} ${buddhistYear(start.getFullYear())}`
  }
  if (sameMonth && start.getDate() === end.getDate()) {
    return `รายงานรายการบัญชี วันที่ ${start.getDate()} ${THAI_MONTHS[start.getMonth()]} ${buddhistYear(start.getFullYear())}`
  }
  const startText = `${start.getDate()} ${THAI_MONTHS[start.getMonth()]}${sameYear ? '' : ` ${buddhistYear(start.getFullYear())}`}`
  const endText = `${end.getDate()} ${THAI_MONTHS[end.getMonth()]} ${buddhistYear(end.getFullYear())}`
  return `รายงานรายการบัญชี วันที่ ${startText} - ${endText}`
}
const buildSaleInstallmentMetaByTransactionId = transactions => {
  const installmentSets = new Map()
  ;(transactions || []).forEach(tx => {
    if (tx.category !== 'Sale') return
    const batchId = tx.products?.sale_batch_id
    const productId = tx.product_id || tx.products?.id
    if (!batchId && !tx.products?.installment_total) return
    const key = batchId ? `batch:${batchId}` : `product:${productId}`
    if (!installmentSets.has(key)) installmentSets.set(key, [])
    installmentSets.get(key).push(tx)
  })

  const result = new Map()
  installmentSets.forEach((transactionsInSet, installmentKey) => {
    const paymentGroups = new Map()
    transactionsInSet.forEach(tx => {
      const eventKey = installmentKey.startsWith('batch:')
        ? `${tx.date || ''}:${tx.payment_method || ''}`
        : `tx:${tx.id}`
      if (!paymentGroups.has(eventKey)) paymentGroups.set(eventKey, { date: tx.date, txs: [] })
      paymentGroups.get(eventKey).txs.push(tx)
    })

    const seenProducts = new Set()
    const totalDue = transactionsInSet.reduce((sum, tx) => {
      const productKey = tx.product_id || tx.products?.id || tx.id
      if (seenProducts.has(productKey)) return sum
      seenProducts.add(productKey)
      return sum + Number(tx.products?.installment_total || tx.products?.sold_price || tx.amount || 0)
    }, 0)
    const orderedPayments = [...paymentGroups.values()].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))
    let paidSoFar = 0
    const firstPaymentDate = orderedPayments[0]?.date || null
    orderedPayments.forEach((paymentGroup, index) => {
      const paidThisRound = paymentGroup.txs.reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
      paidSoFar += paidThisRound
      const remainingAfter = Math.max(0, totalDue - paidSoFar)
      const paymentHistory = orderedPayments.slice(0, index).map((priorPayment, priorIndex) => ({
        installmentNumber: priorIndex + 1,
        date: priorPayment.date,
      }))
      const meta = {
        installmentNumber: index + 1,
        paidThisRound,
        paidSoFar,
        totalDue,
        remainingAfter,
        firstPaymentDate,
        paymentHistory,
        isFinalInstallment: totalDue > 0 && remainingAfter <= 0,
        hasInstallments: orderedPayments.length > 1 || remainingAfter > 0,
        vatDocument: transactionsInSet.map(vatDocumentOf).find(document => document && document.status !== 'void') || null,
      }
      if (meta.hasInstallments) paymentGroup.txs.forEach(tx => result.set(tx.id, meta))
    })
  })
  return result
}
const buildBalanceMap = (txs, balance) => {
  const map = {}
  if (!balance) return map
  let runBank = Number(balance.bank || 0)
  let runCash = Number(balance.cash || 0)
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i]
    const nextTx = txs[i + 1]
    if (tx.bank_after != null && tx.cash_after != null) {
      runBank = Number(tx.bank_after)
      runCash = Number(tx.cash_after)
    }
    map[tx.id] = { bank: runBank, cash: runCash }
    if (tx.bank_after != null && tx.cash_after != null && nextTx?.bank_after != null && nextTx?.cash_after != null) {
      runBank = Number(nextTx.bank_after)
      runCash = Number(nextTx.cash_after)
    } else if (tx.bank_amount != null || tx.cash_amount != null) {
      const bAmt = Number(tx.bank_amount || 0)
      const cAmt = Number(tx.cash_amount || 0)
      if (tx.type === 'Income') { runBank -= bAmt; runCash -= cAmt }
      else { runBank += bAmt; runCash += cAmt }
    } else {
      const amt = Number(tx.amount || 0)
      if (tx.type === 'Income') {
        if (tx.payment_method === 'โอน') runBank -= amt
        else runCash -= amt
      } else {
        if (tx.payment_method === 'โอน') runBank += amt
        else runCash += amt
      }
    }
  }
  return map
}
const txProductCost = t => (
  t.category === 'Buy Stock'
    ? Number(t.products?.batch_total_cost || t.products?.total_cost || 0)
    : Number(t.products?.total_cost || 0)
)
const sortProductsForStockPDF = products => {
  const categoryRank = category => {
    const index = PRODUCT_CATEGORY_ORDER.indexOf(category || 'กล้อง')
    return index === -1 ? PRODUCT_CATEGORY_ORDER.length : index
  }
  return [...products].sort((a, b) => (
    categoryRank(a.category) - categoryRank(b.category) ||
    String(a.model || '').localeCompare(String(b.model || ''), 'th', { numeric: true, sensitivity: 'base' }) ||
    String(a.serial_number || '').localeCompare(String(b.serial_number || ''), 'th', { numeric: true, sensitivity: 'base' })
  ))
}

// ─── Generate Import Template ─────────────────────────────────
export function downloadImportTemplate() {
  const wb = XLSX.utils.book_new()

  // Sheet 1: Products
  const pData = [
    ['ชื่อรุ่น *','Serial Number *','ประเภท *','เกรดสภาพ * (1-5)','ราคาซื้อ (บาท) *','สถานะ *','ราคาขาย (บาท)','ช่องทางชำระ','วันที่รับเข้า (DD/MM/YYYY HH.mm)','วันที่ขาย (DD/MM/YYYY HH.mm)','หมายเหตุ'],
    ['Fujifilm X100V','AB12345','กล้อง',4,28000,'Available','','','01/04/2568 10.00','','ตัวอย่าง — ลบแถวนี้ออก'],
    ['Sony A7III','CD67890','กล้อง',5,55000,'Sold',65000,'โอน','15/03/2568 09.00','20/03/2568 15.30','ตัวอย่าง — ลบแถวนี้ออก'],
  ]
  const ws1 = XLSX.utils.aoa_to_sheet(pData)
  ws1['!cols'] = [20,18,12,16,18,14,18,14,26,26,20].map(w=>({wch:w}))
  XLSX.utils.book_append_sheet(wb, ws1, 'สต็อกสินค้า')

  // Sheet 2: Transactions
  const tData = [
    ['วันที่ * (DD/MM/YYYY HH.mm)','ประเภท * (Income/Expense)','หมวดหมู่ *','จำนวนเงิน (บาท) *','หมายเหตุ'],
    ['01/04/2568 10.00','Expense','Buy Stock',28000,'ตัวอย่าง — ลบแถวนี้ออก'],
    ['20/03/2568 15.30','Income','Sale',65000,'ตัวอย่าง — ลบแถวนี้ออก'],
    ['01/04/2568 09.00','Expense','Marketing',500,'ตัวอย่าง — ลบแถวนี้ออก'],
  ]
  const ws2 = XLSX.utils.aoa_to_sheet(tData)
  ws2['!cols'] = [28,22,16,20,30].map(w=>({wch:w}))
  XLSX.utils.book_append_sheet(wb, ws2, 'รายการบัญชี')

  XLSX.writeFile(wb, 'camshop_import_template.xlsx')
}

function write(rows, sheet, filename) {
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = Object.keys(rows[0] || {}).map(() => ({ wch: 20 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheet)
  XLSX.writeFile(wb, filename)
}

export async function exportInventory(products, statusFilter = 'all') {
  const buffer = await buildInventoryXLSX(products, statusFilter)
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `สต็อกสินค้า_${stamp()}.xlsx`
  anchor.click()
  URL.revokeObjectURL(url)
}

const accountPaymentText = (tx, type) => {
  if (tx.type !== type || Number(tx.amount || 0) === 0) return ''
  const bank = Number(tx.bank_amount || 0)
  const cash = Number(tx.cash_amount || 0)
  if (bank || cash) return [
    bank ? `${bank.toLocaleString('th-TH')}\nโอน` : '',
    cash ? `${cash.toLocaleString('th-TH')}\nเงินสด` : '',
  ].filter(Boolean).join('\n')
  const method = tx.payment_method === 'เงินสด' ? 'เงินสด' : tx.payment_method || 'ไม่ระบุช่องทาง'
  return `${Number(tx.amount || 0).toLocaleString('th-TH')}\n${method}`
}

const excelReportGroupKey = tx => {
  const batchId = tx.category === 'Sale' ? tx.products?.sale_batch_id : tx.category === 'Buy Stock' ? tx.products?.batch_id : null
  return batchId ? `${tx.category}:${batchId}:${tx.date || ''}:${tx.payment_method || ''}` : `tx:${tx.id}`
}
const excelReportGroups = transactions => {
  const groups = []
  const map = new Map()
  transactions.forEach(tx => {
    const key = excelReportGroupKey(tx)
    if (!map.has(key)) {
      const group = { key, txs: [] }
      map.set(key, group)
      groups.push(group)
    }
    map.get(key).txs.push(tx)
  })
  return groups
}
const excelNumberText = value => Number(value || 0).toLocaleString('th-TH')
const excelPaymentLines = txs => {
  const bank = txs.reduce((sum, tx) => sum + Number(tx.bank_amount || 0), 0)
  const cash = txs.reduce((sum, tx) => sum + Number(tx.cash_amount || 0), 0)
  if (bank || cash) return [
    bank ? `• โอน ฿${excelNumberText(bank)}` : '',
    cash ? `• เงินสด ฿${excelNumberText(cash)}` : '',
  ].filter(Boolean)
  const total = txs.reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
  const method = txs.find(tx => tx.payment_method)?.payment_method || txs.find(tx => tx.products?.payment_method)?.products?.payment_method
  return [method ? `• ${method === 'เงินสด' ? 'เงินสด' : method} ฿${excelNumberText(total)}` : '• ไม่ระบุช่องทาง']
}
const excelPaymentAmountText = (txs, type) => {
  const relevant = txs.filter(tx => tx.type === type)
  const bank = relevant.reduce((sum, tx) => sum + Number(tx.bank_amount || 0), 0)
  const cash = relevant.reduce((sum, tx) => sum + Number(tx.cash_amount || 0), 0)
  if (bank || cash) return [
    bank ? `${excelNumberText(bank)}\nโอน` : '',
    cash ? `${excelNumberText(cash)}\nเงินสด` : '',
  ].filter(Boolean).join('\n')
  const total = relevant.reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
  if (!total) return ''
  const rawMethod = relevant.find(tx => tx.payment_method)?.payment_method || ''
  const method = rawMethod === 'แบ่งจ่าย' ? 'ไม่ระบุช่องทาง' : rawMethod === 'เงินสด' ? 'เงินสด' : rawMethod || 'ไม่ระบุช่องทาง'
  return `${excelNumberText(total)}\n${method}`
}
const excelInstallmentPaymentLines = (txs, installmentNumber) => {
  const bank = txs.reduce((sum, tx) => sum + Number(tx.bank_amount || 0), 0)
  const cash = txs.reduce((sum, tx) => sum + Number(tx.cash_amount || 0), 0)
  if (bank || cash) return [
    bank ? `• งวดที่ ${installmentNumber} : โอน ฿${excelNumberText(bank)}` : '',
    cash ? `• งวดที่ ${installmentNumber} : เงินสด ฿${excelNumberText(cash)}` : '',
  ].filter(Boolean)
  const total = txs.reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
  const method = txs.find(tx => tx.payment_method)?.payment_method || 'ไม่ระบุช่องทาง'
  return [`• งวดที่ ${installmentNumber} : ${method === 'เงินสด' ? 'เงินสด' : method} ฿${excelNumberText(total)}`]
}
const excelIsAutomaticNote = (note, tx) => {
  const text = String(note || '').trim()
  if (!text) return true
  const model = String(tx.products?.model || '')
  return text.startsWith('ซื้อสินค้า') || text.startsWith('ขายสินค้า:') || text.startsWith('ขายรวม') ||
    text.startsWith('ผ่อนจ่าย') || text.startsWith('ชำระครบ') || text.startsWith('ผ่อนจ่ายขายรวม') || text.startsWith('แลกเปลี่ยน') ||
    (model && text.includes(model) && /SN:|ราคา|ชำระ/.test(text))
}
const excelProductNote = product => {
  const note = String(product?.notes || '').trim()
  return note && !note.startsWith('แลกเปลี่ยน') ? note : ''
}
const excelAddOnLines = product => (product?.report_add_ons || []).map(addOn => {
  const purchasedDate = addOn.purchased_at ? ` (${thDateShort(addOn.purchased_at)})` : ''
  return `+ ${addOn.name || 'อุปกรณ์เสริม'} ฿${excelNumberText(addOn.cost)}${purchasedDate}`
})
const excelPurchaseItemCost = product => {
  if (product?.base_cost != null) return Number(product.base_cost || 0)
  const addOnTotal = (product?.report_add_ons || []).reduce((sum, addOn) => sum + Number(addOn.cost || 0), 0)
  return Math.max(0, Number(product?.total_cost || 0) - addOnTotal)
}
const excelReportItems = group => {
  const representative = group.txs[0]
  if (representative.category === 'Trade') {
    const tradeItemB = representative.products?.trade_item_b
    return [
      { tx: representative, product: representative.products || {}, amount: Number(representative.trade_sell_a || 0), role: 'A' },
      ...(tradeItemB ? [{ tx: null, product: tradeItemB, amount: Number(tradeItemB.total_cost || 0), role: 'B' }] : []),
    ]
  }
  if (representative.category === 'Buy Stock' && representative.products?.batch_items?.length > 1) {
    return representative.products.batch_items.map((product, index) => ({
      tx: index === 0 ? representative : null,
      product,
      amount: excelPurchaseItemCost(product),
    }))
  }
  return group.txs.map(tx => ({
    tx,
    product: tx.products || {},
    amount: Number(tx.products?.installment_total || tx.products?.sold_price || tx.amount || 0),
  }))
}
const excelTradeSideLines = (representative, prefix, fallbackModel, fallbackPrice, priceLabel) => {
  const segments = String(representative.note || '').split('|').map(segment => segment.trim())
  const segment = segments.find(value => value.startsWith(`${prefix}:`))
  const source = segment ? segment.slice(2).trim() : ''
  const entries = []
  const pattern = /(?:^|,\s*)(.+?)\s+฿(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)(?=,\s*|$)/g
  let match
  while ((match = pattern.exec(source)) !== null) entries.push({ model: match[1].trim(), price: Number(match[2].replace(/,/g, '')) })
  if (!entries.length) entries.push({ model: fallbackModel || '-', price: Number(fallbackPrice || 0) })
  return entries.map((entry, index) => `${prefix}${entries.length > 1 ? index + 1 : ''}: ${entry.model} | ${priceLabel} ฿${excelNumberText(entry.price)}`)
}
const excelReportNote = (group, groupIndex, installment, items) => {
  const representative = group.txs[0]
  const productList = items.map(item => item.product)
  const isGrouped = items.length > 1
  const action = representative.category === 'Sale' ? 'ขายสินค้า' : representative.category === 'Buy Stock' ? 'ซื้อสินค้า' : ''
  const adminNotes = [...new Set(group.txs.filter(tx => !excelIsAutomaticNote(tx.note, tx)).map(tx => String(tx.note).trim()))]
  const reportNotes = [
    ...adminNotes,
    ...(representative.category === 'Trade' ? productList.map(excelProductNote).filter(Boolean) : []),
  ]
  const itemLines = isGrouped
    ? productList.map((product, index) => [
        `-${product.model || '-'}`,
        `SN:${product.serial_number || '-'}`,
        ...(representative.category === 'Sale' ? excelAddOnLines(product) : []),
        `฿${excelNumberText(items[index].amount)}`,
        excelProductNote(product),
      ].filter(Boolean).join('\n')).join('\n\n')
    : productList.length && action
    ? [
        `${action}: ${productList[0].model || '-'}`,
        `SN:${productList[0].serial_number || '-'}`,
        ...(representative.category === 'Sale' ? excelAddOnLines(productList[0]) : []),
        excelProductNote(productList[0]),
      ].filter(Boolean).join('\n')
    : ''
  const installmentItemLines = productList.map((product, index) => [
    `-${product.model || '-'}`,
    `SN:${product.serial_number || '-'}`,
    ...(representative.category === 'Sale' ? excelAddOnLines(product) : []),
    `฿${excelNumberText(items[index].amount)}${excelProductNote(product) ? ` ${excelProductNote(product)}` : ''}`,
  ].filter(Boolean).join('\n')).join('\n\n')
  const openingCategories = new Set(['', 'Opening Balance', 'เงินตั้งต้น', 'รายรับ/จ่ายที่ไม่มีผลกับกำไร'])
  const legacyOpening = representative.category === 'Other' && Number(representative.bank_amount || 0) > 0 && Number(representative.cash_amount || 0) > 0
  const isOpening = groupIndex === 0 && representative.type === 'Income' && !representative.product_id && (
    openingCategories.has(String(representative.category || '')) || legacyOpening || /เงินตั้งต้น|ยอดตั้งต้น/.test(String(representative.note || ''))
  )
  if (isOpening) return `เงินตั้งต้น\nการชำระ:\n${excelPaymentLines(group.txs).join('\n')}`
  if (installment) {
    const title = installment.installmentNumber === 1
      ? `${isGrouped ? `ขายสินค้ารวม ${items.length} รายการ` : 'ขายสินค้า'} (ผ่อนจ่าย)`
      : `รับผ่อนงวดที่ ${installment.installmentNumber} ${isGrouped ? `สินค้ารวม ${items.length} รายการ` : 'สินค้า 1 รายการ'}${installment.isFinalInstallment ? ' (งวดปิดยอด)' : ' (ผ่อนจ่าย)'}`
    const history = (installment.paymentHistory || []).map(payment => `งวดที่ ${payment.installmentNumber} วันที่ ${thDate(payment.date)}`).join('\n')
    return [
      title,
      installmentItemLines,
      `การชำระ:\n${[
        ...excelInstallmentPaymentLines(group.txs, installment.installmentNumber),
        installment.isFinalInstallment ? '• งวดปิดยอดไม่มีค้างชำระ' : `• ค้างชำระ : ฿${excelNumberText(installment.remainingAfter)}`,
      ].join('\n')}`,
      history,
      ...adminNotes,
    ].filter(Boolean).join('\n\n')
  }
  if (representative.category === 'Trade') {
    const tradeSell = Number(representative.trade_sell_a || 0)
    const tradeBuy = representative.products?.trade_item_b?.total_cost != null
      ? Number(representative.products.trade_item_b.total_cost)
      : Math.max(0, tradeSell - (representative.type === 'Income' ? Number(representative.amount || 0) : -Number(representative.amount || 0)))
    const difference = tradeSell - tradeBuy
    const tradePayment = difference === 0 ? [] : excelPaymentLines(group.txs)
    return [
      'แลกเปลี่ยนสินค้า',
      ...excelTradeSideLines(representative, 'A', representative.products?.model, tradeSell, 'ราคาขาย'),
      'แลกกับ',
      ...excelTradeSideLines(representative, 'B', representative.products?.trade_item_b?.model, tradeBuy, 'ราคาซื้อ'),
      difference > 0 ? `ลูกค้าจ่ายเพิ่ม ฿${excelNumberText(difference)}` : difference < 0 ? `ร้านจ่ายคืน ฿${excelNumberText(Math.abs(difference))}` : 'แลกเท่ากันพอดี',
      tradePayment.length ? `การชำระ:\n${tradePayment.join('\n')}` : '',
      ...reportNotes,
    ].filter(Boolean).join('\n')
  }
  if (representative.category === 'Add-on') {
    const addOnName = String(representative.note || '').replace(/^Add-on:\s*/i, '').split(/\s+[—-]\s+/)[0].trim()
    return [
      `อุปกรณ์เสริม: ${addOnName || 'ไม่ระบุ'}`,
      `${representative.products?.model || '-'}${representative.products?.created_at ? ` (${thDateShort(representative.products.created_at)})` : ''}`,
      `ต้นทุนรวมตอนนี้ ฿${excelNumberText(representative.products?.total_cost || 0)}`,
    ].join('\n')
  }
  return [
    isGrouped && action ? `${action}รวม ${items.length} รายการ` : itemLines,
    isGrouped ? itemLines : '',
    action ? `การชำระ:\n${excelPaymentLines(group.txs).join('\n')}` : '',
    ...adminNotes,
  ].filter(Boolean).join('\n\n')
}

const ACCOUNT_XLSX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="9">
    <font><sz val="10"/><color rgb="FF2E1D19"/><name val="Sarabun"/></font>
    <font><b/><sz val="16"/><color rgb="FFD32F23"/><name val="Sarabun"/></font>
    <font><b/><sz val="9"/><color rgb="FFFFFFFF"/><name val="Sarabun"/></font>
    <font><sz val="9"/><color rgb="FF2E1D19"/><name val="Sarabun"/></font>
    <font><b/><sz val="8"/><color rgb="FF7B5A56"/><name val="Sarabun"/></font>
    <font><b/><sz val="12"/><color rgb="FF16A34A"/><name val="Sarabun"/></font>
    <font><b/><sz val="12"/><color rgb="FFD32F23"/><name val="Sarabun"/></font>
    <font><b/><sz val="9"/><color rgb="FF2E1D19"/><name val="Sarabun"/></font>
    <font><sz val="7.5"/><color rgb="FF2E1D19"/><name val="Sarabun"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD32F23"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF8F7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF1EF"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFF5CDC9"/></left><right style="thin"><color rgb="FFF5CDC9"/></right><top style="thin"><color rgb="FFF5CDC9"/></top><bottom style="thin"><color rgb="FFF5CDC9"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="18">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="4" fontId="3" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="4" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="4" fontId="5" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="4" fontId="6" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="7" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="8" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="8" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="4" fontId="7" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleMedium4"/>
</styleSheet>`

const styleAccountWorkbookBuffer = async (buffer, { dataStartRow, dataEndRow, totalsRow, footerRow, bandIndexes = [], rowHeights = [] }) => {
  const zip = await JSZip.loadAsync(buffer)
  let sheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string')
  const numericColumns = new Set(['D','E','F','G','H','I','M','P','Q','R'])
  const centeredColumns = new Set(['A','B','C','J','L'])
  sheetXml = sheetXml.replace(/<c r="([A-Z]+)(\d+)"([^>]*)>/g, (tag, column, rowText, rest) => {
    const row = Number(rowText)
    let style = 0
    if (row === 1) style = column < 'N' ? 1 : 11
    else if (row === 3) style = 7
    else if (row === 4) style = ['D','M'].includes(column) ? 9 : 8
    else if (row === 5) style = 12
    else if (row === 6) style = 2
    else if (row >= dataStartRow && row <= dataEndRow) {
      const alternate = Number(bandIndexes[row - dataStartRow] || 0) % 2 === 1
      style = ['N','O'].includes(column)
        ? (alternate ? 16 : 15)
        : numericColumns.has(column)
          ? (alternate ? 6 : 5)
          : centeredColumns.has(column)
            ? (alternate ? 14 : 13)
            : (alternate ? 4 : 3)
    } else if (row === totalsRow) style = numericColumns.has(column) ? 17 : 10
    else if (row === footerRow) style = 10
    return `<c r="${column}${rowText}" s="${style}"${rest}>`
  })
  sheetXml = sheetXml.replace(/<row r="(\d+)"([^>]*)>/g, (tag, rowText, rest) => {
    const row = Number(rowText)
    const dataHeight = rowHeights[row - dataStartRow]
    const height = row === 1 ? 28 : row === 3 ? 20 : row === 4 ? 26 : row === 6 ? 34 : row === totalsRow ? 26 : row === footerRow ? 28 : row >= dataStartRow && row <= dataEndRow ? (dataHeight || 40) : 20
    return `<row r="${rowText}" ht="${height}" customHeight="1"${rest}>`
  })
  sheetXml = sheetXml.replace('<sheetView workbookViewId="0"/>', '<sheetView showGridLines="0" workbookViewId="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/></sheetView>')
  sheetXml = sheetXml.replace(/<pageMargins[^>]*\/>/g, '')
  sheetXml = sheetXml.replace(/<pageSetup[^>]*\/>/g, '')
  sheetXml = sheetXml.replace('</worksheet>', '<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>')
  zip.file('xl/styles.xml', ACCOUNT_XLSX_STYLES)
  zip.file('xl/worksheets/sheet1.xml', sheetXml)
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

const styleInventoryWorkbookBuffer = async (buffer, { dataStartRow, dataEndRow, totalsRow, footerRow, rowHeights = [] }) => {
  const zip = await JSZip.loadAsync(buffer)
  let sheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string')
  const numericColumns = new Set(['G','H','I','J'])
  const centeredColumns = new Set(['A','D','E','F','K','L'])
  sheetXml = sheetXml.replace(/<c r="([A-Z]+)(\d+)"([^>]*)>/g, (tag, column, rowText, rest) => {
    const row = Number(rowText)
    let style = 0
    if (row === 1) style = column < 'K' ? 1 : 11
    else if (row === 3) style = 7
    else if (row === 4) style = ['G','K'].includes(column) ? 9 : 8
    else if (row === 5) style = 12
    else if (row === 6) style = 2
    else if (row >= dataStartRow && row <= dataEndRow) {
      const alternate = (row - dataStartRow) % 2 === 1
      style = ['M','N'].includes(column)
        ? (alternate ? 16 : 15)
        : numericColumns.has(column)
          ? (alternate ? 6 : 5)
          : centeredColumns.has(column)
            ? (alternate ? 14 : 13)
            : (alternate ? 4 : 3)
    } else if (row === totalsRow) style = numericColumns.has(column) ? 17 : 10
    else if (row === footerRow) style = 10
    return `<c r="${column}${rowText}" s="${style}"${rest}>`
  })
  sheetXml = sheetXml.replace(/<row r="(\d+)"([^>]*)>/g, (tag, rowText, rest) => {
    const row = Number(rowText)
    const dataHeight = rowHeights[row - dataStartRow]
    const height = row === 1 ? 28 : row === 3 ? 20 : row === 4 ? 26 : row === 6 ? 34 : row === totalsRow ? 26 : row === footerRow ? 28 : row >= dataStartRow && row <= dataEndRow ? (dataHeight || 42) : 20
    return `<row r="${rowText}" ht="${height}" customHeight="1"${rest}>`
  })
  sheetXml = sheetXml.replace('<sheetView workbookViewId="0"/>', '<sheetView showGridLines="0" workbookViewId="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/></sheetView>')
  sheetXml = sheetXml.replace(/<pageMargins[^>]*\/>/g, '')
  sheetXml = sheetXml.replace(/<pageSetup[^>]*\/>/g, '')
  sheetXml = sheetXml.replace('</worksheet>', '<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>')
  zip.file('xl/styles.xml', ACCOUNT_XLSX_STYLES)
  zip.file('xl/worksheets/sheet1.xml', sheetXml)
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

export async function buildInventoryXLSX(products, statusFilter = 'all') {
  const filtered = sortProductsForStockPDF(products.filter(product => statusFilter === 'all' || product.status === statusFilter))
  if (!filtered.length) throw new Error('ไม่มีข้อมูล')
  const totalBaseCost = roundMoney(filtered.reduce((sum, product) => sum + Number(product.base_cost || 0), 0))
  const totalCost = roundMoney(filtered.reduce((sum, product) => sum + Number(product.total_cost || 0), 0))
  const totalSold = roundMoney(filtered.reduce((sum, product) => sum + Number(product.sold_price || 0), 0))
  const totalProfit = roundMoney(filtered.reduce((sum, product) => sum + (product.sold_price ? productProfitAfterVat(product) : 0), 0))
  const soldCount = filtered.filter(product => product.status === 'Sold').length
  const title = `รายงานสต็อกสินค้า - ${statusFilter === 'all' ? 'ทั้งหมด' : STATUS_TH[statusFilter] || statusFilter}`
  const header = ['ลำดับ','รุ่น','Serial Number','ประเภท','เกรดสภาพ','สถานะ','ต้นทุนเริ่มต้น','ต้นทุนรวม','ราคาขาย','กำไร','วันที่รับเข้า','วันที่ขาย','รายละเอียดลูกค้า','หมายเหตุ']
  const reportRows = filtered.map((product, index) => [
    index + 1,
    product.model || '',
    product.serial_number || '',
    product.category || 'กล้อง',
    String(product.condition || ''),
    STATUS_TH[product.status] || product.status || '',
    Number(product.base_cost || 0),
    Number(product.total_cost || 0),
    product.sold_price ? Number(product.sold_price) : '',
    product.sold_price ? productProfitAfterVat(product) : '',
    thDate(product.created_at),
    thDate(product.sold_date),
    product.customer_note || '',
    inventoryReportNote(product),
  ])
  const rowHeights = filtered.map(product => {
    const textLineCount = Math.max(
      String(product.customer_note || '').split('\n').length,
      inventoryReportNote(product).split('\n').length,
    )
    return Math.min(120, Math.max(42, textLineCount * 12 + 8))
  })
  const emptyRow = () => Array(14).fill('')
  const rows = [
    [title, ...Array(9).fill(''), 'SMALL CAMERA CM', ...Array(3).fill('')],
    emptyRow(),
    ['จำนวนรายการ','','','ขายแล้ว','','','ต้นทุนรวม','','','','กำไรรวม','','',''],
    [filtered.length,'','',soldCount,'','',totalCost,'','','',totalProfit,'','',''],
    [`จำนวนรายการ ${filtered.length} รายการ`, ...Array(13).fill('')],
    header,
    ...reportRows,
    ['รวมตัวเลขในตาราง','','','','','',totalBaseCost,totalCost,totalSold,totalProfit,'','','',''],
    [`จำนวนทั้งหมด ${filtered.length} รายการ`,'','','',`ขายแล้ว ${soldCount} รายการ`,'','',`ต้นทุนรวม ${totalCost.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`,'','',`กำไรรวม ${totalProfit.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`,'','',''],
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const totalsRow = rows.length - 1
  const footerRow = rows.length
  ws['!merges'] = [
    { s:{r:0,c:0}, e:{r:0,c:9} }, { s:{r:0,c:10}, e:{r:0,c:13} },
    { s:{r:2,c:0}, e:{r:2,c:2} }, { s:{r:2,c:3}, e:{r:2,c:5} }, { s:{r:2,c:6}, e:{r:2,c:9} }, { s:{r:2,c:10}, e:{r:2,c:13} },
    { s:{r:3,c:0}, e:{r:3,c:2} }, { s:{r:3,c:3}, e:{r:3,c:5} }, { s:{r:3,c:6}, e:{r:3,c:9} }, { s:{r:3,c:10}, e:{r:3,c:13} },
    { s:{r:totalsRow-1,c:0}, e:{r:totalsRow-1,c:5} },
    { s:{r:footerRow-1,c:0}, e:{r:footerRow-1,c:3} }, { s:{r:footerRow-1,c:4}, e:{r:footerRow-1,c:6} },
    { s:{r:footerRow-1,c:7}, e:{r:footerRow-1,c:9} }, { s:{r:footerRow-1,c:10}, e:{r:footerRow-1,c:13} },
  ]
  ws['!cols'] = [6,24,18,15,11,16,14,14,14,14,17,17,28,32].map(wch => ({ wch }))
  ws['!autofilter'] = { ref: `A6:N${6 + reportRows.length}` }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'สต็อกสินค้า')
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return styleInventoryWorkbookBuffer(buffer, { dataStartRow: 7, dataEndRow: 6 + reportRows.length, totalsRow, footerRow, rowHeights })
}

export async function buildTransactionsXLSX(transactions, from, to, balance = null, stockValue = null, allTransactions = transactions) {
  const filtered = transactions.filter(t => {
    const d = new Date(t.date)
    if (from && d < new Date(from)) return false
    if (to   && d > new Date(to + 'T23:59:59')) return false
    return true
  })
  if (!filtered.length) throw new Error('ไม่มีข้อมูลในช่วงวันที่ที่เลือก')
  const transactionOrder = new Map(filtered.map((tx, index) => [tx.id, index]))
  const displayTransactions = [...filtered].sort((a, b) => {
    const dateDifference = new Date(a.date || 0) - new Date(b.date || 0)
    return dateDifference || (transactionOrder.get(b.id) ?? 0) - (transactionOrder.get(a.id) ?? 0)
  })
  const balMap = buildBalanceMap(filtered, balance)
  const stockMap = stockValue != null ? buildStockMap(filtered, stockValue) : {}
  const installmentByTransactionId = buildSaleInstallmentMetaByTransactionId(allTransactions)
  const countedInstall = new Set()
  const reportGroups = excelReportGroups(displayTransactions)
  const reportGroupIndexes = []
  const reportRows = []
  const verticalMerges = []
  const rowHeights = []
  const dataStartRowIndex = 6
  const mergeColumns = [0, 1, 2, 3, 4, 13, 14, 15, 16, 17]
  reportGroups.forEach((group, groupIndex) => {
    const representative = group.txs[0]
    const installment = group.txs.map(tx => installmentByTransactionId.get(tx.id)).find(Boolean) || null
    const items = excelReportItems(group)
    const isGrouped = items.length > 1
    const mergedNote = appendVatDocumentNumbers(excelReportNote(group, groupIndex, installment, items), group.txs)
    const groupCustomerDetail = [...new Set(items
      .map(item => String(item.product?.customer_note || '').trim())
      .filter(Boolean))]
      .join('\n')
    const groupIncomeText = excelPaymentAmountText(group.txs, 'Income')
    const groupExpenseText = excelPaymentAmountText(group.txs, 'Expense')
    const balanceTx = group.txs.reduce((newest, tx) => (
      (transactionOrder.get(tx.id) ?? Number.MAX_SAFE_INTEGER) < (transactionOrder.get(newest.id) ?? Number.MAX_SAFE_INTEGER) ? tx : newest
    ), representative)
    const groupBalance = balMap[balanceTx.id]
    const groupStartRow = dataStartRowIndex + reportRows.length

    items.forEach((item, itemIndex) => {
      const t = item.tx || representative
      const isSyntheticRow = !item.tx
      const vatDocument = vatDocumentOf(t)
      const hasVat = !isSyntheticRow && vatDocument && vatDocument.status !== 'void'
      const vatGross = hasVat ? Number(t.category === 'Trade' ? t.trade_sell_a : t.amount || 0) : null
      const vatBase = hasVat ? amountBeforeVat(vatGross, vatDocument) : null
      const vatAmount = hasVat ? roundMoney(vatGross - vatBase) : null
      let pl = ''
      if (!isSyntheticRow && t.category === 'Sale' && t.products?.total_cost != null) {
        if (!t.products?.installment_total) {
          pl = roundMoney((hasVat ? vatBase : Number(t.amount || 0)) - Number(t.products.total_cost || 0))
        } else if (installment?.isFinalInstallment && !countedInstall.has(t.product_id)) {
          const installmentGross = Number(t.products.installment_total || 0)
          const installmentVatDocument = installment.vatDocument || vatDocument
          const installmentNet = installmentVatDocument ? amountBeforeVat(installmentGross, installmentVatDocument) : installmentGross
          pl = roundMoney(installmentNet - Number(t.products.total_cost || 0))
          countedInstall.add(t.product_id)
        }
      } else if (!isSyntheticRow && t.category === 'Trade' && t.trade_profit_a != null) {
        const tradeCost = Number(t.trade_sell_a || 0) - Number(t.trade_profit_a || 0)
        pl = roundMoney(amountBeforeVat(Number(t.trade_sell_a || 0), vatDocument) - tradeCost)
      } else if (!isSyntheticRow && t.type === 'Expense' && PROFIT_DEDUCT_CATS.has(t.category)) {
        pl = -Number(t.amount || 0)
      }
      reportRows.push([
        itemIndex === 0 ? groupIndex + 1 : '',
        itemIndex === 0 ? thDate(representative.date) : '',
        itemIndex === 0 ? representative.category : '',
        itemIndex === 0 ? groupIncomeText : '',
        itemIndex === 0 ? groupExpenseText : '',
        hasVat ? vatBase : '',
        hasVat ? vatAmount : '',
        hasVat ? vatGross : '',
        pl,
        t.category === 'Add-on' ? 'อุปกรณ์เสริม' : item.product?.category || '',
        item.product?.model || '',
        item.product?.created_at ? thDate(item.product.created_at) : '',
        Number(t.category === 'Add-on' ? t.amount : t.category === 'Buy Stock' ? excelPurchaseItemCost(item.product) : item.product?.total_cost || 0) || '',
        itemIndex === 0 && representative.category === 'Sale' ? groupCustomerDetail : '',
        itemIndex === 0 ? mergedNote : '',
        itemIndex === 0 && balance != null ? Number(groupBalance?.bank ?? 0) : '',
        itemIndex === 0 && balance != null ? Number(groupBalance?.cash ?? 0) : '',
        itemIndex === 0 && stockValue != null ? Number(stockMap[balanceTx.id] ?? 0) : '',
      ])
      reportGroupIndexes.push(groupIndex)
    })

    const noteLineCount = Math.max(1, mergedNote.split('\n').length)
    const groupHeight = Math.max(items.length * 40, Math.min(240, noteLineCount * 13))
    items.forEach(() => rowHeights.push(Math.max(32, groupHeight / items.length)))
    if (isGrouped) {
      const groupEndRow = groupStartRow + items.length - 1
      mergeColumns.forEach(column => verticalMerges.push({ s: { r: groupStartRow, c: column }, e: { r: groupEndRow, c: column } }))
    }
  })
  const totalIncome = filtered.filter(t => t.type === 'Income').reduce((sum, t) => sum + Number(t.amount || 0), 0)
  const totalExpense = filtered.filter(t => t.type === 'Expense').reduce((sum, t) => sum + Number(t.amount || 0), 0)
  const totalProfit = roundMoney(reportRows.reduce((sum, row) => row[8] !== '' ? sum + Number(row[8]) : sum, 0))
  const totalVat = roundMoney(reportRows.reduce((sum, row) => sum + Number(row[6] || 0), 0))
  const totalSaleGross = roundMoney(reportRows.reduce((sum, row) => sum + Number(row[7] || 0), 0))
  const totalSaleAfterVat = roundMoney(totalSaleGross - totalVat)
  const profitBeforeVat = roundMoney(totalProfit + totalVat)
  const dated = displayTransactions.map(tx => localDateKey(tx.date)).filter(Boolean)
  const title = accountReportTitle(from || dated[0], to || dated[dated.length - 1])
  const header = ['ลำดับ','วันที่','หมวดหมู่','รายรับ','รายจ่าย','ราคาก่อน VAT','VAT 7%','ราคาขาย','กำไรขาดทุน','ประเภท','รุ่นกล้อง','วันที่ซื้อ','ต้นทุน','รายละเอียดลูกค้า','หมายเหตุ','ธนาคารคงเหลือ','เงินสดคงเหลือ','สต๊อกคงเหลือ']
  const emptyRow = () => Array(18).fill('')
  const rows = [
    [title, ...Array(12).fill(''), 'SMALL CAMERA CM', ...Array(4).fill('')],
    emptyRow(),
    ['เงินรับจริง','','','รวมรายจ่าย','','','กำไรขั้นต้นก่อนแยก VAT','','','ยอดขายไม่รวม VAT','','','VAT 7%','','','กำไรขั้นต้นไม่รวม VAT','',''],
    [totalIncome,'','',totalExpense,'','',profitBeforeVat,'','',totalSaleAfterVat,'','',totalVat,'','',totalProfit,'',''],
    [`จำนวนรายการ ${reportGroups.length} รายการ`, ...Array(17).fill('')],
    header,
    ...reportRows,
    ['รวมตัวเลขในตาราง','','',totalIncome,totalExpense,totalSaleAfterVat,totalVat,totalSaleGross,totalProfit,'','','',roundMoney(reportRows.reduce((sum, row) => sum + Number(row[12] || 0), 0)),'','','','',''],
    [`ยอดรวมก่อนหัก ${totalSaleGross.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`,'','','','',`รวมยอด VAT 7% ${totalVat.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`,'','','','',`ยอดรวมหลังหัก ${totalSaleAfterVat.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`,'','','',`กำไรขั้นต้นไม่รวม VAT ${totalProfit.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`,'','',''],
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const totalsRow = rows.length - 1
  const footerRow = rows.length
  ws['!merges'] = [
    { s:{r:0,c:0}, e:{r:0,c:12} }, { s:{r:0,c:13}, e:{r:0,c:17} },
    { s:{r:2,c:0}, e:{r:2,c:2} }, { s:{r:2,c:3}, e:{r:2,c:5} }, { s:{r:2,c:6}, e:{r:2,c:8} },
    { s:{r:2,c:9}, e:{r:2,c:11} }, { s:{r:2,c:12}, e:{r:2,c:14} }, { s:{r:2,c:15}, e:{r:2,c:17} },
    { s:{r:3,c:0}, e:{r:3,c:2} }, { s:{r:3,c:3}, e:{r:3,c:5} }, { s:{r:3,c:6}, e:{r:3,c:8} },
    { s:{r:3,c:9}, e:{r:3,c:11} }, { s:{r:3,c:12}, e:{r:3,c:14} }, { s:{r:3,c:15}, e:{r:3,c:17} },
    ...verticalMerges,
    { s:{r:totalsRow-1,c:0}, e:{r:totalsRow-1,c:2} },
    { s:{r:footerRow-1,c:0}, e:{r:footerRow-1,c:4} }, { s:{r:footerRow-1,c:5}, e:{r:footerRow-1,c:9} },
    { s:{r:footerRow-1,c:10}, e:{r:footerRow-1,c:13} }, { s:{r:footerRow-1,c:14}, e:{r:footerRow-1,c:17} },
  ]
  ws['!cols'] = [6,16,13,12,12,14,11,13,14,15,22,16,12,34,42,13,13,13].map(wch => ({ wch }))
  ws['!autofilter'] = { ref: `A6:R${6 + reportRows.length}` }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'รายการบัญชี')
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return styleAccountWorkbookBuffer(buffer, { dataStartRow: 7, dataEndRow: 6 + reportRows.length, totalsRow, footerRow, bandIndexes: reportGroupIndexes, rowHeights })
}

export async function exportTransactions(transactions, from, to, balance = null, stockValue = null) {
  const buffer = await buildTransactionsXLSX(transactions, from, to, balance, stockValue, transactions)
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `รายการบัญชี_${stamp()}.xlsx`
  anchor.click()
  URL.revokeObjectURL(url)
}

// ─── Shared: load Sarabun font and init jsPDF doc ────────────
async function initPDFDoc(orientation = 'landscape') {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const [regularRes, mediumRes, boldRes] = await Promise.all([
    fetch('/fonts/Sarabun-Regular.ttf'),
    fetch('/fonts/Sarabun-Medium.ttf'),
    fetch('/fonts/Sarabun-Bold.ttf'),
  ])
  const toBase64 = async response => {
    if (!response.ok) throw new Error(`โหลดฟอนต์ PDF ไม่สำเร็จ (${response.status})`)
    const buffer = await response.arrayBuffer()
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
  }
  const [regularB64, mediumB64, boldB64] = await Promise.all([
    toBase64(regularRes),
    toBase64(mediumRes),
    toBase64(boldRes),
  ])
  const doc    = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
  doc.addFileToVFS('Sarabun-Regular.ttf', regularB64)
  doc.addFileToVFS('Sarabun-Medium.ttf', mediumB64)
  doc.addFileToVFS('Sarabun-Bold.ttf', boldB64)
  doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal')
  doc.addFont('Sarabun-Bold.ttf', 'Sarabun', 'bold')
  doc.addFont('Sarabun-Medium.ttf', 'SarabunMedium', 'normal')
  doc.setFont('Sarabun')
  return { doc, autoTable }
}

const moneyText = n => `${Number(n || 0).toLocaleString('th-TH')} บาท`
const toneColor = tone => {
  if (tone === 'in') return [22, 163, 74]
  if (tone === 'out') return [220, 38, 38]
  if (tone === 'bank') return [37, 99, 235]
  if (tone === 'cash') return [22, 163, 74]
  if (tone === 'warn') return [211, 47, 35]
  return [31, 20, 18]
}
function drawReportHeader(doc, title, subtitle = '', { showCreatedAt = true, brand = 'SMALL CAMERA', plainBrand = false } = {}) {
  doc.setFillColor(255, 247, 246)
  doc.rect(0, 0, 297, 210, 'F')
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(245, 205, 201)
  doc.roundedRect(10, 8, 277, 18, 4, 4, 'FD')
  doc.setTextColor(211, 47, 35)
  doc.setFontSize(title.length > 52 ? 10.5 : 13)
  doc.text(title, 14, 18)
  if (plainBrand) {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(211, 47, 35)
    doc.setFontSize(13.5)
    doc.text(brand, 282, 18, { align: 'right' })
    doc.setFont('Sarabun', 'normal')
  } else {
    doc.setFillColor(211, 47, 35)
    doc.roundedRect(253, 11, 30, 9, 3, 3, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(9)
    doc.text(brand, brand === 'SMALL CAMERA CM' ? 255.5 : 258, 17.2)
  }
  doc.setTextColor(123, 90, 86)
  doc.setFontSize(7.5)
  if (subtitle) doc.text(subtitle, 12, 32)
  if (showCreatedAt) doc.text(`สร้างเมื่อ ${new Date().toLocaleString('th-TH')}`, 12, subtitle ? 37 : 32)
  if (subtitle && showCreatedAt) return 42
  if (subtitle || showCreatedAt) return 37
  return 31
}
function drawStatCards(doc, stats, y, { columns = null } = {}) {
  const gap = 3
  const pageW = 297
  const left = 10
  const right = 10
  const cols = columns || (stats.length > 4 ? 4 : stats.length)
  const cardW = (pageW - left - right - gap * (cols - 1)) / cols
  const cardH = 13
  stats.forEach((s, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = left + col * (cardW + gap)
    const cardY = y + row * (cardH + gap)
    doc.setFillColor(255, 255, 255)
    doc.setDrawColor(245, 205, 201)
    doc.roundedRect(x, cardY, cardW, cardH, 3, 3, 'FD')
    doc.setTextColor(123, 90, 86)
    doc.setFontSize(6.2)
    doc.text(s.label, x + 2.2, cardY + 4.5)
    doc.setTextColor(...toneColor(s.tone))
    doc.setFontSize(8.6)
    doc.text(String(s.value), x + 2.2, cardY + 10, { maxWidth: cardW - 4 })
  })
  return y + Math.ceil(stats.length / cols) * cardH + (Math.ceil(stats.length / cols) - 1) * gap + 5
}
const reportTableOptions = {
  styles: {
    font: 'Sarabun',
    fontSize: 6.9,
    cellPadding: { top: 1.25, right: 1.55, bottom: 1.25, left: 1.55 },
    lineColor: [245, 205, 201],
    lineWidth: 0.1,
    valign: 'top',
    overflow: 'linebreak',
  },
  headStyles: {
    fillColor: [211, 47, 35],
    textColor: [255, 255, 255],
    fontStyle: 'normal',
    fontSize: 7,
  },
  footStyles: {
    fillColor: [255, 241, 239],
    textColor: [31, 20, 18],
    fontStyle: 'normal',
    fontSize: 7.1,
  },
  alternateRowStyles: { fillColor: [255, 248, 247] },
  margin: { left: 10, right: 10 },
  showFoot: 'lastPage',
}
const summaryFoot = (columnCount, lines) => {
  const baseSpan = Math.floor(columnCount / lines.length)
  let remainder = columnCount % lines.length
  return [[...lines.map(line => {
    const colSpan = baseSpan + (remainder-- > 0 ? 1 : 0)
    return {
      content: line,
      colSpan,
      styles: {
        halign: 'center',
        valign: 'middle',
        fontStyle: 'normal',
        fontSize: 6.35,
        cellPadding: { top: 1.8, right: 1, bottom: 1.8, left: 1 },
      },
    }
  })]]
}

// ─── Inventory PDF blob ───────────────────────────────────────
async function buildInventoryPDF(filtered, statusFilter = 'all') {
  const sorted = sortProductsForStockPDF(filtered)
  const totalCost = sorted.reduce((a,p)=>a+Number(p.total_cost||0),0)
  const totalSold = sorted.reduce((a,p)=>p.sold_price?a+Number(p.sold_price):a,0)
  const soldCount = sorted.filter(p=>p.status==='Sold').length
  const totalProfit = sorted.reduce((a,p)=>p.sold_price?a+productProfitAfterVat(p):a,0)
  const totalBaseCost = sorted.reduce((a,p)=>a+Number(p.base_cost||0),0)
  return renderInventoryPdfFromHtml({
    title: `รายงานสต็อกสินค้า - ${statusFilter === 'all' ? 'ทั้งหมด' : STATUS_TH[statusFilter] || statusFilter}`,
    rows: sorted.map((product, index) => [
      index + 1,
      product.model || '',
      product.serial_number || '',
      product.category || 'กล้อง',
      String(product.condition || ''),
      STATUS_TH[product.status] || product.status || '',
      Number(product.base_cost || 0),
      Number(product.total_cost || 0),
      product.sold_price ? Number(product.sold_price) : '',
      product.sold_price ? productProfitAfterVat(product) : '',
      thDate(product.created_at),
      thDate(product.sold_date),
      product.customer_note || '',
      inventoryReportNote(product),
    ]),
    stats: [
      { label: 'จำนวนรายการ', value: `${sorted.length} รายการ` },
      { label: 'ขายแล้ว', value: `${soldCount} รายการ`, tone: 'in' },
      { label: 'ต้นทุนรวม', value: moneyText(totalCost), tone: 'warn' },
      { label: 'กำไรรวม', value: moneyText(totalProfit), tone: totalProfit >= 0 ? 'in' : 'out' },
    ],
    columnTotals: { baseCost: totalBaseCost, cost: totalCost, sold: totalSold, profit: totalProfit },
    summary: [
      { label: 'จำนวนทั้งหมด', value: `${sorted.length} รายการ` },
      { label: 'ขายแล้ว', value: `${soldCount} รายการ` },
      { label: 'ต้นทุนรวม', value: moneyText(totalCost) },
      { label: 'กำไรรวม', value: moneyText(totalProfit) },
    ],
  })
}

export async function previewInventoryPDFFile(products, statusFilter = 'all', previewWindow = null) {
  const filtered = products.filter(product => statusFilter === 'all' || product.status === statusFilter)
  if (!filtered.length) {
    previewWindow?.close()
    throw new Error('ไม่มีข้อมูล')
  }
  const preview = previewWindow || window.open('', '_blank')
  if (!preview) throw new Error('กรุณาอนุญาต Pop-up เพื่อเปิดตัวอย่าง PDF')
  try {
    const blob = await buildInventoryPDF(filtered, statusFilter)
    const url = URL.createObjectURL(blob)
    preview.location.replace(url)
    window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000)
    return `สต็อกสินค้า_${stamp()}.pdf`
  } catch (error) {
    preview.close()
    throw error
  }
}

// ─── Transactions PDF blob ────────────────────────────────────
const accountPdfEscape = value => String(value ?? '')
  .normalize('NFC')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

const accountPdfCellValue = cell => {
  if (cell && typeof cell === 'object' && !Array.isArray(cell)) return cell.content ?? ''
  return cell ?? ''
}

function accountPdfGroupRowsHtml(rows) {
  const activeRowSpans = Array(18).fill(0)
  const wrappedLineCount = value => String(accountPdfCellValue(value) || '').split('\n').reduce((sum, line) => (
    sum + Math.max(1, Math.ceil([...line].length / 34))
  ), 0)
  const mergedContentLines = rows.reduce((max, row) => Math.max(max, ...row.map(cell => {
    const rowSpan = Number(cell?.rowSpan || 1)
    return rowSpan > 1 ? wrappedLineCount(cell) : 0
  })), 0)
  // Match Excel's grouped layout: every product row receives an equal share of
  // the space required by the merged note/customer cells. This prevents a long
  // rowspan from compressing one product row and leaving a large blank row.
  const minimumGroupHeight = Math.max(rows.length * 54, mergedContentLines * 15 + 18)
  const rowHeight = Math.ceil(minimumGroupHeight / Math.max(1, rows.length))
  const renderCellLines = value => accountPdfEscape(value)
    .split('\n')
    .map(line => `<span class="cell-line">${line || '&nbsp;'}</span>`)
    .join('')

  return rows.map(row => {
    let column = 0
    const cells = []
    const moveToFreeColumn = () => {
      while (column < activeRowSpans.length && activeRowSpans[column] > 0) column += 1
    }
    row.forEach(rawCell => {
      moveToFreeColumn()
      const cell = rawCell && typeof rawCell === 'object' && !Array.isArray(rawCell) ? rawCell : null
      const rowSpan = Math.max(1, Number(cell?.rowSpan || 1))
      const value = accountPdfCellValue(rawCell)
      const formattedValue = [1, 11].includes(column)
        ? String(value).replace(/\s+(?=\d{2}\.\d{2}$)/, '\n')
        : value
      const numericClass = [3, 4, 5, 6, 7, 8, 12, 15, 16, 17].includes(column) ? ' numeric' : ''
      const centeredClass = [0, 1, 2, 9, 11].includes(column) ? ' centered' : ''
      cells.push(`<td data-col="${column}"${rowSpan > 1 ? ` rowspan="${rowSpan}"` : ''} class="${numericClass}${centeredClass}">${renderCellLines(formattedValue)}</td>`)
      if (rowSpan > 1) activeRowSpans[column] = rowSpan
      column += 1
    })
    for (let index = 0; index < activeRowSpans.length; index += 1) {
      if (activeRowSpans[index] > 0) activeRowSpans[index] -= 1
    }
    return `<tr style="height:${rowHeight}px">${cells.join('')}</tr>`
  }).join('')
}

async function renderTransactionsPdfFromHtml({ title, groups, stats, summary, columnTotals }) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;left:-12000px;top:0;width:1123px;height:794px;border:0;opacity:0;pointer-events:none;'
  document.body.appendChild(frame)

  const headers = ['ลำดับ','วันที่','หมวดหมู่','รายรับ','รายจ่าย','ราคาก่อน VAT','VAT 7%','ราคาขาย','กำไรขาดทุน','ประเภท','รุ่นกล้อง','วันที่ซื้อ','ต้นทุน','รายละเอียดลูกค้า','หมายเหตุ','ธนาคารคงเหลือ','เงินสดคงเหลือ','สต๊อกคงเหลือ']
  // Keep the exact relative column widths used by buildTransactionsXLSX.
  const widths = [6,16,13,12,12,14,11,13,14,15,22,16,12,34,42,13,13,13]
  const widthTotal = widths.reduce((sum, value) => sum + value, 0)
  const colgroup = `<colgroup>${widths.map(width => `<col style="width:${(width / widthTotal * 100).toFixed(4)}%">`).join('')}</colgroup>`
  const tableHead = `<thead><tr>${headers.map((header, index) => `<th data-col="${index}">${accountPdfEscape(header)}</th>`).join('')}</tr></thead>`
  const groupsHtml = groups.map((rows, index) => `<tbody class="report-group band-${index % 2}">${accountPdfGroupRowsHtml(rows)}</tbody>`)
  const statsHtml = stats.map(stat => `<div class="stat ${stat.tone || ''}"><span>${accountPdfEscape(stat.label)}</span><strong>${accountPdfEscape(stat.value)}</strong></div>`).join('')
  const summaryHtml = summary.map(item => `<div><span>${accountPdfEscape(item.label)}</span><strong>${accountPdfEscape(item.value)}</strong></div>`).join('')
  const totalCell = value => `<td class="numeric">${value ? accountPdfEscape(Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) : '-'}</td>`
  const columnTotalsHtml = `<tfoot class="column-totals"><tr>
    <td colspan="3" class="total-label">รวมตัวเลขในตาราง</td>
    ${totalCell(columnTotals.income)}${totalCell(columnTotals.expense)}${totalCell(columnTotals.vatBase)}${totalCell(columnTotals.vat)}${totalCell(columnTotals.saleGross)}${totalCell(columnTotals.profit)}
    <td></td><td></td><td></td>${totalCell(columnTotals.cost)}<td></td><td></td><td class="balance-skip"></td><td class="balance-skip"></td><td class="balance-skip"></td>
  </tr></tfoot>`
  const baseCss = `
    @font-face{font-family:PromptReport;src:url('/fonts/Prompt-Regular.ttf') format('truetype');font-weight:400;font-style:normal;font-display:block}
    @font-face{font-family:PromptReport;src:url('/fonts/Prompt-Medium.ttf') format('truetype');font-weight:500;font-style:normal;font-display:block}
    @font-face{font-family:PromptReport;src:url('/fonts/Prompt-SemiBold.ttf') format('truetype');font-weight:600 700;font-style:normal;font-display:block}
    *{box-sizing:border-box}
    @page{size:A4 landscape;margin:0}
    html,body{margin:0;background:#fff;font-family:PromptReport,Tahoma,sans-serif;color:#2e1d19;text-rendering:auto;-webkit-font-smoothing:antialiased;font-kerning:normal;font-feature-settings:'kern' 1;font-variant-ligatures:none;font-synthesis:none;letter-spacing:0;word-spacing:0}
    #measure{position:absolute;left:-9000px;top:0;width:1075px;visibility:hidden}
    .account-page{width:1123px;height:794px;padding:22px 24px;background:#fff;overflow:hidden;break-after:page;page-break-after:always;break-inside:avoid;page-break-inside:avoid}.account-page:last-child{break-after:auto;page-break-after:auto}
    .report-head{height:52px;display:flex;align-items:center;justify-content:space-between;border:1px solid #f5cdc9;border-radius:15px;padding:0 15px;margin-bottom:8px}
    .report-head h1{margin:0;font-size:17px;line-height:1.55;font-weight:600;color:#2e1d19;white-space:pre-wrap;letter-spacing:normal;word-spacing:normal}
    .brand{font-family:PromptReport,Arial,sans-serif;font-size:20px;line-height:1;font-weight:700;color:#d32f23;white-space:nowrap}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:7px}
    .stat{height:42px;border:1px solid #f5cdc9;border-radius:11px;background:#fff7f6;padding:5px 9px}
    .stat span{display:block;font-size:8.5px;line-height:1.45;color:#7b5a56;white-space:nowrap}
    .stat strong{display:block;font-size:11.5px;line-height:1.45;font-weight:600}.stat.in strong{color:#16a34a}.stat.out strong{color:#dc2626}.stat.warn strong{color:#d32f23}
    .count{height:20px;color:#7b5a56;font-size:10px;line-height:20px}
    .table-shell{border:1.25px solid #e9b7b2;overflow:visible}
    table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;background:#fff}
    thead{display:table-header-group}
    th{height:38px;background:#d32f23;color:#fff;border-right:1.25px solid #e9b7b2;border-bottom:1.25px solid #e9b7b2;padding:5px 3px;text-align:center;vertical-align:middle;font-size:8px;line-height:1.65;font-weight:600;white-space:normal;overflow-wrap:normal;word-break:normal}
    th[data-col="15"],th[data-col="16"],th[data-col="17"]{font-size:7px;padding-left:2px;padding-right:2px}
    th[data-col="17"],td[data-col="17"]{border-right:0}
    td{padding:6px 4px;border-right:1.25px solid #e9b7b2;border-bottom:1.25px solid #e9b7b2;vertical-align:middle;font-size:8.4px;line-height:1.75;font-weight:400;overflow-wrap:anywhere;word-break:normal;letter-spacing:normal;word-spacing:normal}
    .cell-line{display:block;min-height:1.75em;line-height:1.75;white-space:normal}
    .report-group:last-of-type tr:last-child td{border-bottom:0}
    .band-1 td{background:#fff8f7}.numeric{text-align:right;font-size:7.6px;font-variant-numeric:tabular-nums;white-space:normal;overflow-wrap:anywhere}.centered{text-align:center}td[data-col="1"],td[data-col="11"]{font-size:7.6px;white-space:normal}td[data-col="13"],td[data-col="14"]{font-size:7px;line-height:1.52}td[data-col="13"] .cell-line,td[data-col="14"] .cell-line{min-height:1.52em;line-height:1.52}td[data-col="14"]{vertical-align:top;padding-top:7px;padding-bottom:7px}td[data-col="15"],td[data-col="16"],td[data-col="17"]{font-size:7.2px}.column-totals td{height:40px;background:#fff1ef;border-top:1.5px solid #d32f23;border-bottom:0;font-size:8px;font-weight:600;vertical-align:middle}.column-totals td:last-child{border-right:0}.column-totals .numeric{font-size:7px;line-height:1.5;white-space:nowrap}
    .column-totals .total-label{text-align:center;color:#9b2119;font-size:8.2px}.column-totals .balance-skip{text-align:center;color:#a78b87;font-weight:400}
    .summary{min-height:54px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1.25px solid #e9b7b2;border-radius:11px;overflow:hidden;margin-top:7px;background:#fff1ef}
    .summary div{min-width:0;display:grid;grid-template-columns:minmax(0,1fr) max-content;align-items:center;gap:9px;padding:7px 10px;border-right:1.25px solid #e9b7b2;font-size:8px;line-height:1.55}.summary div:last-child{border-right:0}.summary span{min-width:0;margin:0;overflow-wrap:anywhere}.summary strong{font-size:8.2px;line-height:1.55;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}
  `
  const initialHtml = `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>${baseCss}</style></head><body><div id="measure"><div class="table-shell"><table>${colgroup}${tableHead}${groupsHtml.join('')}</table></div></div><main id="pages"></main></body></html>`

  try {
    const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }))
    frame.srcdoc = initialHtml
    await loaded
    await frame.contentDocument.fonts?.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    const measuredGroups = [...frame.contentDocument.querySelectorAll('#measure .report-group')]
    const groupHeights = measuredGroups.map(group => Math.ceil(group.getBoundingClientRect().height))
    const firstCapacity = 794 - 44 - 52 - 8 - 91 - 7 - 20 - 38 - 26
    const regularCapacity = 794 - 44 - 38 - 24
    const endingHeight = 114
    const pageGroups = []
    let page = []
    let used = 0
    let capacity = firstCapacity
    groupHeights.forEach((height, index) => {
      if (page.length && used + height > capacity) {
        pageGroups.push(page)
        page = []
        used = 0
        capacity = regularCapacity
      }
      page.push(index)
      used += height
    })
    if (page.length || !pageGroups.length) pageGroups.push(page)
    const lastIndexes = pageGroups.at(-1)
    let lastHeight = lastIndexes.reduce((sum, index) => sum + groupHeights[index], 0)
    const lastCapacity = pageGroups.length === 1 ? firstCapacity : regularCapacity
    const movedToFinalPage = []
    while (lastIndexes.length > 1 && lastHeight + endingHeight > lastCapacity) {
      const movedIndex = lastIndexes.pop()
      movedToFinalPage.unshift(movedIndex)
      lastHeight -= groupHeights[movedIndex]
    }
    if (movedToFinalPage.length) pageGroups.push(movedToFinalPage)

    const pagesRoot = frame.contentDocument.getElementById('pages')
    pagesRoot.innerHTML = pageGroups.map((indexes, pageIndex) => {
      const firstPage = pageIndex === 0
      const lastPage = pageIndex === pageGroups.length - 1
      return `<section class="account-page">
        ${firstPage ? `<header class="report-head"><h1>${accountPdfEscape(title)}</h1><div class="brand">SMALL CAMERA CM</div></header><section class="stats">${statsHtml}</section><div class="count">จำนวนรายการ ${groups.length} รายการ</div>` : ''}
        <div class="table-shell"><table>${colgroup}${tableHead}${indexes.map(index => groupsHtml[index]).join('')}${lastPage ? columnTotalsHtml : ''}</table></div>
        ${lastPage ? `<footer class="summary">${summaryHtml}</footer>` : ''}
      </section>`
    }).join('')
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    const reportHtml = `<!doctype html>${frame.contentDocument.documentElement.outerHTML}`
    try {
      const response = await fetch('/api/render-account-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: reportHtml }),
      })
      if (!response.ok) throw new Error(`PDF service returned ${response.status}`)
      const blob = await response.blob()
      if (blob.type !== 'application/pdf' || blob.size < 1000) throw new Error('PDF service returned an invalid file')
      return blob
    } catch (error) {
      if (!import.meta.env.DEV) throw new Error('สร้าง PDF แบบตัวอักษรคมชัดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
      console.warn('Vector PDF service unavailable; using development-only image fallback.', error)
    }

    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
    const pages = [...frame.contentDocument.querySelectorAll('.account-page')]
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
    pdf.setProperties({ title: `รายการบัญชี_${stamp()}` })
    for (let index = 0; index < pages.length; index += 1) {
      if (index > 0) pdf.addPage('a4', 'landscape')
      const canvas = await html2canvas(pages[index], {
        backgroundColor: '#ffffff',
        // html2canvas delegates text drawing to Chromium's canvas engine, so
        // Thai combining marks are shaped before the page is embedded in PDF.
        // Avoid foreignObjectRendering here because Retina Chromium can apply
        // device scaling twice and crop the right half of a landscape report.
        scale: 3,
        useCORS: true,
        foreignObjectRendering: false,
        logging: false,
        width: 1123,
        height: 794,
        windowWidth: 1123,
        windowHeight: 794,
      })
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 297, 210, undefined, 'SLOW')
    }
    return pdf.output('blob')
  } finally {
    frame.remove()
  }
}

async function renderInventoryPdfFromHtml({ title, rows, stats, summary, columnTotals }) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  Object.assign(frame.style, { position: 'fixed', left: '-12000px', top: '0', width: '1123px', height: '794px', border: '0' })
  document.body.appendChild(frame)
  const headers = ['ลำดับ','รุ่น','Serial Number','ประเภท','เกรดสภาพ','สถานะ','ต้นทุนเริ่มต้น','ต้นทุนรวม','ราคาขาย','กำไร','วันที่รับเข้า','วันที่ขาย','รายละเอียดลูกค้า','หมายเหตุ']
  const widths = [6,24,18,15,11,16,14,14,14,14,17,17,28,32]
  const widthTotal = widths.reduce((sum, width) => sum + width, 0)
  const colgroup = `<colgroup>${widths.map(width => `<col style="width:${(width / widthTotal * 100).toFixed(4)}%">`).join('')}</colgroup>`
  const tableHead = `<thead><tr>${headers.map((header, index) => `<th data-col="${index}">${accountPdfEscape(header)}</th>`).join('')}</tr></thead>`
  const renderLines = value => accountPdfEscape(value).split('\n').map(line => `<span class="cell-line">${line || '&nbsp;'}</span>`).join('')
  const rowHtml = rows.map((row, rowIndex) => {
    const cells = row.map((rawValue, column) => {
      const isNumeric = [0, 6, 7, 8, 9].includes(column)
      const value = isNumeric && rawValue !== '' ? Number(rawValue).toLocaleString('th-TH') : rawValue
      const classes = [0, 3, 4, 5, 10, 11].includes(column) ? 'centered' : isNumeric ? 'numeric' : ''
      return `<td data-col="${column}" class="${classes}">${renderLines(value)}</td>`
    }).join('')
    return `<tr class="inventory-row band-${rowIndex % 2}">${cells}</tr>`
  })
  const statsHtml = stats.map(stat => `<div class="stat ${stat.tone || ''}"><span>${accountPdfEscape(stat.label)}</span><strong>${accountPdfEscape(stat.value)}</strong></div>`).join('')
  const summaryHtml = summary.map(item => `<div><span>${accountPdfEscape(item.label)}</span><strong>${accountPdfEscape(item.value)}</strong></div>`).join('')
  const totalCell = value => `<td class="numeric">${Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>`
  const totalsHtml = `<tfoot class="column-totals"><tr><td colspan="6" class="total-label">รวมตัวเลขในตาราง</td>${totalCell(columnTotals.baseCost)}${totalCell(columnTotals.cost)}${totalCell(columnTotals.sold)}${totalCell(columnTotals.profit)}<td></td><td></td><td></td><td></td></tr></tfoot>`
  const css = `
    @font-face{font-family:PromptReport;src:url('/fonts/Prompt-Regular.ttf') format('truetype');font-weight:400;font-style:normal;font-display:block}
    @font-face{font-family:PromptReport;src:url('/fonts/Prompt-Medium.ttf') format('truetype');font-weight:500;font-style:normal;font-display:block}
    @font-face{font-family:PromptReport;src:url('/fonts/Prompt-SemiBold.ttf') format('truetype');font-weight:600 700;font-style:normal;font-display:block}
    *{box-sizing:border-box}@page{size:A4 landscape;margin:0}html,body{margin:0;background:#fff;font-family:PromptReport,Tahoma,sans-serif;color:#2e1d19;font-kerning:normal;font-variant-ligatures:none;font-synthesis:none;letter-spacing:0;word-spacing:0}
    #inventory-measure{position:absolute;left:-9000px;top:0;width:1075px;visibility:hidden}.inventory-page{width:1123px;height:794px;padding:22px 24px;background:#fff;overflow:hidden;break-after:page;page-break-after:always;break-inside:avoid}.inventory-page:last-child{break-after:auto;page-break-after:auto}
    .report-head{height:52px;display:flex;align-items:center;justify-content:space-between;border:1px solid #f5cdc9;border-radius:15px;padding:0 15px;margin-bottom:8px}.report-head h1{margin:0;font-size:17px;line-height:1.55;font-weight:600}.brand{font-size:20px;line-height:1;font-weight:700;color:#d32f23;white-space:nowrap}
    .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:7px}.stat{height:42px;border:1px solid #f5cdc9;border-radius:11px;background:#fff7f6;padding:5px 9px}.stat span{display:block;font-size:8.5px;line-height:1.45;color:#7b5a56;white-space:nowrap}.stat strong{display:block;font-size:11.5px;line-height:1.45;font-weight:600}.stat.in strong{color:#16a34a}.stat.out strong{color:#dc2626}.stat.warn strong{color:#d32f23}.count{height:20px;color:#7b5a56;font-size:10px;line-height:20px}
    .table-shell{border:1.25px solid #e9b7b2;overflow:visible}table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;background:#fff}thead{display:table-header-group}th{height:38px;background:#d32f23;color:#fff;border-right:1.25px solid #e9b7b2;border-bottom:1.25px solid #e9b7b2;padding:5px 3px;text-align:center;vertical-align:middle;font-size:8px;line-height:1.55;font-weight:600;white-space:normal}th:last-child,td:last-child{border-right:0}
    td{padding:6px 4px;border-right:1.25px solid #e9b7b2;border-bottom:1.25px solid #e9b7b2;vertical-align:middle;font-size:8.2px;line-height:1.62;font-weight:400;overflow-wrap:anywhere}.cell-line{display:block;min-height:1.62em;line-height:1.62;white-space:normal}.band-1 td{background:#fff8f7}.numeric{text-align:right;font-size:7.7px;font-variant-numeric:tabular-nums}.centered{text-align:center}td[data-col="10"],td[data-col="11"]{font-size:7.5px}td[data-col="12"],td[data-col="13"]{font-size:7px;line-height:1.5;vertical-align:top;padding-top:7px;padding-bottom:7px}td[data-col="12"] .cell-line,td[data-col="13"] .cell-line{min-height:1.5em;line-height:1.5}
    .column-totals td{height:40px;background:#fff1ef;border-top:1.5px solid #d32f23;border-bottom:0;font-size:8px;font-weight:600;vertical-align:middle}.column-totals .numeric{font-size:7px;white-space:nowrap}.column-totals .total-label{text-align:center;color:#9b2119;font-size:8.2px}
    .summary{min-height:54px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1.25px solid #e9b7b2;border-radius:11px;overflow:hidden;margin-top:7px;background:#fff1ef}.summary div{min-width:0;display:grid;grid-template-columns:minmax(0,1fr) max-content;align-items:center;gap:9px;padding:7px 10px;border-right:1.25px solid #e9b7b2;font-size:8px;line-height:1.55}.summary div:last-child{border-right:0}.summary strong{font-size:8.2px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}
  `
  const initialHtml = `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>${css}</style></head><body><div id="inventory-measure"><div class="table-shell"><table>${colgroup}${tableHead}<tbody>${rowHtml.join('')}</tbody></table></div></div><main id="inventory-pages"></main></body></html>`
  try {
    const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }))
    frame.srcdoc = initialHtml
    await loaded
    await frame.contentDocument.fonts?.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const measuredRows = [...frame.contentDocument.querySelectorAll('#inventory-measure .inventory-row')]
    const rowHeights = measuredRows.map(row => Math.max(42, Math.ceil(row.getBoundingClientRect().height)))
    const firstCapacity = 794 - 44 - 52 - 8 - 49 - 20 - 38 - 22
    const regularCapacity = 794 - 44 - 38 - 22
    const endingHeight = 105
    const pageRows = []
    let page = []
    let used = 0
    let capacity = firstCapacity
    rowHeights.forEach((height, index) => {
      if (page.length && used + height > capacity) {
        pageRows.push(page)
        page = []
        used = 0
        capacity = regularCapacity
      }
      page.push(index)
      used += height
    })
    if (page.length || !pageRows.length) pageRows.push(page)
    const lastIndexes = pageRows.at(-1)
    let lastHeight = lastIndexes.reduce((sum, index) => sum + rowHeights[index], 0)
    const lastCapacity = pageRows.length === 1 ? firstCapacity : regularCapacity
    const finalPageRows = []
    while (lastIndexes.length > 1 && lastHeight + endingHeight > lastCapacity) {
      const moved = lastIndexes.pop()
      finalPageRows.unshift(moved)
      lastHeight -= rowHeights[moved]
    }
    if (finalPageRows.length) pageRows.push(finalPageRows)
    frame.contentDocument.getElementById('inventory-pages').innerHTML = pageRows.map((indexes, pageIndex) => {
      const firstPage = pageIndex === 0
      const lastPage = pageIndex === pageRows.length - 1
      return `<section class="account-page inventory-page">${firstPage ? `<header class="report-head"><h1>${accountPdfEscape(title)}</h1><div class="brand">SMALL CAMERA CM</div></header><section class="stats">${statsHtml}</section><div class="count">จำนวนรายการ ${rows.length} รายการ</div>` : ''}<div class="table-shell"><table>${colgroup}${tableHead}<tbody>${indexes.map(index => rowHtml[index]).join('')}</tbody>${lastPage ? totalsHtml : ''}</table></div>${lastPage ? `<footer class="summary">${summaryHtml}</footer>` : ''}</section>`
    }).join('')
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const reportHtml = `<!doctype html>${frame.contentDocument.documentElement.outerHTML}`
    try {
      const response = await fetch('/api/render-account-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html: reportHtml }) })
      if (!response.ok) throw new Error(`PDF service returned ${response.status}`)
      const blob = await response.blob()
      if (blob.type !== 'application/pdf' || blob.size < 1000) throw new Error('PDF service returned an invalid file')
      return blob
    } catch (error) {
      if (!import.meta.env.DEV) throw new Error('สร้าง PDF สต็อกสินค้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
      console.warn('Vector PDF service unavailable; using development-only image fallback.', error)
    }
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
    const pages = [...frame.contentDocument.querySelectorAll('.inventory-page')]
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
    pdf.setProperties({ title: `สต็อกสินค้า_${stamp()}` })
    for (let index = 0; index < pages.length; index += 1) {
      if (index > 0) pdf.addPage('a4', 'landscape')
      const canvas = await html2canvas(pages[index], { backgroundColor: '#ffffff', scale: 3, useCORS: true, foreignObjectRendering: false, logging: false, width: 1123, height: 794, windowWidth: 1123, windowHeight: 794 })
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 297, 210, undefined, 'SLOW')
    }
    return pdf.output('blob')
  } finally {
    frame.remove()
  }
}

export async function buildTransactionsPDF(filtered, balance = null, stockValue = null, period = {}, allTransactions = filtered) {
  const balMap = buildBalanceMap(filtered, balance)
  const stockMap = stockValue != null ? buildStockMap(filtered, stockValue) : {}
  const plValues = []
  const vatValues = []
  const saleGrossValues = []
  const displayedCostValues = []
  const pdfCountedInstall = new Set()
  const reportGroups = []
  const reportGroupMap = new Map()
  const transactionOrder = new Map(filtered.map((tx, index) => [tx.id, index]))
  const installmentByTransactionId = buildSaleInstallmentMetaByTransactionId(allTransactions)
  // The transaction feed is newest-first because the balance/stock ledgers
  // reconstruct historical values from the current balance. Keep that order
  // for calculations, but present the report chronologically from day 1 onward.
  const displayTransactions = [...filtered].sort((a, b) => {
    const dateDifference = new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime()
    if (dateDifference !== 0) return dateDifference
    return (transactionOrder.get(b.id) ?? 0) - (transactionOrder.get(a.id) ?? 0)
  })
  displayTransactions.forEach(t => {
    const batchId = t.category === 'Sale' ? t.products?.sale_batch_id : t.category === 'Buy Stock' ? t.products?.batch_id : null
    const key = batchId ? `${t.category}:${batchId}:${t.date || ''}:${t.payment_method || ''}` : `tx:${t.id}`
    if (!reportGroupMap.has(key)) {
      const group = { key, txs: [] }
      reportGroupMap.set(key, group)
      reportGroups.push(group)
    }
    reportGroupMap.get(key).txs.push(t)
  })

  const numberText = value => Number(value || 0).toLocaleString('th-TH')
  const isAutomaticNote = (note, tx) => {
    const text = String(note || '').trim()
    if (!text) return true
    const model = String(tx.products?.model || '')
    return text.startsWith('ซื้อสินค้า') || text.startsWith('ขายสินค้า:') || text.startsWith('ขายรวม') ||
      text.startsWith('ผ่อนจ่าย') || text.startsWith('ชำระครบ') || text.startsWith('ผ่อนจ่ายขายรวม') || text.startsWith('แลกเปลี่ยน') ||
      (model && text.includes(model) && /SN:|ราคา|ชำระ/.test(text))
  }
  const paymentLines = txs => {
    const bank = txs.reduce((sum, tx) => sum + Number(tx.bank_amount || 0), 0)
    const cash = txs.reduce((sum, tx) => sum + Number(tx.cash_amount || 0), 0)
    if (bank || cash) return [
      bank ? `• โอน ฿${numberText(bank)}` : '',
      cash ? `• เงินสด ฿${numberText(cash)}` : '',
    ].filter(Boolean)
    const total = txs.reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
    const method = txs.find(tx => tx.payment_method)?.payment_method || txs.find(tx => tx.products?.payment_method)?.products?.payment_method
    if (!method) return ['• ไม่ระบุช่องทาง']
    return [`• ${method === 'เงินสด' ? 'เงินสด' : method} ฿${numberText(total)}`]
  }
  const installmentPaymentLines = (txs, installmentNumber) => {
    const bank = txs.reduce((sum, tx) => sum + Number(tx.bank_amount || 0), 0)
    const cash = txs.reduce((sum, tx) => sum + Number(tx.cash_amount || 0), 0)
    if (bank || cash) return [
      bank ? `• งวดที่ ${installmentNumber} : โอน ฿${numberText(bank)}` : '',
      cash ? `• งวดที่ ${installmentNumber} : เงินสด ฿${numberText(cash)}` : '',
    ].filter(Boolean)
    const total = txs.reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
    const method = txs.find(tx => tx.payment_method)?.payment_method || 'ไม่ระบุช่องทาง'
    return [`• งวดที่ ${installmentNumber} : ${method === 'เงินสด' ? 'เงินสด' : method} ฿${numberText(total)}`]
  }
  const paymentAmountText = (txs, type) => {
    const relevant = txs.filter(tx => tx.type === type)
    const bank = relevant.reduce((sum, tx) => sum + Number(tx.bank_amount || 0), 0)
    const cash = relevant.reduce((sum, tx) => sum + Number(tx.cash_amount || 0), 0)
    if (bank || cash) return [
      bank ? `${numberText(bank)}\nโอน` : '',
      cash ? `${numberText(cash)}\nเงินสด` : '',
    ].filter(Boolean).join('\n')
    const total = relevant.reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
    if (!total) return ''
    const rawMethod = relevant.find(tx => tx.payment_method)?.payment_method || ''
    const method = rawMethod === 'แบ่งจ่าย' ? 'ไม่ระบุช่องทาง' : rawMethod === 'เงินสด' ? 'เงินสด' : rawMethod || 'ไม่ระบุช่องทาง'
    return `${numberText(total)}\n${method}`
  }
  const adminNotes = txs => [...new Set([
    ...txs.filter(tx => !isAutomaticNote(tx.note, tx)).map(tx => String(tx.note).trim()),
  ])]
  const productNote = product => {
    const note = String(product?.notes || '').trim()
    return note && !note.startsWith('แลกเปลี่ยน') ? note : ''
  }
  const addOnLines = product => (product?.report_add_ons || []).map(addOn => {
    const purchasedDate = addOn.purchased_at ? ` (${thDateShort(addOn.purchased_at)})` : ''
    return `+ ${addOn.name || 'อุปกรณ์เสริม'} ฿${numberText(addOn.cost)}${purchasedDate}`
  })
  const purchaseItemCost = product => {
    if (product?.base_cost != null) return Number(product.base_cost || 0)
    const addOnTotal = (product?.report_add_ons || []).reduce((sum, addOn) => sum + Number(addOn.cost || 0), 0)
    return Math.max(0, Number(product?.total_cost || 0) - addOnTotal)
  }
  const reportItems = group => {
    const representative = group.txs[0]
    if (representative.category === 'Trade') {
      const tradeItemB = representative.products?.trade_item_b
      return [
        { tx: representative, product: representative.products || {}, amount: Number(representative.trade_sell_a || 0), role: 'A' },
        ...(tradeItemB ? [{ tx: null, product: tradeItemB, amount: Number(tradeItemB.total_cost || 0), role: 'B' }] : []),
      ]
    }
    if (representative.category === 'Buy Stock' && representative.products?.batch_items?.length > 1) {
      return representative.products.batch_items.map((product, index) => ({
        tx: index === 0 ? representative : null,
        product,
        amount: purchaseItemCost(product),
      }))
    }
    return group.txs.map(tx => ({
      tx,
      product: tx.products || {},
      amount: Number(tx.products?.installment_total || tx.products?.sold_price || tx.amount || 0),
    }))
  }

  const body = []
  const bodyGroupIndexes = []
  reportGroups.forEach((group, groupIndex) => {
    const representative = group.txs[0]
    const installment = group.txs.map(tx => installmentByTransactionId.get(tx.id)).find(Boolean) || null
    const items = reportItems(group)
    const isGrouped = items.length > 1
    const productList = items.map(item => item.product)
    const action = representative.category === 'Sale' ? 'ขายสินค้า' : representative.category === 'Buy Stock' ? 'ซื้อสินค้า' : ''
    const itemLines = isGrouped
      ? productList.map((product, index) => [
          `-${product.model || '-'}`,
          `SN:${product.serial_number || '-'}`,
          ...(representative.category === 'Sale' ? addOnLines(product) : []),
          `฿${numberText(items[index].amount)}`,
          productNote(product),
        ].filter(Boolean).join('\n')).join('\n\n')
      : productList.length && action
      ? [
          `${action}: ${productList[0].model || '-'}`,
          `SN:${productList[0].serial_number || '-'}`,
          ...(representative.category === 'Sale' ? addOnLines(productList[0]) : []),
          productNote(productList[0]),
        ].filter(Boolean).join('\n')
      : ''
    const installmentItemLines = productList.map((product, index) => [
      `-${product.model || '-'}`,
      `SN:${product.serial_number || '-'}`,
      ...(representative.category === 'Sale' ? addOnLines(product) : []),
      `฿${numberText(items[index].amount)}${productNote(product) ? ` ${productNote(product)}` : ''}`,
    ].filter(Boolean).join('\n')).join('\n\n')
    const notes = [
      ...adminNotes(group.txs),
      ...(representative.category === 'Trade' ? productList.map(productNote).filter(Boolean) : []),
    ]
    const tradeSell = Number(representative.trade_sell_a || 0)
    const tradeBuy = representative.products?.trade_item_b?.total_cost != null
      ? Number(representative.products.trade_item_b.total_cost)
      : Math.max(0, tradeSell - (representative.type === 'Income' ? Number(representative.amount || 0) : -Number(representative.amount || 0)))
    const tradeDifference = tradeSell - tradeBuy
    const tradePayment = tradeDifference === 0 ? [] : paymentLines(group.txs)
    const tradeSegments = String(representative.note || '').split('|').map(segment => segment.trim())
    const tradeSideLines = (prefix, fallbackModel, fallbackPrice, priceLabel) => {
      const segment = tradeSegments.find(value => value.startsWith(`${prefix}:`))
      const source = segment ? segment.slice(2).trim() : ''
      const entries = []
      // Trade notes separate products with commas, while formatted prices also
      // contain commas (for example ฿2,000). Parse the complete "model + price"
      // shape so the thousands separator is never mistaken for another product.
      const entryPattern = /(?:^|,\s*)(.+?)\s+฿(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)(?=,\s*|$)/g
      let match
      while ((match = entryPattern.exec(source)) !== null) {
        entries.push({ model: match[1].trim(), price: Number(match[2].replace(/,/g, '')) })
      }
      if (!entries.length) entries.push({ model: fallbackModel || '-', price: Number(fallbackPrice || 0) })
      return entries.map((entry, index) => {
        const itemCode = `${prefix}${entries.length > 1 ? index + 1 : ''}`
        return `${itemCode}: ${entry.model} | ${priceLabel} ฿${numberText(entry.price)}`
      })
    }
    const tradeALines = tradeSideLines('A', representative.products?.model, tradeSell, 'ราคาขาย')
    const tradeBLines = tradeSideLines('B', representative.products?.trade_item_b?.model, tradeBuy, 'ราคาซื้อ')
    const tradeNote = representative.category === 'Trade' ? [
      'แลกเปลี่ยนสินค้า',
      ...tradeALines,
      'แลกกับ',
      ...tradeBLines,
      tradeDifference > 0 ? `ลูกค้าจ่ายเพิ่ม ฿${numberText(tradeDifference)}` : tradeDifference < 0 ? `ร้านจ่ายคืน ฿${numberText(Math.abs(tradeDifference))}` : 'แลกเท่ากันพอดี',
      tradePayment.length ? `การชำระ:\n${tradePayment.join('\n')}` : '',
    ].filter(Boolean).join('\n') : ''
    const addonName = representative.category === 'Add-on'
      ? String(representative.note || '').replace(/^Add-on:\s*/i, '').split(/\s+[—-]\s+/)[0].trim()
      : ''
    const addonNote = representative.category === 'Add-on' ? [
      `อุปกรณ์เสริม: ${addonName || 'ไม่ระบุ'}`,
      `${representative.products?.model || '-'}${representative.products?.created_at ? ` (${thDateShort(representative.products.created_at)})` : ''}`,
      `ต้นทุนรวมตอนนี้ ฿${numberText(representative.products?.total_cost || 0)}`,
    ].join('\n') : ''
    const openingCategories = new Set(['', 'Opening Balance', 'เงินตั้งต้น', 'รายรับ/จ่ายที่ไม่มีผลกับกำไร'])
    const isLegacySplitOpening = representative.category === 'Other' &&
      Number(representative.bank_amount || 0) > 0 && Number(representative.cash_amount || 0) > 0
    const isOpeningBalance = groupIndex === 0 && representative.type === 'Income' && !representative.product_id && (
      openingCategories.has(String(representative.category || '')) || isLegacySplitOpening || /เงินตั้งต้น|ยอดตั้งต้น/.test(String(representative.note || ''))
    )
    const openingBalanceNote = isOpeningBalance
      ? `เงินตั้งต้น\nการชำระ:\n${paymentLines(group.txs).join('\n')}`
      : ''
    const installmentTitle = installment
      ? installment.installmentNumber === 1
        ? `${isGrouped ? `ขายสินค้ารวม ${items.length} รายการ` : 'ขายสินค้า'} (ผ่อนจ่าย)`
        : `รับผ่อนงวดที่ ${installment.installmentNumber} ${isGrouped ? `สินค้ารวม ${items.length} รายการ` : 'สินค้า 1 รายการ'}${installment.isFinalInstallment ? ' (งวดปิดยอด)' : ' (ผ่อนจ่าย)'}`
      : ''
    const installmentHistory = installment
      ? (installment.paymentHistory || []).map(payment =>
          `งวดที่ ${payment.installmentNumber} วันที่ ${thDate(payment.date)}`
        ).join('\n')
      : ''
    const installmentNote = installment ? [
      installmentTitle,
      installmentItemLines,
      `การชำระ:\n${[
        ...installmentPaymentLines(group.txs, installment.installmentNumber),
        installment.isFinalInstallment
          ? '• งวดปิดยอดไม่มีค้างชำระ'
          : `• ค้างชำระ : ฿${numberText(installment.remainingAfter)}`,
      ].join('\n')}`,
      installmentHistory,
      ...notes,
    ].filter(Boolean).join('\n\n') : ''
    const baseMergedNote = isOpeningBalance
      ? openingBalanceNote
      : installment
      ? installmentNote
      : representative.category === 'Trade'
      ? [tradeNote, ...notes].filter(Boolean).join('\n\n')
      : representative.category === 'Add-on'
      ? addonNote
      : [
          isGrouped && action ? `${action}รวม ${items.length} รายการ` : itemLines,
          isGrouped ? itemLines : '',
          action ? `การชำระ:\n${paymentLines(group.txs).join('\n')}` : '',
          ...notes,
        ].filter(Boolean).join('\n\n')
    const mergedNote = appendVatDocumentNumbers(baseMergedNote, group.txs)
    const hasGroupIncome = group.txs.some(tx => tx.type === 'Income')
    const hasGroupExpense = group.txs.some(tx => tx.type === 'Expense')
    const groupIncome = group.txs.filter(tx => tx.type === 'Income').reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
    const groupExpense = group.txs.filter(tx => tx.type === 'Expense').reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
    const groupIncomeText = groupIncome ? paymentAmountText(group.txs, 'Income') : ''
    const groupExpenseText = groupExpense ? paymentAmountText(group.txs, 'Expense') : ''
    const groupCustomerDetail = [...new Set(productList
      .map(product => String(product?.customer_note || '').trim())
      .filter(Boolean))]
      .join('\n')

    items.forEach((item, itemIndex) => {
      const t = item.tx || representative
      const isSyntheticRow = !item.tx
      const vatDocument = vatDocumentOf(t)
      const hasVat = !isSyntheticRow && vatDocument && vatDocument.status !== 'void'
      const vatGross = hasVat ? Number(t.category === 'Trade' ? t.trade_sell_a : t.amount || 0) : null
      const vatBase = hasVat ? amountBeforeVat(vatGross, vatDocument) : null
      const vatAmount = hasVat ? roundMoney(vatGross - vatBase) : null
      let pl = ''
      if (!isSyntheticRow && t.category === 'Sale' && t.products?.total_cost != null) {
        if (!t.products?.installment_total) {
          pl = roundMoney((hasVat ? vatBase : Number(t.amount)) - Number(t.products.total_cost))
        } else if (installment?.isFinalInstallment && !pdfCountedInstall.has(t.product_id)) {
          const installmentGross = Number(t.products.installment_total)
          const installmentVatDocument = installment.vatDocument || vatDocument
          const installmentNet = installmentVatDocument
            ? amountBeforeVat(installmentGross, installmentVatDocument)
            : installmentGross
          pl = roundMoney(installmentNet - Number(t.products.total_cost))
          pdfCountedInstall.add(t.product_id)
        }
      } else if (!isSyntheticRow && t.category === 'Trade' && t.trade_profit_a != null) {
        const tradeCost = Number(t.trade_sell_a || 0) - Number(t.trade_profit_a || 0)
        pl = roundMoney(amountBeforeVat(Number(t.trade_sell_a || 0), vatDocument) - tradeCost)
      } else if (!isSyntheticRow && t.type === 'Expense' && PROFIT_DEDUCT_CATS.has(t.category)) {
        pl = -Number(t.amount)
      }
      if (!isSyntheticRow) {
        plValues.push(pl)
        vatValues.push(hasVat ? vatAmount : 0)
        saleGrossValues.push(t.category === 'Trade' ? Number(t.trade_sell_a || 0) : t.category === 'Sale' && t.type === 'Income' ? Number(t.amount || 0) : 0)
      }
      const balanceTx = group.txs.reduce((newest, tx) => (
        (transactionOrder.get(tx.id) ?? Number.MAX_SAFE_INTEGER) < (transactionOrder.get(newest.id) ?? Number.MAX_SAFE_INTEGER) ? tx : newest
      ), representative)
      const bal = balMap[balanceTx.id]
      const productType = t.category === 'Add-on' ? 'อุปกรณ์เสริม' : (item.product?.category || '')
      const mergedCell = (content, rowSpan = items.length, styles = {}) => ({ content, rowSpan, styles })
      const mergedNumberCell = content => mergedCell(content, items.length, { halign: 'right', valign: 'middle' })
      const mergedTextCell = content => mergedCell(content, items.length, { valign: 'middle' })
      const displayedCost = Number(t.category === 'Add-on' ? t.amount : t.category === 'Buy Stock' ? purchaseItemCost(item.product) : item.product?.total_cost || 0)
      displayedCostValues.push(displayedCost)
      const row = [
        itemIndex === 0 && isGrouped
          ? mergedCell(String(groupIndex + 1), items.length, { halign: 'center', valign: 'middle' })
          : String(groupIndex + 1),
        itemIndex === 0 && isGrouped ? mergedTextCell(thDate(representative.date)) : thDate(t.date),
        itemIndex === 0 && isGrouped ? mergedTextCell(representative.category) : t.category,
        isGrouped
          ? itemIndex === 0 ? mergedNumberCell(hasGroupIncome ? groupIncomeText : '') : ''
          : !isSyntheticRow && t.type === 'Income' ? paymentAmountText([t], 'Income') : '',
        isGrouped
          ? itemIndex === 0 ? mergedNumberCell(hasGroupExpense ? groupExpenseText : '') : ''
          : !isSyntheticRow && t.type === 'Expense' ? paymentAmountText([t], 'Expense') : '',
        hasVat ? Number(vatBase).toLocaleString('th-TH', { minimumFractionDigits:2, maximumFractionDigits:2 }) : '',
        hasVat ? Number(vatAmount).toLocaleString('th-TH', { minimumFractionDigits:2, maximumFractionDigits:2 }) : '',
        hasVat ? Number(vatGross).toLocaleString('th-TH', { minimumFractionDigits:2, maximumFractionDigits:2 }) : '',
        pl !== '' ? pl.toLocaleString('th-TH') : '',
        productType,
        item.product?.model || '',
        item.product?.created_at ? thDate(item.product.created_at) : '',
        displayedCost
          ? numberText(displayedCost)
          : '',
        itemIndex === 0 && isGrouped
          ? mergedTextCell(representative.category === 'Sale' ? groupCustomerDetail : '')
          : t.category === 'Sale' ? (item.product?.customer_note || '') : '',
        itemIndex === 0 && isGrouped ? mergedCell(mergedNote) : mergedNote,
        itemIndex === 0 && isGrouped && balance != null ? mergedNumberCell(numberText(bal?.bank ?? 0)) : balance != null ? numberText(bal?.bank ?? 0) : '',
        itemIndex === 0 && isGrouped && balance != null ? mergedNumberCell(numberText(bal?.cash ?? 0)) : balance != null ? numberText(bal?.cash ?? 0) : '',
        itemIndex === 0 && isGrouped && stockValue != null ? mergedNumberCell(numberText(stockMap[balanceTx.id] ?? 0)) : stockValue != null ? numberText(stockMap[t.id] ?? 0) : '',
      ]
      if (itemIndex > 0 && isGrouped) {
        row.splice(14, 4)
        row.splice(13, 1)
        row.splice(3, 2)
        row.splice(1, 2)
        row.splice(0, 1)
      }
      body.push(row)
      bodyGroupIndexes.push(groupIndex)
    })
  })

  const totalIncome  = filtered.filter(t => t.type === 'Income').reduce((a, t) => a + Number(t.amount), 0)
  const totalExpense = filtered.filter(t => t.type === 'Expense').reduce((a, t) => a + Number(t.amount), 0)
  const totalProfit  = roundMoney(plValues.reduce((a, v) => v !== '' ? a + v : a, 0))
  const totalVat     = roundMoney(vatValues.reduce((a, v) => a + Number(v || 0), 0))
  const totalSaleGross = roundMoney(saleGrossValues.reduce((a, v) => a + Number(v || 0), 0))
  const totalSaleAfterVat = roundMoney(totalSaleGross - totalVat)
  const profitBeforeVat = roundMoney(totalProfit + totalVat)
  const totalDisplayedCost = roundMoney(displayedCostValues.reduce((sum, value) => sum + Number(value || 0), 0))
  const datedTransactions = filtered
    .map(tx => ({ date: new Date(tx.date), key: localDateKey(tx.date) }))
    .filter(entry => entry.key && !Number.isNaN(entry.date.getTime()))
    .sort((a, b) => a.date - b.date)
  const reportFrom = period.from || datedTransactions[0]?.key
  const reportTo = period.to || datedTransactions[datedTransactions.length - 1]?.key
  const stats = [
    { label: 'เงินรับจริง', value: moneyText(totalIncome), tone: 'in' },
    { label: 'รวมรายจ่าย', value: moneyText(totalExpense), tone: 'out' },
    { label: 'กำไรขั้นต้นก่อนแยก VAT', value: moneyText(profitBeforeVat), tone: profitBeforeVat >= 0 ? 'in' : 'out' },
    { label: 'ยอดขายไม่รวม VAT', value: moneyText(totalSaleAfterVat), tone: 'in' },
    { label: 'VAT 7%', value: moneyText(totalVat), tone: 'warn' },
    { label: 'กำไรขั้นต้นไม่รวม VAT', value: moneyText(totalProfit), tone: totalProfit >= 0 ? 'in' : 'out' },
  ]
  const groups = reportGroups.map((_, groupIndex) => body.filter((__, rowIndex) => bodyGroupIndexes[rowIndex] === groupIndex))
  return renderTransactionsPdfFromHtml({
    title: accountReportTitle(reportFrom, reportTo),
    groups,
    stats,
    columnTotals: {
      income: totalIncome,
      expense: totalExpense,
      vatBase: totalSaleAfterVat,
      vat: totalVat,
      saleGross: totalSaleGross,
      profit: totalProfit,
      cost: totalDisplayedCost,
    },
    summary: [
      { label: 'ยอดรวมก่อนหัก', value: `${Number(totalSaleGross).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท` },
      { label: 'รวมยอด VAT 7%', value: `${Number(totalVat).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท` },
      { label: 'ยอดรวมหลังหัก', value: `${Number(totalSaleAfterVat).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท` },
      { label: 'กำไรขั้นต้นไม่รวม VAT', value: `${Number(totalProfit).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท` },
    ],
  })
}

export async function previewTransactionsPDFFile(transactions, from, to, balance = null, stockValue = null) {
  const filtered = transactions.filter(t => {
    if (from && new Date(t.date) < new Date(from)) return false
    if (to && new Date(t.date) > new Date(`${to}T23:59:59`)) return false
    return true
  })
  if (!filtered.length) throw new Error('ไม่มีข้อมูลในช่วงวันที่ที่เลือก')

  const preview = window.open('', '_blank')
  if (!preview) throw new Error('กรุณาอนุญาต Pop-up เพื่อเปิดตัวอย่าง PDF')
  preview.document.write('<!doctype html><html lang="th"><head><meta charset="utf-8"><title>กำลังสร้าง PDF</title><style>body{display:grid;min-height:100vh;margin:0;place-items:center;background:#efe8df;color:#2e1d19;font-family:Arial,sans-serif}.loading{text-align:center}.loading strong{display:block;margin-bottom:6px;color:#d32f23}</style></head><body><div class="loading"><strong>กำลังสร้าง PDF รายการบัญชี...</strong><span>กรุณาอย่าปิดหน้าต่างนี้</span></div></body></html>')
  preview.document.close()
  try {
    const blob = await buildTransactionsPDF(filtered, balance, stockValue, { from, to }, transactions)
    const url = URL.createObjectURL(blob)
    preview.location.replace(url)
    window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000)
    return `รายการบัญชี_${stamp()}.pdf`
  } catch (error) {
    preview.close()
    throw error
  }
}

// ─── Export Inventory + Images as ZIP ────────────────────────
export async function exportInventoryWithImages(products, transactions = [], statusFilter = 'all', format = 'xlsx', onProgress) {
  const filtered = products.filter(p => statusFilter === 'all' || p.status === statusFilter)
  if (!filtered.length) { alert('ไม่มีข้อมูล'); return }

  const zip = new JSZip()
  const s = stamp()

  if (format === 'xlsx') {
    zip.file(`สต็อกสินค้า_${s}.xlsx`, await buildInventoryXLSX(products, statusFilter))
  } else {
    const pdfBlob = await buildInventoryPDF(filtered, statusFilter)
    zip.file(`สต็อกสินค้า_${s}.pdf`, pdfBlob)
  }

  const productIds = new Set(filtered.map(p => p.id))
  const productDataMap = new Map(filtered.map(p => [p.id, p]))
  const filteredTxs = (transactions || []).filter(t => t.product_id && productIds.has(t.product_id) && t.images?.length)
  const totalReceipt = filteredTxs.reduce((a, t) => a + (t.images?.length || 0), 0)
  const grandTotal = totalReceipt
  let done = 0

  // Receipt images — grouped by day folder
  if (filteredTxs.length) {
    const receiptRoot = zip.folder('รูปใบเสร็จ')
    for (const t of filteredTxs) {
      const dayKey    = new Date(t.date).toISOString().slice(0, 10)
      const dayFolder = receiptRoot.folder(dayKey)
      const dateStr   = dayKey.replace(/-/g, '')
      const prod      = productDataMap.get(t.product_id)
      const rModel    = prod ? safeStr(prod.model) : safeStr(t.category || 'nocat')
      const rCat      = prod ? safeStr(prod.category || 'nocat') : ''
      const rBuy      = prod?.created_at ? new Date(prod.created_at).toISOString().slice(0,10).replace(/-/g,'') : '-'
      const rSell     = prod?.sold_date  ? new Date(prod.sold_date).toISOString().slice(0,10).replace(/-/g,'')  : dateStr
      const rCost     = prod ? Number(prod.total_cost || prod.base_cost || 0) : 0
      const rSPrice   = prod?.sold_price != null ? Number(prod.sold_price) : null
      const rProfit   = rSPrice != null ? rSPrice - rCost : null
      for (let i = 0; i < t.images.length; i++) {
        try {
          const res = await fetch(t.images[i])
          const buf = await res.arrayBuffer()
          const ext = (t.images[i].split('?')[0].split('.').pop() || 'jpg').toLowerCase()
          const fname = prod
            ? `${rModel}_${rCat}_${rBuy}_${rSell}_${rCost}_${rSPrice ?? '-'}_${rProfit ?? '-'}_${i + 1}.${ext}`
            : `${rModel}_${dateStr}_${Number(t.amount)}_${i + 1}.${ext}`
          dayFolder.file(fname, buf)
        } catch { /* skip */ }
        done++
        onProgress?.(done, grandTotal)
      }
    }
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `สต็อกสินค้า_พร้อมรูป_${s}.zip`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Export Transactions + Images as ZIP ─────────────────────
export async function exportTransactionsWithImages(transactions, from, to, format = 'xlsx', onProgress, balance = null, stockValue = null) {
  const filtered = transactions.filter(t => {
    if (from && new Date(t.date) < new Date(from)) return false
    if (to   && new Date(t.date) > new Date(to + 'T23:59:59')) return false
    return true
  })
  if (!filtered.length) { alert('ไม่มีข้อมูล'); return }

  const zip = new JSZip()
  const s   = stamp()

  if (format === 'xlsx') {
    zip.file(`รายการบัญชี_${s}.xlsx`, await buildTransactionsXLSX(transactions, from, to, balance, stockValue, transactions))
  } else {
    zip.file(`รายการบัญชี_${s}.pdf`, await buildTransactionsPDF(filtered, balance, stockValue, { from, to }, transactions))
  }

  const totalReceipt = filtered.reduce((a, t) => a + (t.images?.length || 0), 0)
  const grandTotal   = totalReceipt
  let done = 0

  // Receipt images — grouped by day
  const receiptRoot = zip.folder('รูปใบเสร็จ')
  for (const t of filtered) {
    if (!t.images?.length) continue
    const dayKey    = new Date(t.date).toISOString().slice(0, 10)
    const dayFolder = receiptRoot.folder(dayKey)
    const dateStr   = dayKey.replace(/-/g, '')
    const rModel    = t.products?.model ? safeStr(t.products.model) : safeStr(t.category || 'nocat')
    const rCat      = t.products?.category ? safeStr(t.products.category) : ''
    const rBuy      = t.products?.created_at ? new Date(t.products.created_at).toISOString().slice(0,10).replace(/-/g,'') : '-'
    const rSell     = t.products?.sold_date  ? new Date(t.products.sold_date).toISOString().slice(0,10).replace(/-/g,'')  : dateStr
    const rCost     = t.products?.total_cost != null ? Number(t.products.total_cost) : 0
    const rSPrice   = t.products?.sold_price != null ? Number(t.products.sold_price) : null
    const rProfit   = rSPrice != null ? rSPrice - rCost : null

    for (let i = 0; i < t.images.length; i++) {
      try {
        const res = await fetch(t.images[i])
        const buf = await res.arrayBuffer()
        const ext = (t.images[i].split('?')[0].split('.').pop() || 'jpg').toLowerCase()
        const fname = t.products?.model
          ? `${rModel}_${rCat}_${rBuy}_${rSell}_${rCost}_${rSPrice ?? '-'}_${rProfit ?? '-'}_${i + 1}.${ext}`
          : `${rModel}_${dateStr}_${Number(t.amount)}_${i + 1}.${ext}`
        dayFolder.file(fname, buf)
      } catch { /* skip */ }
      done++
      onProgress?.(done, grandTotal)
    }
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `รายการบัญชี_พร้อมรูป_${s}.zip`
  a.click()
  URL.revokeObjectURL(url)
}
