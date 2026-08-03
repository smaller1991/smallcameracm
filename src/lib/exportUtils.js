import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { thDate } from './dateUtils'

const STATUS_TH = { Available: 'พร้อมขาย', Reserved: 'จอง', Sold: 'ขายแล้ว', Pending: 'รอชำระ' }
const PRODUCT_CATEGORY_ORDER = ['กล้อง','เลนส์','แฟลช','อุปกรณ์','กล้องดิจิตอลเก่า','อื่นๆ']
const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')
const safeStr = s => (s || '').replace(/[/\\:*?"<>|]/g, '_')
const PROFIT_DEDUCT_CATS = new Set(['Shipping','Marketing','Operating','Other'])
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
const buildStockMap = (txs, currentStockValue) => {
  const map = {}
  let runStock = Number(currentStockValue || 0)
  const soldProductSeen = new Set()
  const stockDelta = tx => {
    const productCost = Number(tx.products?.total_cost || 0)
    const batchCost = Number(tx.products?.batch_total_cost || 0)
    if (tx.category === 'Buy Stock' && tx.product_id && productCost) {
      if ((tx.note || '').includes('ชำระค่าซื้อ')) return 0
      return batchCost || productCost
    }
    if (tx.category === 'Add-on' && tx.product_id) return Number(tx.amount || 0)
    if (tx.category === 'Sale' && tx.product_id && tx.products?.status === 'Sold' && productCost && !soldProductSeen.has(tx.product_id)) {
      soldProductSeen.add(tx.product_id)
      return -productCost
    }
    if (tx.category === 'Trade') {
      const sellA = Number(tx.trade_sell_a || 0)
      const profitA = Number(tx.trade_profit_a || 0)
      if (!sellA && !profitA) return 0
      const costA = sellA - profitA
      const diff = tx.type === 'Income' ? Number(tx.amount || 0) : -Number(tx.amount || 0)
      const buyB = sellA - diff
      return buyB - costA
    }
    return 0
  }
  for (const tx of txs) {
    map[tx.id] = runStock
    runStock -= stockDelta(tx)
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

export function exportInventory(products, statusFilter = 'all') {
  const rows = products
    .filter(p => statusFilter === 'all' || p.status === statusFilter)
    .map(p => ({
      'รุ่น':              p.model,
      'Serial Number':     p.serial_number,
      'เกรดสภาพ':         p.condition,
      'สถานะ':            STATUS_TH[p.status] || p.status,
      'ต้นทุนเริ่มต้น':   Number(p.base_cost),
      'ต้นทุนรวม':        Number(p.total_cost),
      'ราคาขาย':          p.sold_price ? Number(p.sold_price) : '',
      'กำไร':             p.sold_price ? Number(p.sold_price) - Number(p.total_cost) : '',
      'วันที่รับเข้า':    thDate(p.created_at),
      'วันที่ขาย':        thDate(p.sold_date),
      'วันหมดประกัน':    thDate(p.warranty_expiry),
      'รายละเอียดลูกค้า': p.customer_note || '',
      'หมายเหตุ':         p.notes || '',
    }))
  if (!rows.length) return alert('ไม่มีข้อมูล')
  write(rows, 'สต็อกสินค้า', `สต็อกสินค้า_${stamp()}.xlsx`)
}

export function exportTransactions(transactions, from, to, balance = null) {
  const filtered = transactions.filter(t => {
    const d = new Date(t.date)
    if (from && d < new Date(from)) return false
    if (to   && d > new Date(to + 'T23:59:59')) return false
    return true
  })
  if (!filtered.length) return alert('ไม่มีข้อมูล')

  const totalIncome  = filtered.filter(t => t.type === 'Income').reduce((a, t) => a + Number(t.amount), 0)
  const totalExpense = filtered.filter(t => t.type === 'Expense').reduce((a, t) => a + Number(t.amount), 0)

  const countedInstall = new Set()
  const rows = filtered.map(t => {
    let pl = ''
    if (t.category === 'Sale' && t.products?.total_cost != null) {
      if (!t.products?.installment_total) {
        pl = Number(t.amount) - Number(t.products.total_cost)
      } else if (t.products?.status === 'Sold' && !countedInstall.has(t.product_id)) {
        pl = Number(t.products.installment_total) - Number(t.products.total_cost)
        countedInstall.add(t.product_id)
      }
    } else if (t.category === 'Trade' && t.trade_profit_a != null) {
      pl = Number(t.trade_profit_a)
    } else if (t.type === 'Expense' && PROFIT_DEDUCT_CATS.has(t.category)) {
      pl = -Number(t.amount)
    }
    return {
      'วันที่':        thDate(t.date),
      'ประเภท':       t.type === 'Income' ? 'รายรับ' : 'รายจ่าย',
      'หมวดหมู่':     t.category,
      'จำนวนเงิน':    Number(t.amount),
      'รายรับ':       t.type === 'Income' ? Number(t.amount) : '',
      'รายจ่าย':      t.type === 'Expense' ? Number(t.amount) : '',
      'กำไรขาดทุน':        pl,
      'รุ่นกล้อง':         t.products?.model || '',
      'วันที่ซื้อ':         t.products?.created_at ? thDate(t.products.created_at) : '',
      'ราคาต้นทุน':        txProductCost(t) || '',
      'รายละเอียดลูกค้า':  t.category === 'Sale' ? (t.products?.customer_note || '') : '',
      'หมายเหตุ':          t.note || '',
    }
  })

  const totalProfit = rows.reduce((a, r) => r['กำไรขาดทุน'] !== '' ? a + r['กำไรขาดทุน'] : a, 0)
  const deductions  = filtered.filter(t => t.type === 'Expense' && PROFIT_DEDUCT_CATS.has(t.category)).reduce((a, t) => a + Number(t.amount), 0)
  const grossProfit = totalProfit + deductions

  const empty = { 'วันที่':'','ประเภท':'','หมวดหมู่':'','จำนวนเงิน':'','รายรับ':'','รายจ่าย':'','กำไรขาดทุน':'','รุ่นกล้อง':'','วันที่ซื้อ':'','ราคาต้นทุน':'','รายละเอียดลูกค้า':'','หมายเหตุ':'' }
  rows.push(empty)
  rows.push({ ...empty, 'วันที่':'สรุป', 'หมวดหมู่':'รวมรายรับ',               'รายรับ':      totalIncome  })
  rows.push({ ...empty,                  'หมวดหมู่':'รวมรายจ่าย',              'รายจ่าย':     totalExpense })
  rows.push({ ...empty,                  'หมวดหมู่':'กำไรขาย (ก่อนหักรายจ่าย)', 'กำไรขาดทุน': grossProfit  })
  rows.push({ ...empty,                  'หมวดหมู่':'กำไรขาดทุนสุทธิ',          'กำไรขาดทุน': totalProfit  })
  if (balance) {
    rows.push(empty)
    rows.push({ ...empty, 'วันที่':'ยอดเงินล่าสุดในรายงาน', 'หมวดหมู่':'ยอดโอน (ธนาคาร)', 'จำนวนเงิน': balance.bank })
    rows.push({ ...empty,                               'หมวดหมู่':'ยอดเงินสด',        'จำนวนเงิน': balance.cash })
  }

  write(rows, 'รายการบัญชี', `รายการบัญชี_${stamp()}.xlsx`)
}

// ─── Shared: load Sarabun font and init jsPDF doc ────────────
async function initPDFDoc(orientation = 'landscape') {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const res    = await fetch('/fonts/Sarabun-Regular.ttf')
  const buf    = await res.arrayBuffer()
  const b64    = btoa(String.fromCharCode(...new Uint8Array(buf)))
  const doc    = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
  doc.addFileToVFS('Sarabun-Regular.ttf', b64)
  doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal')
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
function drawReportHeader(doc, title, subtitle = '') {
  doc.setFillColor(255, 247, 246)
  doc.rect(0, 0, 297, 210, 'F')
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(245, 205, 201)
  doc.roundedRect(10, 8, 277, 18, 4, 4, 'FD')
  doc.setTextColor(211, 47, 35)
  doc.setFontSize(13)
  doc.text(title, 14, 18)
  doc.setFillColor(211, 47, 35)
  doc.roundedRect(253, 11, 30, 9, 3, 3, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(9)
  doc.text('SMALL CAMERA', 258, 17.2)
  doc.setTextColor(123, 90, 86)
  doc.setFontSize(7.5)
  if (subtitle) doc.text(subtitle, 12, 32)
  doc.text(`สร้างเมื่อ ${new Date().toLocaleString('th-TH')}`, 12, subtitle ? 37 : 32)
  return subtitle ? 42 : 37
}
function drawStatCards(doc, stats, y) {
  const gap = 3
  const pageW = 297
  const left = 10
  const right = 10
  const cols = stats.length > 4 ? 4 : stats.length
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
const summaryFoot = (columnCount, lines) => [[{
  content: lines.join('     '),
  colSpan: columnCount,
  styles: { halign: 'left', fontStyle: 'normal', cellPadding: { top: 1.8, right: 2.2, bottom: 1.8, left: 2.2 } },
}]]

// ─── Inventory PDF blob ───────────────────────────────────────
async function buildInventoryPDF(filtered) {
  const { doc, autoTable } = await initPDFDoc()
  const sorted = sortProductsForStockPDF(filtered)

  const totalCost = sorted.reduce((a,p)=>a+Number(p.total_cost||0),0)
  const totalSold = sorted.reduce((a,p)=>p.sold_price?a+Number(p.sold_price):a,0)
  const soldCount = sorted.filter(p=>p.status==='Sold').length
  const totalProfit = sorted.reduce((a,p)=>p.sold_price?a+(Number(p.sold_price)-Number(p.total_cost||0)):a,0)
  let startY = drawReportHeader(doc, 'รายงานสต็อกสินค้า', `จำนวน ${sorted.length} รายการ`)
  startY = drawStatCards(doc, [
    { label: 'จำนวนรายการ', value: `${sorted.length} รายการ` },
    { label: 'ขายแล้ว', value: `${soldCount} รายการ`, tone: 'in' },
    { label: 'ต้นทุนรวม', value: moneyText(totalCost), tone: 'warn' },
    { label: 'กำไรรวม', value: moneyText(totalProfit), tone: totalProfit >= 0 ? 'in' : 'out' },
  ], startY)
  const head = [['รุ่น','Serial','ประเภท','เกรด','สถานะ','ต้นทุนรวม','ราคาขาย','กำไร','วันรับเข้า','วันขาย','รายละเอียดลูกค้า','หมายเหตุ']]
  const body = sorted.map(p => {
    const profit = p.sold_price ? Number(p.sold_price) - Number(p.total_cost) : ''
    return [
      p.model || '', p.serial_number || '', p.category || 'กล้อง',
      String(p.condition || ''), STATUS_TH[p.status] || p.status,
      Number(p.total_cost || 0).toLocaleString('th-TH'),
      p.sold_price ? Number(p.sold_price).toLocaleString('th-TH') : '',
      profit !== '' ? profit.toLocaleString('th-TH') : '',
      thDate(p.created_at), thDate(p.sold_date),
      p.customer_note || '', p.notes || '',
    ]
  })

  autoTable(doc, {
    ...reportTableOptions,
    head, body, startY,
    foot: summaryFoot(head[0].length, [
      `ต้นทุนรวม ${Number(totalCost).toLocaleString('th-TH')} บาท`,
      `ราคาขายรวม ${Number(totalSold).toLocaleString('th-TH')} บาท`,
      `กำไรรวม ${Number(totalProfit).toLocaleString('th-TH')} บาท`,
    ]),
    columnStyles: {
      0: { cellWidth: 32 }, 1: { cellWidth: 22 }, 2: { cellWidth: 16 },
      3: { cellWidth: 10, halign: 'center' }, 4: { cellWidth: 18 },
      5: { cellWidth: 20, halign: 'right' }, 6: { cellWidth: 18, halign: 'right' },
      7: { cellWidth: 18, halign: 'right' }, 8: { cellWidth: 22 }, 9: { cellWidth: 22 },
      10: { cellWidth: 40 }, 11: { cellWidth: 39 },
    },
  })
  return doc.output('blob')
}

// ─── Transactions PDF blob ────────────────────────────────────
async function buildTransactionsPDF(filtered, balance = null, stockValue = null) {
  const { doc, autoTable } = await initPDFDoc()

  const balMap = buildBalanceMap(filtered, balance)
  const stockMap = stockValue != null ? buildStockMap(filtered, stockValue) : {}
  const head = [['วันที่','ประเภท','หมวดหมู่','จำนวนเงิน','รายรับ','รายจ่าย','กำไรขาดทุน','รุ่นกล้อง','วันที่ซื้อ','ต้นทุน','รายละเอียดลูกค้า','หมายเหตุ','ธนาคารคงเหลือ','เงินสดคงเหลือ','สต๊อกคงเหลือ']]
  const plValues = []
  const pdfCountedInstall = new Set()
  const body = filtered.map(t => {
    let pl = ''
    if (t.category === 'Sale' && t.products?.total_cost != null) {
      if (!t.products?.installment_total) {
        pl = Number(t.amount) - Number(t.products.total_cost)
      } else if (t.products?.status === 'Sold' && !pdfCountedInstall.has(t.product_id)) {
        pl = Number(t.products.installment_total) - Number(t.products.total_cost)
        pdfCountedInstall.add(t.product_id)
      }
    } else if (t.category === 'Trade' && t.trade_profit_a != null) {
      pl = Number(t.trade_profit_a)
    } else if (t.type === 'Expense' && PROFIT_DEDUCT_CATS.has(t.category)) {
      pl = -Number(t.amount)
    }
    plValues.push(pl)
    const bal = balMap[t.id]
    return [
      thDate(t.date),
      t.type === 'Income' ? 'รายรับ' : 'รายจ่าย',
      t.category,
      Number(t.amount).toLocaleString('th-TH'),
      t.type === 'Income'  ? Number(t.amount).toLocaleString('th-TH') : '',
      t.type === 'Expense' ? Number(t.amount).toLocaleString('th-TH') : '',
      pl !== '' ? pl.toLocaleString('th-TH') : '',
      t.products?.model || '',
      t.products?.created_at ? thDate(t.products.created_at) : '',
      txProductCost(t) ? txProductCost(t).toLocaleString('th-TH') : '',
      t.category === 'Sale' ? (t.products?.customer_note || '') : '',
      t.note || '',
      bal ? Number(bal.bank || 0).toLocaleString('th-TH') : '',
      bal ? Number(bal.cash || 0).toLocaleString('th-TH') : '',
      stockValue != null ? Number(stockMap[t.id] || 0).toLocaleString('th-TH') : '',
    ]
  })

  const totalIncome  = filtered.filter(t => t.type === 'Income').reduce((a, t) => a + Number(t.amount), 0)
  const totalExpense = filtered.filter(t => t.type === 'Expense').reduce((a, t) => a + Number(t.amount), 0)
  const totalProfit  = plValues.reduce((a, v) => v !== '' ? a + v : a, 0)
  const deductions   = filtered.filter(t => t.type === 'Expense' && PROFIT_DEDUCT_CATS.has(t.category)).reduce((a, t) => a + Number(t.amount), 0)
  const grossProfit  = totalProfit + deductions
  let startY = drawReportHeader(doc, 'รายงานรายการบัญชี', `จำนวน ${filtered.length} รายการ`)
  startY = drawStatCards(doc, [
    { label: 'รวมรายรับ', value: moneyText(totalIncome), tone: 'in' },
    { label: 'รวมรายจ่าย', value: moneyText(totalExpense), tone: 'out' },
    { label: 'กำไรขายก่อนหัก', value: moneyText(grossProfit), tone: grossProfit >= 0 ? 'in' : 'out' },
    { label: 'กำไรสุทธิ', value: moneyText(totalProfit), tone: totalProfit >= 0 ? 'in' : 'out' },
    { label: 'โอนล่าสุดในรายงาน', value: balance ? moneyText(balance.bank) : '-', tone: 'bank' },
    { label: 'เงินสดล่าสุดในรายงาน', value: balance ? moneyText(balance.cash) : '-', tone: 'cash' },
    { label: 'สต๊อกล่าสุดในรายงาน', value: stockValue != null ? moneyText(stockValue) : '-', tone: 'warn' },
  ], startY)

  autoTable(doc, {
    ...reportTableOptions,
    head, body, startY,
    foot: summaryFoot(head[0].length, [
      `รวมรายรับ ${Number(totalIncome).toLocaleString('th-TH')} บาท`,
      `รวมรายจ่าย ${Number(totalExpense).toLocaleString('th-TH')} บาท`,
      `กำไรสุทธิ ${Number(totalProfit).toLocaleString('th-TH')} บาท`,
      balance ? `โอนล่าสุดในรายงาน ${Number(balance.bank || 0).toLocaleString('th-TH')} บาท` : 'โอนล่าสุดในรายงาน -',
      balance ? `เงินสดล่าสุดในรายงาน ${Number(balance.cash || 0).toLocaleString('th-TH')} บาท` : 'เงินสดล่าสุดในรายงาน -',
      stockValue != null ? `สต๊อกล่าสุดในรายงาน ${Number(stockValue || 0).toLocaleString('th-TH')} บาท` : 'สต๊อกล่าสุดในรายงาน -',
    ]),
    columnStyles: {
      0: { cellWidth: 17 }, 1: { cellWidth: 9 }, 2: { cellWidth: 14 },
      3: { cellWidth: 14, halign: 'right' }, 4: { cellWidth: 14, halign: 'right' },
      5: { cellWidth: 14, halign: 'right' }, 6: { cellWidth: 16, halign: 'right' },
      7: { cellWidth: 18 }, 8: { cellWidth: 16 },
      9: { cellWidth: 13, halign: 'right' }, 10: { cellWidth: 30 },
      11: { cellWidth: 24 },
      12: { cellWidth: 20, halign: 'right' },
      13: { cellWidth: 20, halign: 'right' },
      14: { cellWidth: 20, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && [10, 11].includes(data.column.index) && String(data.cell.raw || '').length > 35) {
        data.cell.styles.fontSize = 6
      }
    },
  })

  return doc.output('blob')
}

// ─── Export Inventory + Images as ZIP ────────────────────────
export async function exportInventoryWithImages(products, transactions = [], statusFilter = 'all', format = 'xlsx', onProgress) {
  const filtered = products.filter(p => statusFilter === 'all' || p.status === statusFilter)
  if (!filtered.length) { alert('ไม่มีข้อมูล'); return }

  const zip = new JSZip()
  const s = stamp()

  if (format === 'xlsx') {
    const rows = filtered.map(p => ({
      'รุ่น':              p.model,
      'Serial Number':     p.serial_number,
      'เกรดสภาพ':         p.condition,
      'สถานะ':            STATUS_TH[p.status] || p.status,
      'ต้นทุนเริ่มต้น':   Number(p.base_cost),
      'ต้นทุนรวม':        Number(p.total_cost),
      'ราคาขาย':          p.sold_price ? Number(p.sold_price) : '',
      'กำไร':             p.sold_price ? Number(p.sold_price) - Number(p.total_cost) : '',
      'วันที่รับเข้า':    thDate(p.created_at),
      'วันที่ขาย':        thDate(p.sold_date),
      'วันหมดประกัน':    thDate(p.warranty_expiry),
      'รายละเอียดลูกค้า': p.customer_note || '',
      'หมายเหตุ':         p.notes || '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = Object.keys(rows[0] || {}).map(() => ({ wch: 20 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'สต็อกสินค้า')
    const xlsxBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    zip.file(`สต็อกสินค้า_${s}.xlsx`, xlsxBuf)
  } else {
    const pdfBlob = await buildInventoryPDF(filtered)
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
    const zipCountedInstall = new Set()
    const rows = filtered.map(t => {
      let pl = ''
      if (t.category === 'Sale' && t.products?.total_cost != null) {
        if (!t.products?.installment_total) {
          pl = Number(t.amount) - Number(t.products.total_cost)
        } else if (t.products?.status === 'Sold' && !zipCountedInstall.has(t.product_id)) {
          pl = Number(t.products.installment_total) - Number(t.products.total_cost)
          zipCountedInstall.add(t.product_id)
        }
      } else if (t.category === 'Trade' && t.trade_profit_a != null) {
        pl = Number(t.trade_profit_a)
      } else if (t.type === 'Expense' && PROFIT_DEDUCT_CATS.has(t.category)) {
        pl = -Number(t.amount)
      }
      return {
        'วันที่':            thDate(t.date),
        'ประเภท':           t.type === 'Income' ? 'รายรับ' : 'รายจ่าย',
        'หมวดหมู่':         t.category,
        'จำนวนเงิน':        Number(t.amount),
        'รายรับ':           t.type === 'Income'  ? Number(t.amount) : '',
        'รายจ่าย':          t.type === 'Expense' ? Number(t.amount) : '',
        'กำไรขาดทุน':       pl,
        'รุ่นกล้อง':        t.products?.model || '',
        'วันที่ซื้อ':        t.products?.created_at ? thDate(t.products.created_at) : '',
        'ราคาต้นทุน':       txProductCost(t) || '',
        'รายละเอียดลูกค้า': t.category === 'Sale' ? (t.products?.customer_note || '') : '',
        'หมายเหตุ':         t.note || '',
      }
    })
    const totalIncome  = filtered.filter(t => t.type === 'Income').reduce((a, t) => a + Number(t.amount), 0)
    const totalExpense = filtered.filter(t => t.type === 'Expense').reduce((a, t) => a + Number(t.amount), 0)
    const totalProfit  = rows.reduce((a, r) => r['กำไรขาดทุน'] !== '' ? a + r['กำไรขาดทุน'] : a, 0)
    const deductions   = filtered.filter(t => t.type === 'Expense' && PROFIT_DEDUCT_CATS.has(t.category)).reduce((a, t) => a + Number(t.amount), 0)
    const grossProfit  = totalProfit + deductions
    const empty = Object.fromEntries(Object.keys(rows[0]).map(k => [k, '']))
    rows.push(empty)
    rows.push({ ...empty, 'วันที่': 'สรุป', 'หมวดหมู่': 'รวมรายรับ',               'รายรับ':      totalIncome  })
    rows.push({ ...empty,                   'หมวดหมู่': 'รวมรายจ่าย',              'รายจ่าย':     totalExpense })
    rows.push({ ...empty,                   'หมวดหมู่': 'กำไรขาย (ก่อนหักรายจ่าย)', 'กำไรขาดทุน': grossProfit  })
    rows.push({ ...empty,                   'หมวดหมู่': 'กำไรขาดทุนสุทธิ',          'กำไรขาดทุน': totalProfit  })
    if (balance) {
      rows.push(empty)
      rows.push({ ...empty, 'วันที่': 'ยอดเงินล่าสุดในรายงาน', 'หมวดหมู่': 'ยอดโอน (ธนาคาร)', 'จำนวนเงิน': balance.bank })
      rows.push({ ...empty,                                'หมวดหมู่': 'ยอดเงินสด',        'จำนวนเงิน': balance.cash })
    }
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = Object.keys(rows[0]).map(() => ({ wch: 20 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'รายการบัญชี')
    zip.file(`รายการบัญชี_${s}.xlsx`, XLSX.write(wb, { bookType: 'xlsx', type: 'array' }))
  } else {
    zip.file(`รายการบัญชี_${s}.pdf`, await buildTransactionsPDF(filtered, balance, stockValue))
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
